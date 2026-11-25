// Render every style x every example in picker.html and fail on anything broken.
//   node check.js            check only
//   node check.js shots/     also save one PNG per style x example into shots/
//   node check.js --thumbs   also rewrite thumbs/: one PNG per style and contact-sheet.png (the plugin shows these)
// Fails on: page errors, text that cannot shrink to fit its box, a node badge that drew nothing,
// a style that renders no shapes, horizontal page scroll on a phone, a diagram with no accessible
// title and description, a style whose text is under 4.5:1 or whose lines and zone edges are under 3:1
// against what they sit on, a main path that looks the same as other lines in greyscale, any text under
// 12 px (node titles and sub-lines, tags, key, zone and line labels: STANDARD rule 8, no exemptions),
// and a line label with no clear spot (it would sit on a box, a zone title or another label; in the
// isometric style on a block, a standing badge, a plate title or another label), naming what it sits on.
// With shots/ it also saves a greyscale copy of each style (<example>-<style>-grey.png) to look at.
const { chromium } = require('playwright');
const path = require('path');
const DM = require('./model.js');

(async () => {
  const file = 'file://' + path.join(__dirname, 'picker.html');
  const thumbs = process.argv.includes('--thumbs');
  const shots = process.argv.slice(2).find(a => a !== '--thumbs');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push('page error: ' + e.message));
  page.on('console', m => m.type() === 'error' && errs.push('console: ' + m.text()));

  await page.goto(file);
  const { styles, examples } = await page.evaluate(() => ({ styles: STYLES.map(s => s.id), examples: EXAMPLES.map(m => m.id) }));
  // Contrast, from the style tokens (WCAG 2.2: 4.5:1 for text, 3:1 for lines and shapes that carry meaning).
  const lum = hex => { const n = parseInt(hex.slice(1), 16); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(n >> 16) + .7152 * f(n >> 8 & 255) + .0722 * f(n & 255); };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const allStyles = await page.evaluate(() => STYLES.flatMap(s => [s, Object.assign(themeStyle(s, 'dark'), { id: s.id + ' (dark)' })]));
  for (const S of allStyles) {
    const solid = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
    const need = (what, a, b, min) => { if (solid(a) && solid(b) && cr(a, b) < min) errs.push(`${S.id}: ${what} ${a} on ${b} is ${cr(a, b).toFixed(2)}:1, needs ${min}:1`); };
    const nodeBg = solid(S.node.fill) ? S.node.fill : S.bg;
    need('text', S.ink, S.bg, 4.5); need('role text', S.sub, S.bg, 4.5); need('text in boxes', S.ink, nodeBg, 4.5); need('role text in boxes', S.sub, nodeBg, 4.5);
    need('lines', S.edge.c, S.bg, 3); if (S.edge.hot) need('main path', [S.edge.hot.c, S.edge.hot.under].filter(solid).sort((a, b) => cr(b, S.bg) - cr(a, S.bg))[0], S.bg, 3);
    for (const [name, c] of Object.entries(DM.flowHues(S.bg))) need(`${name} flow`, c, S.bg, 3);
    for (const [c, p] of Object.entries(S.pal)) {
      if (!p.stroke) continue;
      const under = p.fill || S.zone.fill || S.bg;
      need(`${c} zone edge`, p.stroke, under, 3);
      if (S.zone.mode === 'header') need(`${c} zone title`, '#ffffff', p.stroke, 3);
    }
    // Greyscale: the main path has to stand out by width or lightness, not by hue alone.
    const hot = S.edge.hot || { c: S.edge.c, sw: S.edge.sw * 1.9 };
    if (hot.sw / S.edge.sw < 1.4 && !hot.under && Math.abs(lum(hot.c) - lum(S.edge.c)) < .15) errs.push(`${S.id}: in greyscale the main path looks like any other line`);
  }

  const withSteps = await page.evaluate(() => EXAMPLES.filter(m => m.edges.some(e => e.step)).map(m => m.id));
  const runs = [];
  for (const ex of examples) for (const st of styles) for (const th of ['light', 'dark']) runs.push([ex, st, th, 'map']);
  for (const ex of withSteps) for (const st of styles) runs.push([ex, st, 'light', 'sequence']);
  for (const [ex, st, th, view] of runs) {
    await page.goto(`${file}?style=${st}&example=${ex}&theme=${th}&view=${view}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const svg = document.getElementById('main');
      const want = shown().nodes.filter(n => n.b).map(n => n.b);
      const empty = [...svg.querySelectorAll('g.badge')].filter(g => !g.querySelector('path, rect, circle, svg')).map(g => g.dataset.badge);
      const ids = (svg.getAttribute('aria-labelledby') || '').split(' ').filter(Boolean);
      return {
        a11y: svg.getAttribute('role') === 'img' && ids.length === 2 && ids.every(i => (svg.querySelector('#' + i) || {}).textContent),
        overflow: [...svg.querySelectorAll('text[data-overflow]')].map(t => t.textContent),
        shapes: svg.querySelectorAll('rect, path, circle').length,
        badges: svg.querySelectorAll('g.badge').length, want: want.length, empty,
        // STANDARD rule 8: every text element at least 12 px (no exemptions), named by its data-kind from render.js
        small: [...svg.querySelectorAll('text, tspan')].filter(t => t.hasAttribute('font-size') && parseFloat(t.getAttribute('font-size')) < 12 && t.textContent.trim())
          .map(t => `${t.closest('[data-kind]:is(text, tspan)')?.dataset.kind || t.closest('g[class]')?.getAttribute('class') || 'text'} "${t.textContent}" (${parseFloat(t.getAttribute('font-size'))} px)`),
        // and a label the renderer couldn't place clear of boxes, zone titles and other labels
        crowded: [...svg.querySelectorAll('.edge-label[data-crowded]')].map(g => `${[...g.querySelectorAll('text')].map(t => t.textContent).join(' / ')} (on ${g.dataset.crowded})`),
      };
    });
    const tag = `${ex} / ${st}${th === 'dark' ? ' / dark' : ''}${view === 'sequence' ? ' / sequence' : ''}`;
    if (r.overflow.length) errs.push(`${tag}: text too long for its box: ${r.overflow.join(' | ')}`);
    if (r.shapes < 20) errs.push(`${tag}: drew almost nothing (${r.shapes} shapes)`);
    if (r.badges < r.want) errs.push(`${tag}: ${r.want - r.badges} node badges missing`);
    if (r.empty.length) errs.push(`${tag}: badges drew nothing: ${r.empty.join(', ')}`);
    if (r.small.length) errs.push(`${tag}: text under 12 px: ${r.small.join(' | ')}`);
    if (r.crowded.length) errs.push(`${tag}: line labels with no clear spot: ${r.crowded.join(' | ')}`);
    if (!r.a11y) errs.push(`${tag}: the SVG has no accessible title and description (role img, aria-labelledby title and desc)`);
    if (shots) {
      const stem = `${ex}-${st}${th === 'dark' ? '-dark' : ''}${view === 'sequence' ? '-sequence' : ''}`;
      await page.locator('#main').screenshot({ path: path.join(shots, `${stem}.png`) });
      if (th === 'light' && view === 'map') {
        await page.addStyleTag({ content: '#main { filter: grayscale(1); }' });
        await page.locator('#main').screenshot({ path: path.join(shots, `${stem}-grey.png`) });
      }
    }
  }

  // Every badge and glyph in the library must draw something visible.
  await page.goto(file); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(150);
  const blank = await page.evaluate(() => [...document.querySelectorAll('#lib figure')].filter(f => {
    const b = f.querySelector('svg g.badge, svg g[transform]'); if (!b) return true;
    const r = b.getBBox(); return r.width < 4 || r.height < 4;
  }).map(f => f.querySelector('code').textContent));
  if (blank.length) errs.push(`badge library: drew nothing for ${blank.join(', ')}`);
  // Glyphs are drawn on a 24 x 24 grid; anything far outside it was converted wrong.
  const stray = await page.evaluate(() => Object.entries(GLYPHS).filter(([, d]) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); document.body.appendChild(s);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.appendChild(p);
    const r = p.getBBox(); s.remove();
    return r.x < -1 || r.y < -1 || r.x + r.width > 25 || r.y + r.height > 25;
  }).map(([n]) => n));
  if (stray.length) errs.push(`glyphs outside the 24 x 24 grid: ${stray.join(', ')}`);
  if (thumbs) {
    const fs = require('fs'), dir = path.join(__dirname, 'thumbs');
    fs.mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.goto(file); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
    await page.locator('#grid').screenshot({ path: path.join(dir, 'contact-sheet.png') });
    for (const st of styles) await page.locator(`#grid .thumb[data-id="${st}"]`).screenshot({ path: path.join(dir, `${st}.png`) });
    console.log(`thumbs/: contact-sheet.png and ${styles.length} style thumbnails`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(file); await page.waitForTimeout(150);
  const sx = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (sx > 0) errs.push(`phone width: page scrolls sideways by ${sx}px`);
  await browser.close();

  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log(`ok: ${styles.length} styles x ${examples.length} examples rendered clean`);
})();
