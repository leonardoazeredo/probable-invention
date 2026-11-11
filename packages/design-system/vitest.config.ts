import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        plugins: [storybookTest({ configDir: '.storybook' })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
            // Optional override for environments with a preinstalled browser.
            launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
          }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
