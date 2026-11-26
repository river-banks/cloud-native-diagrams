// The picture gallery: every kind of diagram, every page layout, every look and the page combinations, as pictures
// a person can point at, each labelled with the words to ask for it. Every picture is drawn here from the example
// model and the kind example pages, in light and in dark (never a CSS invert), so the gallery is rebuilt, not drawn by hand.
//
//   node gallery.js [--model MODEL.json] [--out DIR]
//       writes DIR/gallery.html (self-contained: the pictures are inlined, with a Light / Dark / Auto toggle and
//       filter chips) and DIR/thumbs/gallery.png and gallery-dark.png (the same gallery as one picture, for a
//       surface that cannot show HTML). DIR defaults to this folder; MODEL to examples/incident-response.json.
//
// Needs python3, Node and Playwright with Chromium. Takes about a minute: 6 looks x 6 layouts x 2 themes of pages.
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { LAYOUTS, build, drawer, fonts } = require('./page.js');

const LOOKS = ['clear', 'sketch', 'blueprint', 'iso', 'dark', 'infographic'];
const THEMES = ['light', 'dark'];
const SHOT = { width: 1440, height: 900 };   // every picture is a 16:10 window, shrunk to THUMB
const THUMB = { width: 640, height: 400 };
// The kinds of picture. Statechart and Field Notes are whole pages with their own look; the skill carries their
// reference pages (kinds/ in the skill, statechart/ and explainers/ in the cloud-native-diagrams repo).
const KINDS = [
  { id: 'map', n: 1, name: 'Map', ask: 'a diagram of <system>',
    good: 'Architecture, data flow, deployment: the parts and what talks to what. The default; takes any look and any page layout.' },
  { id: 'sequence', n: 2, name: 'Sequence', ask: 'a sequence diagram of <system>',
    good: 'One request in time order: the numbered steps of a map, one lane per part. Takes any look.' },
  { id: 'statechart', n: 3, name: 'Statechart', ask: 'a statechart page of <workflow>',
    page: ['kinds/statechart/example/blended-skills.html', '../statechart/example/blended-skills.html'],
    good: 'A process with stages and handoffs: states, the events that move it on, who acts when. Its own look.' },
  { id: 'field-notes', n: 4, name: 'Field Notes', ask: 'a Field Notes page of <workflow>',
    page: ['kinds/field-notes/example/field-notes.html', '../explainers/example/field-notes.html'],
    good: 'A friendly picture of a lived workflow: people walk between rooms and a courier carries the work. Its own look.' },
];
// The curated mixes shown first in "Mix them": [layout letter, or map / sequence for a drawing alone, look id].
const PICKS = [['B', 'sketch'], ['B', 'clear'], ['C', 'blueprint'], ['D', 'dark'], ['E', 'infographic'], ['F', 'iso'],
  ['A', 'sketch'], ['C', 'clear'], ['map', 'sketch'], ['sequence', 'blueprint']];

