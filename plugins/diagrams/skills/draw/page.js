// Build the page around a diagram: one model, one layout, one look, one theme -> one self-contained HTML page.
//
//   node page.js MODEL.json [--layout C] [--look Blueprint] [--theme light|dark|auto] [--content PAGE.json] [--out OUT.html]
//       --layout   A Scroll-along, B Plate (Explainer); C Long read, D Incident review (Blog); E Reference, F Explorer (Wiki).
//                  A letter, a name or an id, any case. Default A.
//       --look     a style name or id, any case (Clear, Sketch, Blueprint, Isometric, Dark, Infographic). Default Clear.
//       --theme    light, dark, or auto (follows the reader's device). Default light, or dark for a look drawn on a dark
//                  ground (Blueprint, Dark). Every page also has its own Light / Dark / Auto toggle.
//       --content  the page's words (see pages/README.md); anything left out is written from the model.
//       --out      default: MODEL without .json, plus -page.html
//   node page.js MODEL.json --sheet layouts [--look LOOK] [--out DIR]     six layouts on one sheet, lettered and named
//   node page.js MODEL.json --sheet looks --layout X [--out DIR]          one layout in the six offered looks
//       each writes DIR/<id>-<sheet>.html (the pages side by side, live) and DIR/<id>-<sheet>.png
//   node page.js --list                                                   the six layouts and what each is for
//
// The diagram is drawn once per look, as two twins (light and dark) with no header band, and both are inlined with
// their ids prefixed per twin, so a theme change only swaps which twin shows. Needs python3, Node and Playwright with Chromium.
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const DM = require('./model.js');

const LAYOUTS = [
  { id: 'A', key: 'scroll-along', name: 'Scroll-along', group: 'Explainer', job: 'explain', face: null,
    blurb: 'The answer first, then the drawing held at the top of the screen while numbered steps scroll under it and light up their part.' },
  { id: 'B', key: 'plate', name: 'Plate', group: 'Explainer', job: 'explain', face: 'Archivo',
    blurb: 'A printed plate: the drawing edge to edge, each note sitting over the numbered zone it explains.' },
  { id: 'C', key: 'long-read', name: 'Long read', group: 'Blog', job: 'argue', face: 'Hanken Grotesk',
    blurb: 'A reading column with margin notes; the figure breaks out to full width and a second figure crops to the part a section argues about.' },
  { id: 'D', key: 'incident-review', name: 'Incident review', group: 'Blog', job: 'argue', face: 'IBM Plex Mono',
    blurb: 'A status strip, a small locator of the whole drawing, then a timeline that drives a full-size crop beside it.' },
  { id: 'E', key: 'reference', name: 'Reference', group: 'Wiki', job: 'look up', face: 'IBM Plex Mono',
    blurb: 'Lead and fact box, the drawing across the content width, then a table whose rows light up their path.' },
  { id: 'F', key: 'explorer', name: 'Explorer', group: 'Wiki', job: 'look up', face: 'Overpass',
    blurb: 'The drawing at full size in a pannable canvas, with a panel that says what any box is and what it talks to.' },
];
const THEMES = ['light', 'dark', 'auto'];
const OFFERED_ORDER = ['clear', 'sketch', 'blueprint', 'iso', 'dark', 'infographic'];

function layoutOf(x) {
  const k = String(x || 'A').trim().toLowerCase();
  return LAYOUTS.find(l => l.id.toLowerCase() === k || l.key === k || l.name.toLowerCase() === k || `${l.id} ${l.name}`.toLowerCase() === k) || null;
}
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const md = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

