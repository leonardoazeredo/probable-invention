#!/usr/bin/env node
// Builds governance/visual/figma-variables.json: Figma variable id -> variable
// name, type and resolved (light-mode) value, from the variables export that
// Simple Design System publishes (figma/sds, scripts/tokens/tokens.json, MIT).
// The structural check uses it to say which variable a Figma value comes from
// and which design-system token carries it.
//
//   node governance/visual/build-figma-variables.mjs --sds <path to tokens.json> --source "figma/sds@<commit>"
//
// The output is committed and code-owner protected, like the references.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { sds: { type: 'string' }, source: { type: 'string' } } });
if (!values.sds) throw new Error('pass --sds <path to figma/sds scripts/tokens/tokens.json>');
const doc = JSON.parse(readFileSync(values.sds, 'utf8'));

const title = (seg) => seg.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const lookup = (ref) => {
  // "{@color_primitives.Gray.100}" -> doc["@color_primitives"].gray["100"]
  const [collection, ...rest] = ref.slice(1, -1).split('.');
  let node = doc[collection];
  for (const seg of rest) node = node?.[seg.toLowerCase().replace(/\s+/g, '-')];
  return node;
};
const resolve = (value, depth = 0) => {
  if (typeof value === 'string' && /^\{@.+\}$/.test(value) && depth < 10) {
    const target = lookup(value);
    if (!target) throw new Error(`unresolved alias ${value}`);
    return resolve(target.$value, depth + 1);
  }
  return value;
};

const variables = {};
(function walk(node, path) {
  if (node && typeof node === 'object' && '$type' in node) {
    const id = node.$extensions?.['com.figma.sds']?.figmaId;
    if (id) {
      variables[id] = {
        // "@color.text.default.secondary" -> "Text/Default/Secondary"
        name: path.slice(1).map(title).join('/'),
        collection: path[0].replace(/^@/, ''),
        type: node.$type,
        value: resolve(node.$value),
      };
    }
    return;
  }
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) if (!k.startsWith('$')) walk(v, [...path, k]);
})(doc, []);

const out = {
  $comment:
    'Figma variable id -> name, type and light-mode value, built by build-figma-variables.mjs from Simple Design System\'s published variables export (MIT, Copyright (c) 2024 Figma). Do not edit by hand.',
  source: values.source ?? 'figma/sds scripts/tokens/tokens.json',
  variables: Object.fromEntries(Object.entries(variables).sort(([a], [b]) => a.localeCompare(b))),
};
writeFileSync(join(HERE, 'figma-variables.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${Object.keys(variables).length} variables`);
