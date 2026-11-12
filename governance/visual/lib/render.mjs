// Renders one scene from a PR checkout without running any of the PR's tooling.
//
// Bundling: esbuild from the trusted (base-branch) install. No config file from
// the PR is loaded (no vite/postcss/babel config, tsconfig ignored), and nothing
// from the PR runs on the runner. The scene's entry point, props and fonts come
// from the trusted scenes.json.
//
// Rendering: the bundle runs only inside headless Chromium, from an inline page
// with every network request refused, so PR code can't reach anything.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { chromium } from 'playwright';

export async function bundleScene({ trusted, head, scene }) {
  const require = createRequire(join(trusted, 'package.json'));
  const entry = `
    import { createElement } from 'react';
    import { createRoot } from 'react-dom/client';
    import * as mod from ${JSON.stringify(resolve(head, scene.module))};
    const props = ${JSON.stringify(scene.props ?? {})};
    for (const name of ${JSON.stringify(scene.callbacks ?? [])}) props[name] = () => {};
    const Component = mod[${JSON.stringify(scene.export)}];
    if (typeof Component !== 'function') throw new Error('export ${scene.export} not found');
    createRoot(document.getElementById('root')).render(createElement(Component, props));
    requestAnimationFrame(() => requestAnimationFrame(() => { window.__sceneReady = true; }));
  `;
  const webModules = join(trusted, 'apps/web/node_modules');
  const result = await build({
    stdin: { contents: entry, resolveDir: head, loader: 'js' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    tsconfigRaw: '{}',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      '@pi/design-system': resolve(head, 'packages/design-system/src/index.ts'),
      react: require.resolve('react', { paths: [webModules] }).replace(/[/\\]index\.js$/, ''),
      'react-dom': require.resolve('react-dom', { paths: [webModules] }).replace(/[/\\]index\.js$/, ''),
    },
    metafile: true,
    logLevel: 'silent',
  });
  const inputs = Object.keys(result.metafile.inputs)
    .map((p) => relative(head, resolve(head, p)).replaceAll('\\', '/'))
    .filter((p) => !p.startsWith('..') && !p.includes('node_modules/') && p !== '<stdin>');
  return { code: result.outputFiles[0].text, inputs };
}

function fontFaces(trusted, fonts = []) {
  const require = createRequire(join(trusted, 'package.json'));
  return fonts
    .map(({ family, weight, file }) => {
      const data = readFileSync(require.resolve(file)).toString('base64');
      return `@font-face{font-family:${JSON.stringify(family)};font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
    })
    .join('\n');
}

export async function launchBrowser() {
  return chromium.launch({
    executablePath: process.env.VISUAL_CHROMIUM_PATH || undefined,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND', '--font-render-hinting=none', '--disable-lcd-text'],
  });
}

/** Returns a PNG buffer of the scene's root element. */
export async function renderScene({ browser, trusted, scene, code }) {
  const context = await browser.newContext({
    viewport: scene.viewport,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  try {
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces(trusted, scene.fonts)}
html,body{margin:0;padding:0;background:#fff;}
*{-webkit-font-smoothing:antialiased;}
</style></head><body><div id="root"></div></body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await page.addScriptTag({ content: code });
    await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 15000 }).catch(() => {});
    if (errors.length) throw new Error(`scene threw in the browser:\n${errors.join('\n')}`);
    await page.evaluate(() => document.fonts.ready);
    const root = page.locator('#root > *').first();
    if (!(await root.count())) throw new Error('scene rendered nothing');
    return await root.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
  } finally {
    await context.close();
  }
}