const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
  const src = path.resolve(opt('model', path.join(__dirname, 'examples', 'incident-response.json')));
  const out = path.resolve(opt('out', __dirname));
  const kindPage = k => k.page.map(p => path.join(__dirname, p)).find(p => fs.existsSync(p));
  // A kind whose reference page is not here is left out (the public copy ships without them); check-gallery.js
  // holds the repo's gallery to every kind.
  const kinds = KINDS.filter(k => !k.page || kindPage(k));
  for (const k of KINDS.filter(k => !kinds.includes(k))) console.error(`gallery.js: no example page for ${k.name} (looked for ${k.page.join(', ')}), so the gallery leaves it out`);

  const D = await drawer(src);
  const browser = D.browser, errs = D.errs, img = {};
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-gallery-'));
  const preview = path.join(tmp, 'preview.html');
  execFileSync('python3', [path.join(__dirname, 'build.py'), 'preview', src, preview], { stdio: ['ignore', 'ignore', 'inherit'] });
  const shrinker = await browser.newPage();
  // A full-size PNG in, a THUMB-sized WebP data URI out (one copy per picture; the page reuses it by key).
  const shrink = png => shrinker.evaluate(async ([b64, W, H]) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, W, H);
    return cv.toDataURL('image/webp', 0.82);
  }, [png.toString('base64'), THUMB.width, THUMB.height]);
  async function shoot(file, theme, url) {
    const ctx = await browser.newContext({ viewport: SHOT, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce' });
    await ctx.route(/^https?:/, r => r.abort());   // the kind pages link web fonts; draw offline with their fallbacks
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`${path.basename(file)} ${theme}: ${e.message}`));
    await p.goto(url || 'file://' + file); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
    const png = await p.screenshot();
    await ctx.close();
    return shrink(png);
  }
  // A drawing alone (a look, or the sequence view), centred on its own ground in the 16:10 window.
  async function drawing(look, view, theme) {
    const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    p.on('pageerror', e => errs.push(`${look} ${view} ${theme}: ${e.message}`));
    await p.goto(`file://${preview}?style=${look}&theme=${theme}&view=${view}`);
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(150);
    const r = await p.evaluate(() => ({ svg: diagramSVG(), bg: themeStyle(cur, theme).bg }));
    await p.close();
    const f = path.join(tmp, `${look}-${view}-${theme}.html`);
    fs.writeFileSync(f, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:${r.bg}}body{display:grid;place-items:center;padding:28px;box-sizing:border-box}svg{display:block;width:100%;height:100%}</style>${r.svg}`);
    return shoot(f, theme);
  }

  try {
    for (const look of LOOKS) {
      const tw = await D.draw(look);
      for (const theme of THEMES) {
        (img[`map:${look}`] = img[`map:${look}`] || {})[theme] = await drawing(look, 'map', theme);
        for (const L of LAYOUTS) {
          const f = path.join(tmp, `${L.id}-${look}-${theme}.html`);
          fs.writeFileSync(f, build(L, tw, tw.model, null, theme, await D.fontFaces(fonts(tw, L).set)));
          (img[`page:${L.id}:${look}`] = img[`page:${L.id}:${look}`] || {})[theme] = await shoot(f, theme);
        }
      }
      process.stderr.write(`gallery: ${look} drawn\n`);
    }
    for (const theme of THEMES) {
      for (const look of LOOKS) (img[`sequence:${look}`] = img[`sequence:${look}`] || {})[theme] = await drawing(look, 'sequence', theme);
      for (const k of kinds.filter(k => k.page)) (img[`kind:${k.id}`] = img[`kind:${k.id}`] || {})[theme] = await shoot(kindPage(k), theme);
    }
    const styles = fs.readdirSync(path.join(__dirname, 'styles')).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(__dirname, 'styles', f), 'utf8')));
    const model = (await D.draw('clear')).model;
    const html = page({ model, styles, img, kinds });
    fs.mkdirSync(path.join(out, 'thumbs'), { recursive: true });
    const file = path.join(out, 'gallery.html');
    fs.writeFileSync(file, html);
    // The PNG contact sheets: the gallery itself, one per theme, at a desktop width.
    for (const theme of THEMES) {
      const p = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
      p.on('pageerror', e => errs.push(`gallery.html ${theme}: ${e.message}`));
      await p.goto(`file://${file}?theme=${theme}&sheet=1`); await p.waitForTimeout(400);
      await p.screenshot({ path: path.join(out, 'thumbs', theme === 'dark' ? 'gallery-dark.png' : 'gallery.png'), fullPage: true });
      await p.close();
    }
    console.log(`${file} (${Math.round(html.length / 1024)} KB), thumbs/gallery.png and thumbs/gallery-dark.png`);
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
}

