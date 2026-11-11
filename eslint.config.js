// Governance lint config. Protected by CODEOWNERS; in CI the trusted workflow
// lints PR code with the *base branch* copy of this file, so a PR cannot
// weaken the rules it is judged by.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const DS = 'packages/design-system/src';

// Native elements that have a canonical primitive in @pi/design-system.
const PRIMITIVE_TAGS = 'button|input|select|textarea|dialog';
// ARIA widget roles: assigning one means hand-rolling an interactive control.
// Relationship attributes (aria-labelledby, aria-describedby, htmlFor/id) stay
// legal: they are correct composition, not re-implementation.
const WIDGET_ROLES =
  'button|checkbox|combobox|dialog|alertdialog|listbox|menu|menubar|menuitem|option|radio|radiogroup|slider|spinbutton|switch|tab|tablist|tabpanel|textbox|tree|treeitem';

const RAW_COLOR = {
  selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b|\\brgba?\\(|\\bhsla?\\(/]',
  message: 'Raw colour value. Use `tokens.color.*` from @pi/design-system.',
};

/** Rules that stop feature code from building an alternative primitive. */
const featureBoundary = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: [
            'styled-components',
            '@emotion/*',
            'class-variance-authority',
            '@radix-ui/*',
            '@headlessui/*',
            '@ark-ui/*',
            'react-aria',
            'react-aria-components',
            '@mui/*',
            '@chakra-ui/*',
          ],
          message:
            'Styling and headless-UI libraries may only be used inside packages/design-system. Compose a primitive from @pi/design-system instead.',
        },
        {
          group: ['@pi/design-system/*', '**/packages/design-system/**'],
          message: 'Import from the public entry point `@pi/design-system` only.',
        },
      ],
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: `JSXOpeningElement[name.name=/^(${PRIMITIVE_TAGS})$/]`,
      message:
        'Native interactive element outside the design system. Use Button (or the matching primitive) from @pi/design-system. Need a new primitive? Open a design-system request; do not build it locally.',
    },
    {
      selector: `JSXAttribute[name.name='role'][value.value=/^(${WIDGET_ROLES})$/]`,
      message:
        'ARIA widget role outside the design system means a hand-rolled control. Use the matching primitive from @pi/design-system.',
    },
    {
      selector: `JSXAttribute[name.name='as'][value.value=/^(${PRIMITIVE_TAGS})$/]`,
      message: 'Polymorphic escape hatch (as="…") onto a primitive element. Use the primitive itself.',
    },
    {
      selector: "JSXAttribute[name.name='tabIndex'] > JSXExpressionContainer > Literal[value>0]",
      message: 'Positive tabIndex reorders focus by hand. Use the design-system primitive or tabIndex={0}/{-1}.',
    },
    {
      selector: `CallExpression:matches([callee.name='createElement'], [callee.property.name='createElement'])[arguments.0.value=/^(${PRIMITIVE_TAGS})$/]`,
      message: 'createElement of a primitive element. Use the primitive from @pi/design-system.',
    },
    {
      selector: `CallExpression[callee.name='styled'][arguments.0.value=/^(${PRIMITIVE_TAGS})$/]`,
      message: 'styled(<primitive element>) builds an alternative primitive. Use @pi/design-system.',
    },
    {
      selector: `MemberExpression[object.name='styled'][property.name=/^(${PRIMITIVE_TAGS})$/]`,
      message: 'styled.<primitive element> builds an alternative primitive. Use @pi/design-system.',
    },
    RAW_COLOR,
  ],
};

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/temp/**', '**/node_modules/**', '**/storybook-static/**', '.governance-tmp/**'],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  // Everything outside the design-system source is feature territory.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [`${DS}/**`],
    rules: featureBoundary,
  },
  // Inside the design system: primitives may use native elements, but raw
  // design values belong only in the token file.
  {
    files: [`${DS}/**/*.{ts,tsx}`],
    ignores: [`${DS}/tokens/**`],
    rules: { 'no-restricted-syntax': ['error', RAW_COLOR] },
  },
  // The token file is the one place raw values are allowed. The rule stays at
  // error with no selectors, so the debt scanner sees no severity downgrade.
  {
    files: [`${DS}/tokens/**/*.ts`],
    rules: { 'no-restricted-syntax': ['error'] },
  },
);
