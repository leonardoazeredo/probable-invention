// Writes a self-contained HTML report for one scene, next to its PNGs in the
// visual-diff artifact: the findings, Figma and render side by side at the same
// scale with changed regions outlined, the diff, and an onion-skin overlay
// placed with the same alignment the comparison used.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function sceneReport({ scene, status, findings, result, files }) {
  // When backgrounds differ, the content regions are the useful ones.
  const regions = (result.content ?? result).regions;
  const [ew, eh] = result.expectedSize;
  const [aw, ah] = result.actualSize;
  const { width, height } = result;
  const [ex, ey] = result.offsets.expected;
  const [ax, ay] = result.offsets.actual;
  const boxes = regions
    .slice(0, 10)
    .map(
      (r, i) =>
        `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"/><text x="${r.x + 2}" y="${r.y + 12}">${i + 1}</text>`,
    )
    .join('');
  const regionRows = regions
    .slice(0, 10)
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>x ${r.x}&ndash;${r.x + r.width}, y ${r.y}&ndash;${r.y + r.height}</td><td>${r.pixels}</td></tr>`,
    )
    .join('');
  const figmaLink = scene.figma?.url ? ` &middot; <a href="${esc(scene.figma.url)}">Figma frame</a>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(scene.id)} visual diff</title>
<style>
:root{--fg:#1e1e1e;--muted:#6b6b6b;--line:#d9d9d9;--bad:#c62828;--ok:#2e7d32;--bg:#fff;--panel:#f7f7f7}
body{font:14px/1.5 system-ui,sans-serif;color:var(--fg);background:var(--bg);margin:0;padding:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px}
.status{font-weight:700}.FAIL{color:var(--bad)}.pass{color:var(--ok)}
.meta{color:var(--muted)}ul{padding-left:20px}li{margin:4px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
figure{margin:0;background:var(--panel);border:1px solid var(--line);padding:8px}
figcaption{color:var(--muted);font-size:12px;margin-bottom:6px}
.frame{position:relative;width:100%}.frame img,.frame svg{position:absolute;left:0;top:0;width:100%;height:100%}
.frame img{image-rendering:auto}
svg rect{fill:none;stroke:#e91e63;stroke-width:2}svg text{fill:#e91e63;font:700 12px system-ui}
table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:4px 8px;text-align:left}
input[type=range]{width:100%}
</style></head><body>
<h1>${esc(scene.id)}: <span class="status ${esc(status)}">${esc(status)}</span></h1>
<div class="meta">${esc(scene.module)} &rarr; ${esc(scene.export)}${figmaLink}</div>

<h2>Findings</h2>
${findings.length ? `<ul>${findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p>No differences above the limits.</p>'}

<h2>Figma and render, same scale</h2>
<div class="grid">
<figure><figcaption>Figma ${ew}&times;${eh} (changed regions outlined)</figcaption>
<div class="frame" style="aspect-ratio:${ew}/${eh}"><img src="${esc(files.expected)}" alt="Figma reference">
<svg viewBox="0 0 ${ew} ${eh}" preserveAspectRatio="none">${boxes}</svg></div></figure>
<figure><figcaption>Render ${aw}&times;${ah}</figcaption>
<div style="width:${(aw / ew) * 100}%"><div class="frame" style="aspect-ratio:${aw}/${ah}"><img src="${esc(files.actual)}" alt="Rendered screen"></div></div></figure>
</div>

<h2>Overlay (${esc(result.align)} aligned)</h2>
<input type="range" min="0" max="100" value="50" id="mix" aria-label="Render opacity">
<div class="meta">Left: Figma only. Right: render only.</div>
<div class="frame" style="aspect-ratio:${width}/${height};background:#ff00ff">
<img src="${esc(files.expected)}" alt="" style="left:${(ex / width) * 100}%;top:${(ey / height) * 100}%;width:${(ew / width) * 100}%;height:${(eh / height) * 100}%">
<img id="top" src="${esc(files.actual)}" alt="" style="opacity:.5;left:${(ax / width) * 100}%;top:${(ay / height) * 100}%;width:${(aw / width) * 100}%;height:${(ah / height) * 100}%">
</div>

<h2>Pixel diff</h2>
<div class="meta">Red: changed. Faded: unchanged. Magenta: only one image covers this area (size mismatch), not counted in the ratio.</div>
<figure><div class="frame" style="aspect-ratio:${width}/${height}"><img src="${esc(files.diff)}" alt="Pixel diff"></div></figure>

${files.contentDiff ? `<h2>Pixel diff with the background difference set aside</h2>
<div class="meta">The render's background repainted in Figma's colour, so content changes show through.</div>
<figure><div class="frame" style="aspect-ratio:${width}/${height}"><img src="${esc(files.contentDiff)}" alt="Pixel diff without background"></div></figure>` : ''}

${regionRows ? `<h2>Changed regions (Figma frame coordinates)</h2><table><tr><th>#</th><th>area</th><th>changed px</th></tr>${regionRows}</table>` : ''}
<script>document.getElementById('mix').oninput=e=>{document.getElementById('top').style.opacity=e.target.value/100}</script>
</body></html>
`;
}
