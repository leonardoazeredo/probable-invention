// Links Figma variables to design-system tokens, so a structural finding can
// say which token to use: "→ Figma: Text/Default/Secondary; use
// tokens.color.textSecondary".
//
// Figma side: figma-variables.json (variable id -> SDS name and value).
// Code side: the base branch's tokens.ts, read as text (never executed). Each
// token there carries a comment naming the SDS variable it maps to, e.g.
//   textSecondary: '#757575', // Text/Default/Secondary (gray-500)

/** Normalises a variable name for matching: "Subtitle/Size/Base" == "Subtitle/Size Base". */
const norm = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Parses tokens.ts into [{ path, value, variable }]. Handles one level of
 * groups (`color: {`) and one-line groups (`radius: { md: '8px' }, // ...`).
 */
export function parseTokens(source) {
  const out = [];
  let group = null;
  const clean = (c) => (c ?? '').replace(/\(.*?\)/g, '').trim();
  for (const line of source.split('\n')) {
    let m;
    if ((m = line.match(/^\s*(\w+):\s*\{\s*(\w+):\s*'?([^',}]+?)'?\s*\},?\s*(?:\/\/\s*(.*))?$/))) {
      out.push({ path: `tokens.${m[1]}.${m[2]}`, value: m[3], variable: clean(m[4]) });
    } else if ((m = line.match(/^\s*(\w+):\s*\{\s*(?:\/\/.*)?$/))) {
      group = m[1];
    } else if (/^\s*\},?\s*(?:\/\/.*)?$/.test(line)) {
      group = null;
    } else if (group && (m = line.match(/^\s*(\w+):\s*'?([^',]+?)'?,?\s*(?:\/\/\s*(.*))?$/))) {
      out.push({ path: `tokens.${group}.${m[1]}`, value: m[2], variable: clean(m[3]) });
    }
  }
  return out;
}

/**
 * @param {Record<string, { name: string, value: unknown }>} variables figma-variables.json .variables
 * @param {Array<{ path: string, value: string, variable: string }>} tokens parseTokens result
 * @returns {(variableId: string) => string}
 */
export function makeVariableHint(variables, tokens) {
  const byName = new Map(tokens.filter((t) => t.variable).map((t) => [norm(t.variable), t]));
  return (id) => {
    const variable = variables[id];
    if (!variable) return '';
    const token = byName.get(norm(variable.name));
    if (token) return ` → Figma variable ${variable.name}; use ${token.path}`;
    return ` → Figma variable ${variable.name} (${variable.value}); no design-system token maps to it yet`;
  };
}
