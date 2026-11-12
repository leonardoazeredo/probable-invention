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
   branch's `@fontsource/inter`, so text doesn't depend on runner fonts. The job
   runs in the `mcr.microsoft.com/playwright` image matching the Playwright
   version in `package.json` (a governance test keeps them in step), so
   Chromium and system libraries don't drift with the runner. Each scene is
   rendered twice; if the two renders differ, the scene fails as an
   environment problem rather than being diffed.
3. **Diff** the root element's screenshot with pixelmatch. The render and the
   frame are placed on one canvas, top-left or centred (the scene's `align`),
   and only the area both cover is diffed. A size mismatch is reported as its
   own finding instead of inflating the diff ratio.
4. **Fail** when the rendered size is more than `maxSizeDelta` px off the
   frame, or the share of differing pixels in the overlap exceeds
   `maxDiffRatio`.
5. **Report** what differs, most actionable first: the size difference, the
   most common colour on each side (usually the background), the diff ratio,
   and the largest changed regions in Figma frame coordinates. When the
   backgrounds differ, which flags every pixel, the report also diffs with the
   render's background repainted in Figma's colour, so content changes still
   show. That second diff is for locating problems only; pass/fail uses the
   real diff. The `visual-diff` artifact holds `<scene>.report.html` (findings,
   Figma and render side by side, an onion-skin overlay, the diffs and a region
   table) plus the raw PNGs.

## Structural check

The pixel diff says *where* the screen differs. The structural check says
*what*: it compares the browser's layout with the Figma frame's layer data and
names the property, for example `Subtitle: text colour #1e1e1e, Figma #757575`
or `Buttons: gap between Secondary button and Primary button 12px, Figma 16px`.
There's no rasteriser noise, so a few-pixel nudge that the pixel ratio misses
is caught exactly.

- **Figma side:** `baselines/<scene>.figma.json`, a trimmed node tree (boxes
  relative to the frame, auto-layout, fills, strokes, radius, type, bound
  variable ids). `pnpm visual:fetch --scene <id> --structure-only` writes it
  from the Figma REST API; `--verify` checks it is still current.
- **Map:** the scene's `structure.map` in `scenes.json` pairs Figma layers with
  CSS selectors: `{ "figma": "Text/Title", "selector": "h1" }`. A layer is a
  path of layer names from the frame (`Button#2` is the second sibling called
  Button), a node id like `2143:15060`, or `""` for the frame itself
  (selector `:scope`). The map lives on the base branch, so a PR can't remap
  layers to avoid the check.
- **Compared:** top, height, left and width (±1px; text: top and height only,
  ±2px, since text width depends on the rasteriser), background, border width
  and colour, corner radius, text colour, font family, size and weight, line
  height (±1px), letter spacing, and the gaps between mapped children of
  auto-layout frames. Colours match within 2/255 per channel. Override with
  `structure.tolerance`.
- **Token hints:** when the Figma property is bound to a variable, the
  finding names it and the design-system token that carries it, for example
  `→ Figma variable Space/800; use tokens.space.xxl`, or says no token maps to
  it yet. Variable names come from
  [`visual/figma-variables.json`](visual/figma-variables.json), built from
  Simple Design System's published variables export with
  `node governance/visual/build-figma-variables.mjs --sds <tokens.json>`.
  Tokens are matched by the SDS variable named in each token's comment in
  `packages/design-system/src/tokens/tokens.ts` (base branch copy, read as
  text), so keep those comments accurate.
- **Mode:** `"report"` lists mismatches in the summary and report without
  failing; `"enforce"` fails the scene on any mismatch. Start a new scene in
  `report`, then switch to `enforce` once the map is right.
- **Not covered:** elements that aren't mapped. An unexpected extra element is
  still caught by the pixel diff.

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
