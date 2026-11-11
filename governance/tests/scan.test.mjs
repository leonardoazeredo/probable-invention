import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanInlineText, scanA11yText } from '../lib/scan.mjs';

const scan = (fn, text) => {
  const d = {};
  fn(text, d);
  return d;
};

test('inline directives are counted per rule, reasons ignored', () => {
  assert.deepEqual(
    scan(scanInlineText, [
      '// eslint-disable-next-line no-restricted-syntax, no-console -- legacy',
      '/* eslint-disable */',
      'x; // eslint-disable-line no-console',
    ].join('\n')),
    { 'inline:no-restricted-syntax': 1, 'inline:no-console': 2, 'inline:*': 1 },
  );
});

test('inline config below error is counted; error and enable are not', () => {
  assert.deepEqual(
    scan(scanInlineText, [
      '/* eslint no-restricted-syntax: off, no-console: ["warn"] */',
      '/* eslint eqeqeq: error */',
      '/* eslint-enable */',
    ].join('\n')),
    { 'inline-config:no-restricted-syntax': 1, 'inline-config:no-console': 1 },
  );
});

test('a11y opt-outs are counted by mode', () => {
  assert.deepEqual(
    scan(scanA11yText, "a = { parameters: { a11y: { test: 'todo' } } }; b = { a11y: { test: \"off\" } }; c = { a11y: { test: 'error' } };"),
    { 'a11y:todo': 1, 'a11y:off': 1 },
  );
});
