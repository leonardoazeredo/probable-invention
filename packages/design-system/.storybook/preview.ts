import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  parameters: {
    // Every story fails CI on axe violations. Downgrading a story to 'todo' or
    // 'off' is counted as debt by governance/scan-debt.mjs and ratcheted.
    a11y: { test: 'error' },
  },
};
export default preview;
