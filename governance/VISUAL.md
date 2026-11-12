# Figma fidelity gate (`governance/visual`)

Code checks prove a screen is built from the design system. They don't prove it
looks like the design. This gate does: it renders each screen listed in
[`visual/scenes.json`](visual/scenes.json) and diffs it pixel by pixel against
an image of the matching Figma frame, fetched from the Figma API and committed
under [`visual/baselines/`](visual/baselines/).

## What runs, and why a PR can't game it

The job lives in `.github/workflows/governance-trusted.yml` and uses
`pull_request_target`, so the workflow, the gate script, the scene list, the
thresholds and the reference images all come from the **base branch**. A PR
that edits any of them is still judged by main's copy; its edits take effect
only after a code owner approves and merges them (CODEOWNERS on `governance/`).

1. **Bundle** the scene's component from the PR checkout with esbuild from the
   base branch's install. No PR config is loaded (no Vite, PostCSS or Babel
   config; the PR's tsconfig is ignored), and no PR script runs on the runner.
2. **Render** the bundle in headless Chromium at the frame's size, from an
   inline page with every network request refused. Inter comes from the base
   branch's `@fontsource/inter`, so text doesn't depend on runner fonts.
3. **Diff** the root element's screenshot with pixelmatch. Size differences
   count as drift: the missing area is treated as changed pixels.
4. **Fail** when the rendered size is more than `maxSizeDelta` px off the
   frame, or the share of differing pixels exceeds `maxDiffRatio`. The rendered, reference and diff PNGs are uploaded as the
   `visual-diff` artifact on every run.

A scene is skipped when the PR changes none of the files its bundle imports
(esbuild's metafile lists them) and no `package.json`, lockfile or tsconfig.
That keeps an unrelated PR from failing because someone else's screen drifted.
Run `pnpm visual` locally to compare every scene regardless.

## Updating a reference

References come only from Figma, never from a render of our own code:

```sh
FIGMA_TOKEN=... pnpm visual:fetch --scene hero-actions      # or --token-file <path>
pnpm visual:fetch --scene hero-actions --token-file <path> --verify   # check the committed image still matches Figma
```

Use a personal access token with only **File content: read-only**. Without a
token, exporting the frame from Figma's Export panel (PNG, 1x) gives the same
image; record the file key and node id in the manifest by hand. The script
writes the PNG and a manifest next to it (file key, node id, Figma file
version, size, sha256), so a reviewer can see exactly which frame and version
the image came from.

A reference change goes in its own PR, which needs code-owner approval. Because
the gate always judges against main, the screen is held to the new reference
from the next PR that touches it.

## Adding a scene

Add an entry to `visual/scenes.json`: the module and export to render, the
props (strings matching the Figma frame's text), callback prop names, the
viewport (the frame's width), the Figma file key and node id, and the
thresholds. Then fetch its reference.

## Known limits

- **Browser vs Figma rendering.** Chromium and Figma rasterise text slightly
  differently, so `maxDiffRatio` can't be zero. It's set from a measured run
  and recorded in `scenes.json`. At the current 1% limit the gate catches wrong
  colours, missing borders, wrong type sizes and anything that changes the
  frame's size, but a few-pixel nudge inside the frame (a 16px gap becoming
  12px) moves the ratio by only about 0.1% and can pass. Tighten the limit once
  the screen matches Figma closely.
- **One state per scene.** Only the props in `scenes.json` are rendered. Hover,
  focus and responsive breakpoints need their own scenes.
- **PR code runs in the browser.** It can't reach the network or the runner's
  files, and the job has a read-only token and no secrets, but it does execute.
  A PR could in principle paint a copy of the reference image instead of the
  real UI. That would be visible in review as an embedded image in feature code.
- **References are only as fresh as the last fetch.** `--verify` shows whether
  Figma has moved on since.
