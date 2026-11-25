// Check the page templates (pages/, built by page.js) in a real browser. Fails on:
//   a page error or a placeholder left in the page; a diagram shown under 85% of its drawn width at a 1440 px
//   window (the locator in layout D is exempt: it is marked data-locator and only finds the place);
//   a .dg box without exactly two top-level twins, or any <svg> nested inside a diagram (page code must be able
//   to select the diagrams alone); a badge outside its .node; a theme toggle that does not swap page and drawing
//   together, or that redraws (the twins must be the same elements, unchanged); Auto not following the device;
//   more than two font families loaded, or IBM Plex Sans missing on a Clear page; an accent colour with a hue in
//   150-260 or 15-40 (design-with-mobbin), in either theme; sideways page scroll at phone width (390 px).
//   node check-pages.js [OUTDIR]      every layout x every offered look on incident-response, and the six layouts on
//                                     lab-access and the wide kubernetes-platform drawing; with OUTDIR it keeps the pages
const fs = require('fs'), os = require('os'), path = require('path');
const { LAYOUTS, build, drawer, fonts } = require('./page.js');
const LOOKS = ['clear', 'sketch', 'blueprint', 'iso', 'dark', 'infographic'];
// incident-response (numbered steps) in every look, lab-access (named flows; not in the public copy) and the wide
// kubernetes-platform drawing in Clear.
const RUNS = [['incident-response', LOOKS], ['lab-access', ['clear']], ['kubernetes-platform', ['clear']]]
  .filter(([id]) => fs.existsSync(path.join(__dirname, 'examples', id + '.json')));
const keep = process.argv[2];
const dir = keep || fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-pages-'));
fs.mkdirSync(dir, { recursive: true });