/* ------------------------------------------------------------ drawing the twins */
// Opens the model's preview page once; draw(look) gives both twins of that look, with no header band.
async function drawer(src) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) { console.error('page.js needs Playwright: npm i -g playwright && npx playwright install chromium'); process.exit(3); }
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-page-')), 'preview.html');
  try { execFileSync('python3', [path.join(__dirname, 'build.py'), 'preview', path.resolve(src), tmp], { stdio: ['ignore', 'ignore', 'inherit'] }); }
  catch (e) { process.exit(1); }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push('page error: ' + e.message));
  await page.goto('file://' + tmp);
  const styles = await page.evaluate(() => STYLES.map(s => ({ id: s.id, name: s.name, offered: s.offered })));
  const cache = {};
  async function draw(look) {
    const id = DM.lookId(styles, look);
    if (!id) { console.error(`no look "${look}". Looks: ${styles.filter(s => s.offered).map(s => s.name).join(', ')}`); process.exit(2); }
    if (cache[id]) return cache[id];
    const out = { id };
    for (const theme of ['light', 'dark']) {
      await page.goto(`file://${tmp}?style=${id}&theme=${theme}&header=0`);
      await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(120);
      out[theme] = await page.evaluate(() => {
        const svg = document.getElementById('main'), c = svg.cloneNode(true), S = themeStyle(cur, theme);
        c.removeAttribute('id'); c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        // the drawing's own faces (text inside badge art, such as the k8s "api" mark, falls back and does not count)
        const fams = [...new Set([...c.querySelectorAll('text')].filter(t => !t.closest('.badge')).map(t => (t.getAttribute('font-family') || '').split(',')[0].replace(/['"]/g, '').trim()).filter(Boolean))];
        return {
          svg: new XMLSerializer().serializeToString(c), w: +svg.dataset.w, h: +svg.dataset.h, bg: S.bg, ink: S.ink, fams,
          style: { name: cur.name, font: S.font, subFont: S.subFont || S.font, steps: !!(S.edge && S.edge.steps) },
          flows: DiagramModel.flowHues(S.bg), model: MODEL,
          overflow: [...svg.querySelectorAll('text[data-overflow]')].map(t => t.textContent),
        };
      });
      if (out[theme].overflow.length) errs.push(`${id} ${theme}: text too long for its box: ${out[theme].overflow.join(' | ')}`);
    }
    out.model = out.light.model;
    return (cache[id] = out);
  }
  async function fontFaces(fams) {
    return page.evaluate(fams => [...document.styleSheets[0].cssRules].filter(r => r instanceof CSSFontFaceRule && fams.includes(r.style.getPropertyValue('font-family').replace(/['"]/g, '').trim())).map(r => r.cssText).join('\n'), fams);
  }
  return { draw, fontFaces, styles, browser, errs };
}

// One twin, ready to inline: no width/height (CSS sizes it), every id prefixed so two twins (and two figures) never clash.
function prep(svg, prefix, cls, ink) {
  svg = svg.replace(/<svg\b([^>]*?)\swidth="[\d.]+"/, '<svg$1').replace(/<svg\b([^>]*?)\sheight="[\d.]+"/, '<svg$1');
  svg = svg.replace(/(\s)id="([^"]+)"/g, (m, s, id) => `${s}id="${prefix}${id}"`)
    .replace(/aria-labelledby="([^"]+)"/g, (m, ids) => `aria-labelledby="${ids.split(/\s+/).map(x => prefix + x).join(' ')}"`)
    .replace(/url\(#([^)]+)\)/g, (m, id) => `url(#${prefix}${id})`)
    .replace(/href="#([^"]+)"/g, (m, id) => `href="#${prefix}${id}"`);
  return svg.replace('<svg ', `<svg class="${cls}"${ink ? ` style="--dg-ink:${ink}"` : ''} `);
}

// The smallest scale that keeps every line label at 12 px or more on screen (STANDARD rule 8), never under the
// usual 85%. A layout opts in by setting --dg-min:var(--dg-lmin) on its figure.
function labelMin(tw) {
  const sizes = [tw.light.svg, tw.dark.svg].flatMap(svg => [...svg.matchAll(/<g class="edge-label"[^>]*>([\s\S]*?)<\/g>/g)]
    .flatMap(g => [...g[1].matchAll(/font-size="([\d.]+)"/g)].map(m => +m[1])));
  return sizes.length ? Math.max(.85, Math.min(1, 12 / Math.min(...sizes))) : .85;
}

function figure(tw, name, title) {
  const W = tw.light.w, H = tw.light.h, lmin = +labelMin(tw).toFixed(4);
  let l = prep(tw.light.svg, `${name}-l-`, 'dg-l', tw.light.ink), d = prep(tw.dark.svg, `${name}-d-`, 'dg-d', tw.dark.ink);
  if (title) l = l.replace(/(<title[^>]*>)[^<]*/, (m, a) => a + esc(title)), d = d.replace(/(<title[^>]*>)[^<]*/, (m, a) => a + esc(title));
  return `<div class="dg" data-dg="${name}" data-w="${W}" data-h="${H}" style="--dw:${W};--dh:${H};--dg-lmin:${lmin}">${l}${d}</div>`;
}

/* ------------------------------------------------------------ fonts: at most two families on a page */
const MONO = f => /Mono/.test(f);
function fonts(tw, layout) {
  const diag = [...new Set([tw.light.style.font, tw.light.style.subFont, tw.dark.style.font, tw.dark.style.subFont, ...tw.light.fams, ...tw.dark.fams])];
  const set = diag.slice();
  if (set.length < 2 && !set.includes('IBM Plex Sans')) set.push('IBM Plex Sans');
  if (set.length < 2 && layout.face && !set.includes(layout.face)) set.push(layout.face);
  if (set.length > 2) throw new Error(`look ${tw.id} uses ${set.length} font families (${set.join(', ')}); a page allows two`);
  const body = set.includes('IBM Plex Sans') ? 'IBM Plex Sans' : (set.find(f => !MONO(f)) || set[0]);
  const head = layout.face && set.includes(layout.face) && !MONO(layout.face) ? layout.face : body;
  const mono = set.find(MONO);
  const stack = (f, tail) => `'${f}', ${tail}`;
  return { set, vars: `--body:${stack(body, 'system-ui, sans-serif')}; --head:${stack(head, 'system-ui, sans-serif')}; --mono:${mono ? stack(mono, 'ui-monospace, monospace') : 'ui-monospace, monospace'};` };
}

/* ------------------------------------------------------------ the page's words, written from the model unless given */
function content(M, tw, given) {
  const byId = Object.fromEntries(M.nodes.map(n => [n.id, n]));
  const zones = M.zones || [];
  const numbered = z => { while (z && z.n === undefined) z = DM.parentZone(M, z); return z; };
  const zoneN = n => numbered(DM.zoneOf(M, n));
  const ends = M.edges.map(e => DM.ends(M, e));
  const words = e => DM.label(e);
  const top = zones.filter(z => z.n !== undefined).sort((a, b) => a.n - b.n);
  const inZone = z => M.nodes.filter(n => zoneN(n) === z).map(n => n.id);
  const zoneItems = top.map(z => {
    const ids = inZone(z);
    const edges = M.edges.map((e, i) => i).filter(i => ends[i][0] && ids.includes(ends[i][0].id));
    return { n: z.n, h: z.t, p: ids.map(id => byId[id].t + (byId[id].s && byId[id].s.length ? ` (${byId[id].s[0]})` : '')).join(', ') + '.', nodes: ids, edges, zone: z.id };
  });
  const stepped = M.edges.map((e, i) => ({ e, i })).filter(x => x.e.step).sort((a, b) => a.e.step - b.e.step);
  const useSteps = stepped.length > 0 && tw.light.style.steps;   // numbers on the page must be numbers on the drawing
  const stepItems = useSteps ? stepped.map(({ e, i }) => {
    const [a, b] = ends[i];
    return { n: e.step, h: a && b ? `${a.t} to ${b.t}` : `Step ${e.step}`, p: words(e) ? `${words(e)}.` : '', nodes: [a, b].filter(Boolean).map(n => n.id), edges: [i] };
  }) : zoneItems;
  const sections = zoneItems.map(z => ({ h: z.h, p: [z.p], chips: useSteps ? stepItems.filter(s => s.nodes[0] && z.nodes.includes(s.nodes[0])).map(s => s.n) : [z.n], nodes: z.nodes, crop: false }));
  // Long read: the last part small enough to crop gets its own full-size figure (a section's "crop": true).
  const small = sections.filter(s => s.nodes.length >= 2 && s.nodes.length <= 6).pop();
  if (small && sections.length > 1) small.crop = true;
  const flows = Object.entries(M.flows || {}).filter(([k]) => M.edges.some(e => e.f === k));
  // What moves on a line: its own label, else the label of another line in the same flow that ends at the same box,
  // else the flow's name with the line's kind as a suffix when it is dashed or dotted ("Answers coming back, async or
  // batch"), so no row is blank. The bare kind of line is said only when the flow has no name.
  const KIND = { '': 'solid line', async: 'dashed line (async or batch)', 'to confirm': 'dotted line (to confirm)' };
  const SUFFIX = { '': '', async: ', async or batch', 'to confirm': ', to confirm' };
  const moves = (i, idx, name) => {
    if (words(M.edges[i])) return words(M.edges[i]);
    const to = ends[i][1] && ends[i][1].id;
    const twin = to ? idx.find(j => j !== i && ends[j][1] && ends[j][1].id === to && words(M.edges[j])) : undefined;
    if (twin !== undefined) return words(M.edges[twin]);
    const kind = DM.lineKind(M.edges[i]);
    return name ? name + SUFFIX[kind] : KIND[kind];
  };
  const doors = flows.length ? flows.map(([k, f]) => {
    const idx = M.edges.map((e, i) => i).filter(i => M.edges[i].f === k);
    return { f: k, t: f.t, c: f.c, rows: idx.map(i => [ends[i][0] && ends[i][0].t, ends[i][1] && ends[i][1].t, moves(i, idx, f.t)]),
      nodes: [...new Set(idx.flatMap(i => ends[i].filter(Boolean).map(n => n.id)))], edges: idx };
  }) : zoneItems.map(z => ({ n: z.n, t: z.h, rows: z.nodes.map(id => [byId[id].t, (byId[id].s || []).join(', '), '']), nodes: z.nodes, edges: z.edges }));
  const tagged = Object.entries(M.tags || {}).map(([k, t]) => [t.t, M.nodes.filter(n => n.tag === k).map(n => n.t).join(', ')]).filter(x => x[1]);
  const facts = [['Type', M.type], ['Scope', M.scope], ['Updated', M.updated], ['Boxes', String(M.nodes.length)], ...tagged].filter(x => x[1]);
  const def = {
    title: M.title,
    answer: `This ${(M.type || 'diagram').toLowerCase()} covers ${M.scope || M.title}.${top.length ? ` It reads in ${top.length} parts: ${top.map(z => `${z.n} ${z.t}`).join(', ')}.` : ''}`,
    crumb: M.kicker || M.type || '',
    meta: [M.scope, M.updated && `checked ${M.updated}`].filter(Boolean).join(', '),
    caption: `${M.title}. ${useSteps ? 'The numbers on the drawing are the steps in the text.' : 'The numbers on the drawing are the zones in the text.'}`,
    steps: stepItems, notes: zoneItems, sections, doors, facts,
    timeline: stepItems.map(s => Object.assign({ time: useSteps ? `Step ${s.n}` : `Part ${s.n}` }, s)),
    impact: tagged.length ? tagged[0] : null,
    owners: {}, more: [],
  };
  const P = Object.assign(def, given || {});
  P.numbering = useSteps ? 'steps' : 'zones';
  P.flowHex = { light: tw.light.flows, dark: tw.dark.flows };
  return P;
}

/* ------------------------------------------------------------ one page */
function build(layout, tw, M, given, theme, faces) {
  const dir = path.join(__dirname, 'pages');
  let t = fs.readFileSync(path.join(dir, `${layout.id}-${layout.key}.html`), 'utf8');
  const P = content(M, tw, given);
  P.layout = layout.id; P.look = tw.light.style.name;
  const F = fonts(tw, layout);
  // @theme light {...} / @theme dark {...}: the template's tokens, written out for Auto and for the toggle.
  const ground = { light: tw.light.bg, dark: tw.dark.bg };
  t = t.replace(/@theme light \{([^}]*)\}/, (m, v) => `:root{${v.trim()} --dg-ground:${ground.light}; ${F.vars} color-scheme:light}`)
    .replace(/@theme dark \{([^}]*)\}/, (m, v) => `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${v.trim()} --dg-ground:${ground.dark}; color-scheme:dark}}\n:root[data-theme="dark"]{${v.trim()} --dg-ground:${ground.dark}; color-scheme:dark}`);
  const css = fs.readFileSync(path.join(dir, '_dg.css'), 'utf8'), js = fs.readFileSync(path.join(dir, '_dg.js'), 'utf8');
  const toggle = '<div class="dg-theme" role="group" aria-label="Theme"><button type="button" data-t="light">Light</button><button type="button" data-t="dark">Dark</button><button type="button" data-t="auto">Auto</button></div>';
  const json = o => JSON.stringify(o).replace(/</g, '\\u003c');
  const rep = {
    '<!--LANG-->': `<html lang="en"${theme === 'auto' ? '' : ` data-theme="${theme}"`} data-layout="${layout.id}" data-look="${tw.id}" data-fonts="${esc(F.set.join(','))}">`,
    '<!--TITLE-->': esc(P.title), '<!--ANSWER-->': md(P.answer), '<!--CRUMB-->': md(P.crumb), '<!--META-->': md(P.meta), '<!--CAPTION-->': md(P.caption),
    '/*FONTS*/': faces, '/*DGCSS*/': css, '<!--TOGGLE-->': toggle,
    '/*DGJS*/': `const PAGE = ${json(P)};\nconst MODEL = ${json(M)};\n${js}`,
  };
  for (const [k, v] of Object.entries(rep)) t = t.split(k).join(v);
  t = t.replace(/<!--FIG:(\w+)-->/g, (m, name) => figure(tw, name, P.title));
  const left = t.match(/<!--[A-Z]+(:\w+)?-->|\/\*(FONTS|DGCSS|DGJS)\*\/|@theme (light|dark)/);
  if (left) throw new Error(`${layout.key}: placeholder ${left[0]} left in the page`);
  return t;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
  if (argv.includes('--list')) {
    LAYOUTS.forEach(l => console.log(`${l.id}  ${l.name.padEnd(16)} ${l.group.padEnd(10)} for readers who need to ${l.job}\n   ${l.blurb}`));
    return;
  }
  const sheet = opt('sheet'), layoutArg = opt('layout'), look = opt('look', 'clear'), themeArg = opt('theme'), contentArg = opt('content'), outArg = opt('out');
  const src = argv[0];
  if (!src) { console.error('usage: node page.js MODEL.json [--layout A-F] [--look LOOK] [--theme light|dark|auto] [--content PAGE.json] [--out OUT.html]\n       node page.js MODEL.json --sheet layouts|looks [--layout X] [--out DIR]\n       node page.js --list'); process.exit(2); }
  if (themeArg && !THEMES.includes(themeArg)) { console.error('--theme must be light, dark or auto'); process.exit(2); }
  const layout = layoutOf(layoutArg);
  if (!layout) { console.error(`no layout "${layoutArg}". Layouts: ${LAYOUTS.map(l => `${l.id} ${l.name}`).join(', ')}`); process.exit(2); }
  let given = null;
  if (contentArg) { try { given = JSON.parse(fs.readFileSync(contentArg, 'utf8')); } catch (e) { console.error(`${contentArg}: ${e.message}`); process.exit(2); } }
  const D = await drawer(src);
  const stem = src.replace(/\.json$/, '');
  const faceFor = async (tw, l) => D.fontFaces(fonts(tw, l).set);
  // Rule 4, match the theme: a look that draws on a dark ground in both twins (Blueprint, Dark) gets a dark page
  // unless a theme was asked for.
  const themeFor = tw => themeArg || (DM.isDark(tw.light.bg) ? 'dark' : 'light');
  try {
    if (!sheet) {
      const tw = await D.draw(look);
      const theme = themeFor(tw);
      if (theme === 'light' && DM.isDark(tw.light.bg)) console.error(`note: ${tw.light.style.name} draws on a dark ground in both themes, so the drawing stays dark on this light page`);
      const html = build(layout, tw, tw.model, given, theme, await faceFor(tw, layout));
      const out = outArg || `${stem}-page.html`;
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, html);
      console.log(`${out}: layout ${layout.id} ${layout.name}, look ${tw.light.style.name}, theme ${theme}, ${Math.round(html.length / 1024)} KB`);
    } else {
      if (!['layouts', 'looks'].includes(sheet)) { console.error('--sheet must be layouts or looks'); process.exit(2); }
      const dir = outArg || path.dirname(path.resolve(src));
      fs.mkdirSync(dir, { recursive: true });
      const cells = [];
      if (sheet === 'layouts') {
        const tw = await D.draw(look);   // drawn once, used by all six layouts
        for (const l of LAYOUTS) cells.push({ letter: l.id, name: l.name, sub: `${l.group}: for readers who need to ${l.job}`, html: build(l, tw, tw.model, given, themeFor(tw), await faceFor(tw, l)) });
      } else {
        for (const id of OFFERED_ORDER) {
          const tw = await D.draw(id);
          cells.push({ letter: String(cells.length + 1), name: tw.light.style.name, sub: `${layout.id} ${layout.name} in ${tw.light.style.name}`, html: build(layout, tw, tw.model, given, themeFor(tw), await faceFor(tw, layout)) });
        }
      }
      const M = (await D.draw(look)).model;
      const base = path.join(dir, `${M.id}-${sheet === 'layouts' ? 'layouts' : 'looks-' + layout.id}`);
      await contactSheet(D.browser, cells, base, sheet === 'layouts' ? `${M.title}: six page layouts` : `${M.title}: layout ${layout.id} ${layout.name} in six looks`,
        sheet === 'layouts' ? 'Pick a letter. Explainer pages explain, Blog pages argue a point, Wiki pages let people look things up.' : 'Pick a look by its name. The page and the drawing switch theme together on every one.');
      console.log(`${base}.html and ${base}.png`);
    }
  } finally { await D.browser.close(); }
  if (D.errs.length) { console.error(D.errs.join('\n')); process.exit(1); }
}

// Six pages side by side: each is shot at a 1440 px desktop window, then the shots go on one lettered sheet.
async function contactSheet(browser, cells, base, title, lede) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-sheet-'));
  for (const c of cells) {
    const f = path.join(tmp, c.letter + '.html'); fs.writeFileSync(f, c.html);
    const p = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await p.goto('file://' + f); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(250);
    c.png = (await p.screenshot()).toString('base64'); await p.close();
  }
  const sheet = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>:root{--bg:#f4f3ef; --ink:#1c1c1a; --muted:#5c5b55; --rule:#d9d7cf; color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#151513; --ink:#ebeae4; --muted:#a5a39a; --rule:#36352f; color-scheme:dark}}
*{box-sizing:border-box} body{margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, sans-serif; padding:28px 16px 40px}
h1{font-size:26px; margin:0 0 4px} p{margin:0 0 22px; color:var(--muted)}
.grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,440px),1fr)); gap:26px}
figure{margin:0} img{display:block; width:100%; border:1px solid var(--rule); border-radius:6px}
figcaption{display:flex; gap:12px; align-items:baseline; margin-top:10px}
figcaption b{display:inline-grid; place-items:center; min-width:34px; height:34px; border-radius:17px; background:var(--ink); color:var(--bg); font-size:18px}
figcaption span{font-weight:700; font-size:18px} figcaption small{display:block; font-weight:400; font-size:14px; color:var(--muted)}</style></head>
<body><h1>${esc(title)}</h1><p>${esc(lede)}</p><div class="grid">${cells.map(c => `<figure><img alt="${esc(c.name)}" src="data:image/png;base64,${c.png}"><figcaption><b>${esc(c.letter)}</b><span>${esc(c.name)}<small>${esc(c.sub)}</small></span></figcaption></figure>`).join('')}</div></body></html>`;
  fs.writeFileSync(base + '.html', sheet);
  const p = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
  await p.goto('file://' + path.resolve(base + '.html')); await p.waitForTimeout(200);
  await p.screenshot({ path: base + '.png', fullPage: true }); await p.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { LAYOUTS, layoutOf, prep, fonts, content, build, drawer };
