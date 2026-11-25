// Check the page templates (pages/, built by page.js) in a real browser. Fails on:
//   a page error or a placeholder left in the page; a diagram shown under 85% of its drawn width at a 1440 px
//   window (the locator in layout D is exempt: it is marked data-locator and only finds the place);
//   a .dg box without exactly two top-level twins, or any <svg> nested inside a diagram (page code must be able
//   to select the diagrams alone); a badge outside its .node; a theme toggle that does not swap page and drawing
//   together, or that redraws (the twins must be the same elements, unchanged); Auto not following the device;
//   layout A not showing the whole drawing at load (no scroll, also with step 1 in the reading band); faded text
//   (a box or label not lit) under 4.5:1 on what is under it, in either theme;
//   more than two font families loaded, or IBM Plex Sans missing on a Clear page; an accent colour with a hue in
//   150-260 or 15-40 (design-with-mobbin), in either theme; sideways page scroll at phone width (390 px).
//   Layout E also fails on: an empty "What moves" cell (also on a copy of lab-access with most line labels taken
//   off); a line label rendered under 12 px at a 1024 px window; a table wider than its box at 390 px.
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
        // Complete at rest (layout A): at load, with no scroll, nothing in the drawing is faded below how it is drawn.
        const atRest = () => p.evaluate(() => {
          const dg = document.querySelector('.dg');
          const faded = [...dg.querySelectorAll('.node,.edge-label')].filter(e => +getComputedStyle(e).opacity < +(e.getAttribute('opacity') || 1) - 1e-3
            || [...e.querySelectorAll('*')].some(c => +getComputedStyle(c).opacity < +(c.getAttribute('opacity') || 1) - 1e-3));
          return { faded: faded.length, focus: dg.classList.contains('focus'), lit: document.querySelectorAll('.step.on').length, y: scrollY,
            first: (document.querySelector('.step') || { getBoundingClientRect: () => ({ top: 0 }) }).getBoundingClientRect().top };
        });
        if (L.id === 'A') {
          const restFail = (r, why) => { if (r.faded || r.focus || r.lit) fail(`${why}, no scroll: ${r.faded} boxes or labels faded, ${r.lit} steps lit (the whole drawing must show at rest)`); };
          const r0 = await atRest(); restFail(r0, 'at load');
          // Again with the window sized so the first step card sits in the reading band at load.
          await p.setViewportSize({ width: 1440, height: Math.round(r0.first / .66) });
          await p.reload(); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
          restFail(await atRest(), 'at load with step 1 in the reading band');
          // ...and scrolling still drives it: step 2's card in the band lights step 2; back at the top the drawing is whole.
          await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(100);
          await p.evaluate(() => { const r = document.querySelectorAll('.step')[1].getBoundingClientRect(); scrollBy(0, r.top + r.height / 2 - innerHeight * .66); });
          await p.waitForTimeout(400);
          const lit = await p.evaluate(() => ({ on: [...document.querySelectorAll('.step.on')].map(s => s.dataset.i).join(), focus: document.querySelector('.dg').classList.contains('focus') }));
          if (lit.on !== '1' || !lit.focus) fail(`scrolling step 2's card into the reading band lit steps [${lit.on}] (focus ${lit.focus}), not step 2`);
          await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(400);
          restFail(await atRest(), 'scrolled back to the top');
          await p.setViewportSize({ width: 1440, height: 900 }); await p.reload(); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(150);
          await p.evaluate(() => { window.__twins = [...document.querySelectorAll('.dg > svg')]; });
        }
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
        // Focus keeps words readable: light one box, then every faded box or label's text keeps 4.5:1 on what is
        // actually under it (the shapes under three points across the text, composited over the drawing's ground).
        await p.setViewportSize({ width: 1440, height: 3000 }); await p.waitForTimeout(100);
        for (const t of ['light', 'dark']) {
          await p.click(`.dg-theme button[data-t="${t}"]`);
          await p.evaluate(() => { const dg = [...document.querySelectorAll('.dg')].find(d => !d.closest('[data-locator]')); const n = dg.querySelector('.node[data-id]'); window.__lit = dg; DG.light(dg, { nodes: [n.dataset.id] }); });
          await p.waitForTimeout(400);
          const res = await p.evaluate(() => {
            const rgb = c => { c = (c || '').trim(); if (c[0] === '#') { if (c.length === 4) c = '#' + [...c.slice(1)].map(x => x + x).join(''); return [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); } const m = c.match(/[\d.]+/g); return m && m.length >= 3 ? m.map(Number).slice(0, 3) : null; };
            const lum = c => { const m = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2]; };
            const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
            const over = (c, a, under) => c.map((v, i) => v * a + under[i] * (1 - a));
            const dg = window.__lit, svg = DG.shown(dg), ground = rgb(getComputedStyle(document.documentElement).getPropertyValue('--dg-ground'));
            const alpha = (el, own) => { let a = own; for (let e = el; e && e !== dg.parentElement; e = e.parentElement) a *= +getComputedStyle(e).opacity; return a; };
            // The colour under a point: every painted shape there (not text), bottom up, over the ground.
            const under = (x, y, skip) => {
              let c = ground;
              for (const e of document.elementsFromPoint(x, y).reverse()) {
                if (!svg.contains(e) || e === svg || skip.has(e) || e.closest('text') || !(e instanceof SVGGeometryElement)) continue;
                const cs = getComputedStyle(e), useFill = cs.fill !== 'none' && !/url\(/.test(cs.fill), paint = useFill ? cs.fill : cs.stroke;
                const col = rgb(paint); if (!col || /url\(/.test(paint) || paint === 'none') continue;
                c = over(col, alpha(e, +(useFill ? cs.fillOpacity : cs.strokeOpacity)), c);
              }
              return c;
            };
            const texts = [...svg.querySelectorAll(':is(.node,.edge-label):not(.on) text')].filter(t => t.textContent.trim() && !t.closest('.badge'));
            const skip = new Set(texts);
            const out = [], seen = new Set(), sb = dg.closest('.dg-scroll'), left0 = sb ? sb.scrollLeft : 0;
            // A drawing wider than its box scrolls sideways: measure each stretch in turn.
            for (let pass = 0; pass < 20; pass++) {
              const clip = (sb || dg).getBoundingClientRect();
              texts.forEach(t => {
                if (seen.has(t)) return;
                const r = t.getBoundingClientRect(), y = r.top + r.height / 2; let worst = 99;
                const cs = getComputedStyle(t), f = rgb(cs.fill); if (!f) return;
                const a = alpha(t, +cs.fillOpacity);
                for (const fx of [.25, .5, .75]) {
                  const x = r.left + r.width * fx;
                  if (x < clip.left || x > clip.right || y < 0 || y > innerHeight) continue;
                  const u = under(x, y, skip); worst = Math.min(worst, ratio(over(f, a, u), u));
                }
                if (worst === 99) return; seen.add(t);
                if (worst < 4.5) out.push(`"${t.textContent.trim().slice(0, 24)}" ${worst.toFixed(2)}:1`);
              });
              if (!sb || sb.scrollLeft + sb.clientWidth >= sb.scrollWidth - 1) break;
              sb.scrollLeft += sb.clientWidth * .8;
            }
            if (sb) sb.scrollLeft = left0;
            // Texts a crop leaves outside the drawing's view are not on show and need no measuring.
            const box = svg.getBoundingClientRect(), shown = texts.filter(t => { const r = t.getBoundingClientRect(), x = r.left + r.width / 2 - box.left + (sb ? sb.scrollLeft : 0), y = r.top + r.height / 2; return x >= 0 && x <= box.width && y >= box.top && y <= box.bottom; }).length;
            const logoText = [...svg.querySelectorAll('.node:not(.on) .badge text')].filter(t => t.textContent.trim() && alpha(t, 1) > .2).length;
            const plates = [...svg.querySelectorAll('.edge-label:not(.on) > rect:first-child')].filter(r => alpha(r, 1) < .999).length;
            DG.light(dg);
            return { out, seen: seen.size, total: shown, plates, logoText };
          });
          if (res.out.length) fail(`${t}: ${res.out.length} faded labels under 4.5:1 on what is under them while a box is lit: ${res.out.slice(0, 3).join(', ')}`);
          if (res.logoText) fail(`${t}: ${res.logoText} words drawn inside a faded box's logo stay at full strength (they must fade with the logo)`);
          if (res.plates) fail(`${t}: ${res.plates} faded line labels lost their plate (it must stay so the words sit on a clear patch)`);
          if (res.seen < res.total) fail(`${t}: only ${res.seen} of the ${res.total} faded labels on show could be measured`);
        }
        await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(100);
        await p.click('.dg-theme button[data-t="auto"]');
        const same = await p.evaluate(() => { const now = [...document.querySelectorAll('.dg > svg')]; return now.length === window.__twins.length && now.every((s, i) => s === window.__twins[i]); });
        if (!same) fail('the twins were replaced during theme changes (a theme change must not redraw)');
        if (L.id === 'E') {
          const blank = await p.evaluate(() => [...document.querySelectorAll('#tbody td.what')].filter(td => !td.textContent.trim()).length);
          if (blank) fail(`${blank} empty "What moves" cells`);
          // The path cell spans its rows, so later rows start with a From cell: every non-path cell of one kind must
          // look the same on every row, and only path cells are bold (a td:first-child rule would break both).
          const odd = await p.evaluate(() => {
            const out = [], seen = {};
            document.querySelectorAll('#tbody td').forEach(td => {
              const cs = getComputedStyle(td), look = `${cs.fontWeight} ${cs.paddingLeft} ${cs.whiteSpace}`;
              if (td.classList.contains('path')) return;
              if (+cs.fontWeight >= 800) out.push(`"${td.textContent.trim()}" (${td.className}) is bold like a path cell`);
              if (seen[td.className] === undefined) seen[td.className] = look;
              else if (seen[td.className] !== look) out.push(`"${td.textContent.trim()}" (${td.className}) reads ${look}, not ${seen[td.className]} like its column's first cell`);
            });
            return out;
          });
          if (odd.length) fail(`table rows styled unlike each other: ${odd.slice(0, 3).join('; ')}`);
          await p.setViewportSize({ width: 1024, height: 900 }); await p.waitForTimeout(100);
          const small = await p.evaluate(() => {
            const out = [];
            document.querySelectorAll('.dg > svg').forEach(svg => {
              if (!svg.getBoundingClientRect().width) return;
              const k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
              svg.querySelectorAll('.edge-label text').forEach(t => { const px = parseFloat(getComputedStyle(t).fontSize) * k; if (px < 12 - 1e-3) out.push(`"${t.textContent}" ${px.toFixed(1)} px`); });
            });
            return out;
          });
          if (small.length) fail(`line labels under 12 px at 1024 px wide: ${small.slice(0, 3).join(', ')}${small.length > 3 ? ` and ${small.length - 3} more` : ''}`);
        }
        if (look === 'clear' || L.id === 'E') {
          await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(100);
          const ox = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          if (ox > 0) fail(`page scrolls sideways by ${ox} px at 390 px wide`);
          const wide = L.id !== 'E' ? 0 : await p.evaluate(() => [...document.querySelectorAll('table')].filter(t => t.getBoundingClientRect().width > t.parentElement.clientWidth + 1 || t.parentElement.scrollWidth > t.parentElement.clientWidth + 1).length);
          if (wide) fail(`${wide} tables wider than their box at 390 px wide`);
        }
        await ctx.close(); n++;
      }
      // Layout E on a model whose lines mostly have no label: every "What moves" cell must still say something.
      if (id === 'lab-access') {
        const M = JSON.parse(JSON.stringify(tw.model)), seen = new Set();
        M.edges.forEach((e, i) => { if (e.f && (e.f === 'egress' || seen.has(e.f))) delete e.l; if (e.f) seen.add(e.f); if (i % 3 === 0) e.dash = true; });
        // An unlabelled line into the same box as the flow's labelled first line must borrow that line's label.
        const DM = require('./model.js'), first = M.edges.find(e => e.f === 'api' && e.l), [a0, b0] = DM.ends(M, first);
        const other = M.nodes.find(n => n.id !== a0.id && n.id !== b0.id);
        M.edges.push({ from: other.id, to: b0.id, f: 'api' });
        const want = [other.t, b0.t, DM.label(first)].join(' | ');
        const E = LAYOUTS.find(l => l.id === 'E');
        const file = path.join(dir, `${id}-E-${look}-bare.html`);
        fs.writeFileSync(file, build(E, tw, M, null, 'light', await D.fontFaces(fonts(tw, E).set)));
        const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await p.goto('file://' + file);
        const cells = await p.evaluate(() => [...document.querySelectorAll('#tbody td.what')].map(td => td.textContent.trim()));
        const rows = await p.evaluate(() => [...document.querySelectorAll('#tbody tr')].map(r => ['from', 'to', 'what'].map(c => r.querySelector('td.' + c).textContent.trim()).join(' | ')));
        const bare = `${id} E bare labels / ${look}`;
        if (!cells.length || cells.some(c => !c)) errs.push(`${bare}: ${cells.filter(c => !c).length} of ${cells.length} "What moves" cells empty`);
        if (!rows.includes(want)) errs.push(`${bare}: no row "${want}" (an unlabelled line borrows the label of its flow's line into the same box)`);
        // A line with nothing to borrow says its flow's name, with ", async or batch" when it is dashed; never a bare line kind.
        const names = Object.values(M.flows || {}).map(f => f.t);
        if (cells.some(c => /^(solid|dashed|dotted) line/.test(c))) errs.push(`${bare}: a "What moves" cell says only its line kind ("${cells.find(c => /^(solid|dashed|dotted) line/.test(c))}") where the flow has a name`);
        if (!cells.some(c => names.includes(c)) || !cells.some(c => names.some(t => c === `${t}, async or batch`))) errs.push(`${bare}: unlabelled lines with nothing to borrow do not fall back to their flow's name (plain, and with ", async or batch" when dashed)`);
        await p.close();
      }
    }
    if (D.errs.length) errs.push(...D.errs);
    await browser.close();
  }
  if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log(`ok: ${n} pages (${LAYOUTS.length} layouts x ${LOOKS.length} looks, plus the layouts on ${RUNS.slice(1).map(r => r[0]).join(' and ')}): twins swap with the theme without a redraw, every diagram at 85% or more of its drawn width at 1440 px`);
})().catch(e => { console.error(e); process.exit(1); });