const hue = css => {
  const m = css.trim().match(/^#([0-9a-f]{6})$/i); if (!m) return null;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < .15) return null;   // greys carry no hue
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

(async () => {
  const errs = [];
  let n = 0;
  for (const [id, looks] of RUNS) {
    const D = await drawer(path.join(__dirname, 'examples', id + '.json'));
    const browser = D.browser;
    for (const look of looks) {
      const tw = await D.draw(look);
      for (const L of LAYOUTS) {
        const where = `${id} ${L.id} ${L.name} / ${look}`;
        let html;
        try { html = build(L, tw, tw.model, null, 'light', await D.fontFaces(fonts(tw, L).set)); }
        catch (e) { errs.push(`${where}: ${e.message}`); continue; }
        const file = path.join(dir, `${id}-${L.id}-${look}.html`);
        fs.writeFileSync(file, html);
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
        const p = await ctx.newPage();
        const pe = [];
        p.on('pageerror', e => pe.push(e.message));
        p.on('console', m => { if (m.type() === 'error') pe.push(m.text()); });
        await p.goto('file://' + file); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(150);
        const state = () => p.evaluate(() => {
          const dgs = [...document.querySelectorAll('.dg')];
          const lum = c => { const m = c.match(/\d+(\.\d+)?/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2]; };
          return {
            shown: dgs.map(d => [...d.querySelectorAll(':scope > svg')].filter(s => s.getBoundingClientRect().width > 0).map(s => s.getAttribute('class'))),
            pageDark: lum(getComputedStyle(document.body).backgroundColor) < .2,
            sizes: dgs.map(d => [d.dataset.dg, d.closest('[data-locator]') ? null : d.getBoundingClientRect().width / +d.dataset.w]),
            accent: getComputedStyle(document.documentElement).getPropertyValue('--accent'),
            sig: dgs.map(d => [...d.querySelectorAll(':scope > svg')].map(s => s.outerHTML.length).join('/')).join(' '),
          };
        });
        const s0 = await state();
        const static_ = await p.evaluate(() => {
          window.__twins = [...document.querySelectorAll('.dg > svg')];
          const dgs = [...document.querySelectorAll('.dg')];
          return {
            twins: dgs.map(d => d.querySelectorAll(':scope > svg').length),
            nested: document.querySelectorAll('.dg svg svg').length,
            allSvg: document.querySelectorAll('svg').length, dgSvg: document.querySelectorAll('.dg > svg').length,
            stray: [...document.querySelectorAll('.dg .badge')].filter(b => !b.closest('.node') && !b.closest('.key')).length,
            left: (document.documentElement.outerHTML.match(/<!--[A-Z]+(:\w+)?-->|@theme (light|dark)/) || [])[0] || '',
            fams: [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/['"]/g, '')))],
            toggle: document.querySelectorAll('.dg-theme button').length,
            narrowCards: [...document.querySelectorAll('.cards .note')].filter(n => n.getBoundingClientRect().width < 200).length,
          };
        });
        const fail = m => errs.push(`${where}: ${m}`);
        if (pe.length) fail('page errors: ' + pe.slice(0, 3).join(' | '));
        if (static_.left) fail(`placeholder ${static_.left} left in the page`);
        if (static_.twins.some(t => t !== 2)) fail(`a .dg box without exactly two twins: ${static_.twins}`);
        if (static_.nested) fail(`${static_.nested} <svg> nested inside a diagram`);
        if (static_.allSvg !== static_.dgSvg) fail(`${static_.allSvg - static_.dgSvg} <svg> on the page that are not diagram twins`);
        if (static_.stray) fail(`${static_.stray} badges outside their .node`);
        if (static_.toggle !== 3) fail('no Light / Dark / Auto toggle');
        if (static_.narrowCards) fail(`${static_.narrowCards} note cards squeezed under 200 px wide`);
        if (static_.fams.length > 2) fail(`${static_.fams.length} font families loaded: ${static_.fams.join(', ')}`);
        if (look === 'clear' && !static_.fams.includes('IBM Plex Sans')) fail(`IBM Plex Sans is not loaded (${static_.fams.join(', ')})`);
        s0.sizes.filter(x => x[1] !== null && x[1] < .85 - 1e-3).forEach(([k, v]) => fail(`diagram ${k} shown at ${Math.round(v * 100)}% of its drawn width at 1440 px`));
        if (s0.shown.some(x => x.join() !== 'dg-l') || s0.pageDark) fail('light page does not show the light twin');
        const check = async (want, why) => {
          const s = await state();
          if (s.shown.some(x => x.join() !== want) || s.pageDark !== (want === 'dg-d')) fail(`${why}: shows ${JSON.stringify(s.shown)}, page ${s.pageDark ? 'dark' : 'light'}`);
          if (s.sig !== s0.sig) fail(`${why}: the drawing changed (a theme change must not redraw)`);
          const h = hue(s.accent); if (h !== null && ((h >= 150 && h <= 260) || (h >= 15 && h <= 40))) fail(`${why}: accent ${s.accent.trim()} has hue ${Math.round(h)}, inside 150-260 or 15-40`);
          return s;
        };
        { const h = hue(s0.accent); if (h !== null && ((h >= 150 && h <= 260) || (h >= 15 && h <= 40))) fail(`light: accent ${s0.accent.trim()} has hue ${Math.round(h)}`); }
        await p.click('.dg-theme button[data-t="dark"]'); await check('dg-d', 'toggle to Dark');
        await p.click('.dg-theme button[data-t="light"]'); await check('dg-l', 'toggle back to Light');
        await p.click('.dg-theme button[data-t="auto"]'); await check('dg-l', 'Auto on a light device');
        await p.emulateMedia({ colorScheme: 'dark' }); await check('dg-d', 'Auto on a dark device');
        const same = await p.evaluate(() => { const now = [...document.querySelectorAll('.dg > svg')]; return now.length === window.__twins.length && now.every((s, i) => s === window.__twins[i]); });
        if (!same) fail('the twins were replaced during theme changes (a theme change must not redraw)');
        if (look === 'clear') {
          await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(100);
          const ox = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          if (ox > 0) fail(`page scrolls sideways by ${ox} px at 390 px wide`);
        }
        await ctx.close(); n++;
      }
    }
    if (D.errs.length) errs.push(...D.errs);
    await browser.close();
  }
  if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log(`ok: ${n} pages (${LAYOUTS.length} layouts x ${LOOKS.length} looks, plus the layouts on ${RUNS.slice(1).map(r => r[0]).join(' and ')}): twins swap with the theme without a redraw, every diagram at 85% or more of its drawn width at 1440 px`);
})().catch(e => { console.error(e); process.exit(1); });