// The gallery page. Pictures live once in IMG (key -> [light, dark]); cards name a key, so a picture used in two
// sections is inlined once. Each card shows both twins' <img>; CSS shows the one for the theme on show.
function page({ model, styles, img, kinds = KINDS }) {
  const look = id => styles.find(s => s.id === id);
  const lookName = id => look(id).name;
  const L = id => LAYOUTS.find(l => l.id === id);
  const G = {
    kinds: kinds.map(k => ({ n: k.n, name: k.name, ask: k.ask, good: k.good, img: k.page ? `kind:${k.id}` : k.id === 'map' ? 'map:clear' : 'sequence:clear' })),
    layouts: LAYOUTS.map(l => ({ id: l.id, name: l.name, group: l.group, job: l.job, blurb: l.blurb, img: `page:${l.id}:clear` })),
    looks: LOOKS.map(id => ({ id, name: lookName(id), good: look(id).good, img: `map:${id}` })),
    picks: PICKS.map(([a, b]) => a.length === 1 ? { layout: a, look: b } : { kind: a, look: b }),
    names: Object.fromEntries(LOOKS.map(id => [id, lookName(id)])),
    layoutNames: Object.fromEntries(LAYOUTS.map(l => [l.id, l.name])),
  };
  for (const p of G.picks) if (p.layout && !L(p.layout)) throw new Error(`pick: no layout ${p.layout}`);
  const IMG = Object.fromEntries(Object.entries(img).map(([k, v]) => [k, [v.light, v.dark]]));
  const json = o => JSON.stringify(o).replace(/</g, '\\u003c');
  const toggleJs = fs.readFileSync(path.join(__dirname, 'pages', '_toggle.js'), 'utf8');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diagram gallery</title>
<meta name="description" content="Every kind of diagram, page layout and look, and the mixes, as pictures labelled with the words to ask for them.">
<style>
:root{--bg:#f4f3ef; --card:#ffffff; --ink:#1c1c1a; --muted:#5c5b55; --rule:#d9d7cf; --accent:#c2185b; --chip:#ffffff; color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#151513; --card:#1f1f1c; --ink:#ebeae4; --muted:#a5a39a; --rule:#3a3933; --accent:#ff7aa8; --chip:#1f1f1c; color-scheme:dark}}
:root[data-theme="dark"]{--bg:#151513; --card:#1f1f1c; --ink:#ebeae4; --muted:#a5a39a; --rule:#3a3933; --accent:#ff7aa8; --chip:#1f1f1c; color-scheme:dark}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif}
main{max-width:1480px; margin:0 auto; padding:24px 16px 56px}
.top{display:flex; flex-wrap:wrap; gap:12px 20px; align-items:center; justify-content:space-between}
h1{font-size:clamp(28px, 4vw, 42px); line-height:1.1; margin:0; letter-spacing:-.01em}
h2{font-size:22px; margin:44px 0 4px} h2 b{color:var(--accent)}
p{margin:0} .lede{max-width:820px; color:var(--muted); margin:10px 0 0; font-size:17px} .sub{color:var(--muted); margin:0 0 16px; max-width:820px}
code{font:600 14px/1.3 ui-monospace, 'SF Mono', Menlo, Consolas, monospace}
.grid{display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap:22px}
.card{margin:0; background:var(--card); border:1px solid var(--rule); border-radius:8px; overflow:hidden; display:flex; flex-direction:column}
.shot{aspect-ratio:16/10; background:var(--rule); border-bottom:1px solid var(--rule)}
.shot img{display:block; width:100%; height:100%; object-fit:cover}
.shot img.d{display:none}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .shot img.l{display:none} :root:not([data-theme="light"]) .shot img.d{display:block}}
:root[data-theme="dark"] .shot img.l{display:none} :root[data-theme="dark"] .shot img.d{display:block}
figcaption{padding:12px 14px 14px; display:grid; grid-template-columns:auto 1fr; gap:4px 12px; align-items:start}
figcaption .n{grid-row:span 3; display:inline-grid; place-items:center; min-width:34px; height:34px; padding:0 6px; border-radius:17px; background:var(--ink); color:var(--bg); font-weight:700; font-size:17px}
figcaption .t{font-weight:700; font-size:17px; line-height:1.25}
figcaption .g{color:var(--muted); font-size:14px; line-height:1.4}
figcaption .say{font-size:14px} figcaption .say code{color:var(--accent)}
.chips{display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:12px 0 18px}
.chips .k{font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 2px 0 8px}
.chips .k:first-child{margin-left:0}
.chips button{font:inherit; font-size:14px; font-weight:600; padding:5px 12px; border:1.5px solid var(--ink); border-radius:16px; background:var(--chip); color:var(--ink); cursor:pointer}
.chips button[aria-pressed="true"]{background:var(--ink); color:var(--bg)}
.dg-theme{display:inline-flex; border:1px solid var(--rule); border-radius:6px; overflow:hidden; font:600 13px/1 system-ui, sans-serif}
.dg-theme button{all:unset; cursor:pointer; padding:8px 11px; color:var(--muted); background:var(--card)}
.dg-theme button + button{border-left:1px solid var(--rule)}
.dg-theme button[aria-pressed="true"]{color:var(--ink); box-shadow:inset 0 -3px 0 var(--accent)}
button:focus-visible, .dg-theme button:focus-visible{outline:3px solid var(--accent); outline-offset:2px}
.notes{color:var(--muted); font-size:14px; margin-top:36px; max-width:900px}
.empty{color:var(--muted)}
html.sheet .chips, html.sheet .dg-theme, html.sheet .notes{display:none}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<main>
  <div class="top"><h1>Pick a diagram by picture</h1>
  <div class="dg-theme" role="group" aria-label="Theme: the page and every picture"><button type="button" data-t="light">Light</button><button type="button" data-t="dark">Dark</button><button type="button" data-t="auto">Auto</button></div></div>
  <p class="lede">Point at what you like and say the words under it. Mix freely: a kind, a page layout and a look, in Light or Dark. Every picture here is the same system, ${esc(model.title)}, drawn from one model. Nothing named means Clear, the house standard.</p>

  <h2><b>1</b> Kind: what sort of picture</h2>
  <p class="sub">Most diagrams are a Map. Pick Sequence for one request in time order${kinds.some(k => k.page) ? ', Statechart or Field Notes for a process people move through' : ''}.</p>
  <div class="grid" id="kinds"></div>

  <h2><b>2</b> Layout: the page around it <span style="font-weight:400;color:var(--muted)">(optional)</span></h2>
  <p class="sub">For a page, an explainer, a blog post or a wiki page built around a Map. Explainer pages explain, Blog pages argue a point, Wiki pages let people look things up. Shown in Clear.</p>
  <div class="grid" id="layouts"></div>

  <h2><b>3</b> Look</h2>
  <p class="sub">Clear is the default. Any Map, Sequence or page can be drawn in any of these.</p>
  <div class="grid" id="looks"></div>

  <h2><b>4</b> Mix them</h2>
  <p class="sub">A layout in a look, or a drawing in a look. Our picks first; pick a layout, a look or both to see every mix.</p>
  <div class="chips" id="filters" role="group" aria-label="Filter the mixes"></div>
  <div class="grid" id="mixes" aria-live="polite"></div>

  <p class="notes">Every picture is drawn by <code>node diagrams/gallery.js</code> from the example model${kinds.some(k => k.page) ? ' and the kind example pages' : ''}, in Light and in Dark. Every page built from these (and the style picker and preview) has the same Light / Dark / Auto toggle; it switches the whole page with its drawings and is remembered per page.</p>
</main>
<script>${toggleJs}</script>
<script>
const IMG = ${json(IMG)};
const G = ${json(G)};
const qs = new URLSearchParams(location.search);
if (qs.get('sheet')) document.documentElement.classList.add('sheet');
dgToggle({ fixed: ['light', 'dark', 'auto'].includes(qs.get('theme')) ? qs.get('theme') : null });
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function card(c) {
  const [l, d] = IMG[c.img] || [];
  return \`<figure class="card" data-key="\${esc(c.img)}"><div class="shot"><img class="l" alt="\${esc(c.alt)}" src="\${l}"><img class="d" alt="\${esc(c.alt)} (dark)" src="\${d}"></div>
<figcaption><span class="n">\${esc(c.n)}</span><span class="t">\${esc(c.title)}</span><span class="g">\${esc(c.good)}</span><span class="say">Say <code>\${esc(c.say)}</code></span></figcaption></figure>\`;
}
const mixCard = m => m.layout
  ? { n: m.layout, img: \`page:\${m.layout}:\${m.look}\`, title: \`\${G.layoutNames[m.layout]} + \${G.names[m.look]}\`, alt: \`Layout \${m.layout} \${G.layoutNames[m.layout]} in the \${G.names[m.look]} look\`,
      good: \`Layout \${m.layout} \${G.layoutNames[m.layout]}, drawn in \${G.names[m.look]}.\`, say: \`page, \${G.layoutNames[m.layout]}, \${G.names[m.look]}\` }
  : { n: m.kind === 'map' ? '1' : '2', img: \`\${m.kind}:\${m.look}\`, title: \`\${m.kind === 'map' ? 'Map' : 'Sequence'} + \${G.names[m.look]}\`, alt: \`\${m.kind === 'map' ? 'Map' : 'Sequence'} in the \${G.names[m.look]} look\`,
      good: \`The drawing alone, no page, in \${G.names[m.look]}.\`, say: \`\${m.kind === 'map' ? 'a diagram' : 'a sequence diagram'}, \${G.names[m.look]}\` };
document.getElementById('kinds').innerHTML = G.kinds.map(k => card({ n: k.n, img: k.img, title: k.name, alt: \`\${k.name}: an example\`, good: k.good, say: k.ask })).join('');
document.getElementById('layouts').innerHTML = G.layouts.map(l => card({ n: l.id, img: l.img, title: \`\${l.name} (\${l.group})\`, alt: \`Layout \${l.id} \${l.name}\`, good: l.blurb, say: \`page, \${l.name}\` })).join('');
document.getElementById('looks').innerHTML = G.looks.map((k, i) => card({ n: i + 1, img: k.img, title: k.name + (k.id === 'clear' ? ' (default)' : ''), alt: \`The example map in \${k.name}\`, good: k.good, say: k.id === 'clear' ? 'a diagram (Clear is the default)' : \`in \${k.name}\` })).join('');
// Mix: no filter shows our picks; a layout and/or a look shows every page that matches (and, for a look alone, the map and sequence in it).
let fLayout = null, fLook = null;
const filters = document.getElementById('filters');
filters.innerHTML = '<button type="button" data-f="picks">Our picks</button><span class="k">Layout</span>'
  + G.layouts.map(l => \`<button type="button" data-layout="\${l.id}" title="\${esc(l.name)}">\${l.id} \${esc(l.name)}</button>\`).join('')
  + '<span class="k">Look</span>' + G.looks.map(k => \`<button type="button" data-look="\${k.id}">\${esc(k.name)}</button>\`).join('');
function mixes() {
  let list;
  if (!fLayout && !fLook) list = G.picks;
  else {
    list = G.layouts.filter(l => !fLayout || l.id === fLayout).flatMap(l => G.looks.filter(k => !fLook || k.id === fLook).map(k => ({ layout: l.id, look: k.id })));
    if (fLook && !fLayout) list = list.concat([{ kind: 'map', look: fLook }], IMG[\`sequence:\${fLook}\`] ? [{ kind: 'sequence', look: fLook }] : []);
  }
  document.getElementById('mixes').innerHTML = list.map(m => card(mixCard(m))).join('') || '<p class="empty">Nothing matches.</p>';
  filters.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === 'picks' ? !fLayout && !fLook : b.dataset.layout ? b.dataset.layout === fLayout : b.dataset.look === fLook)));
}
filters.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.f) fLayout = fLook = null;
  if (b.dataset.layout) fLayout = fLayout === b.dataset.layout ? null : b.dataset.layout;
  if (b.dataset.look) fLook = fLook === b.dataset.look ? null : b.dataset.look;
  mixes();
});
mixes();
</script>
</body>
</html>
`;
}

if (require.main === module) main().catch(e => { console.error(e.stack || e); process.exit(1); });
module.exports = { KINDS, PICKS, LOOKS };
