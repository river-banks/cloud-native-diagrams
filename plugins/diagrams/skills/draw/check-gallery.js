// Check the pages people browse diagrams on, in a real browser: the gallery (gallery.html), the style picker
// (picker.html, the same page as build.py preview) and the statechart and Field Notes reference pages.
// Fails on:
//   a page error or console error; sideways page scroll at 1280 or 400 px, light or dark;
//   a Light / Dark / Auto toggle that does not switch the whole page (its background) and every picture together,
//   that Auto does not follow the device, or that is not remembered after a reload;
//   the gallery missing a kind, a layout or a look, or a card whose light or dark picture is missing;
//   a statechart or Field Notes page whose copy of statechart.css or _toggle.js is stale (statechart/stamp.py).
//   node check-gallery.js
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const { LAYOUTS } = require('./page.js');
const { KINDS, LOOKS } = require('./gallery.js');
const first = (...c) => c.map(p => path.join(__dirname, p)).find(p => fs.existsSync(p));
// In the cloud-native-diagrams repo every kind page must be there; a copy of the skill without them (the public copy)
// checks the pages it has, and expects the gallery to leave the missing kinds out, as gallery.js does.
const inRepo = fs.existsSync(path.join(__dirname, '..', 'scripts', 'check'));
const PAGES = [
  { name: 'gallery', file: first('gallery.html'), pics: '.shot img' },
  { name: 'picker', file: first('picker.html'), pics: '#main' },
  { name: 'statechart', file: first('kinds/statechart/example/blended-skills.html', '../statechart/example/blended-skills.html') },
  { name: 'field-notes', file: first('kinds/field-notes/example/field-notes.html', '../explainers/example/field-notes.html') },
];

(async () => {
  const errs = [];
  for (const p of PAGES) if (!p.file && (inRepo || !['statechart', 'field-notes'].includes(p.name))) errs.push(`${p.name}: page not found`);
  const stamp = first('kinds/statechart/stamp.py', '../statechart/stamp.py');
  const stamped = PAGES.slice(2).filter(p => p.file).map(p => p.file);
  if (stamp && stamped.length) {
    try { execFileSync('python3', [stamp, '--check', ...stamped], { stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch (e) { errs.push(String(e.stderr || e.message).trim()); }
  }
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const lum = c => { const m = (c.match(/\d+(\.\d+)?/g) || [0, 0, 0]).map(Number).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2]; };
  for (const P of PAGES.filter(p => p.file)) {
    for (const width of [1280, 400]) for (const scheme of ['light', 'dark']) {
      const where = `${P.name} ${width}px ${scheme}`;
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
      await ctx.route(/^https?:/, r => r.abort());   // offline, as the pages promise
      const pg = await ctx.newPage(), pe = [];
      pg.on('pageerror', e => pe.push(e.message));
      pg.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) pe.push(m.text()); });
      await pg.goto('file://' + P.file); await pg.waitForTimeout(250);
      const look = (q = pg) => q.evaluate(sel => ({
        bg: getComputedStyle(document.body).backgroundColor, html: getComputedStyle(document.documentElement).backgroundColor,
        theme: document.documentElement.dataset.theme || 'auto',
        pics: sel ? [...document.querySelectorAll(sel)].filter(e => e.getBoundingClientRect().width > 0).map(e => e.tagName === 'IMG' ? e.className + ':' + (e.getAttribute('src') || '').length : e.innerHTML.length) : [],
        sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        pressed: [...document.querySelectorAll('.dg-theme button[aria-pressed="true"]')].map(b => b.dataset.t),
      }), P.pics || null);
      const dark = s => lum(s.bg === 'rgba(0, 0, 0, 0)' ? s.html : s.bg) < .2;
      const a = await look();
      if (a.sideways > 1) errs.push(`${where}: the page scrolls sideways by ${a.sideways}px`);
      if (a.pressed.join() !== 'auto') errs.push(`${where}: the toggle should start on Auto, shows ${a.pressed.join() || 'nothing'}`);
      if (dark(a) !== (scheme === 'dark')) errs.push(`${where}: Auto does not follow the device`);
      if (!(await pg.$('.dg-theme button[data-t="dark"]'))) { errs.push(`${where}: no Light / Dark / Auto toggle`); await ctx.close(); continue; }
      const other = scheme === 'dark' ? 'light' : 'dark';
      await pg.click(`.dg-theme button[data-t="${other}"]`); await pg.waitForTimeout(200);
      const b = await look();
      if (dark(b) !== (other === 'dark')) errs.push(`${where}: ${other} on the toggle did not switch the page`);
      if (P.pics && JSON.stringify(a.pics) === JSON.stringify(b.pics)) errs.push(`${where}: ${other} on the toggle did not switch the pictures`);
      if (P.pics && b.pics.some(x => typeof x === 'string' && x.endsWith(':0'))) errs.push(`${where}: a picture has no ${other} version`);
      if (b.sideways > 1) errs.push(`${where} then ${other}: the page scrolls sideways by ${b.sideways}px`);
      // Remembered: a new visit to the page shows the choice. (A new page in the same browser profile, not pg.reload():
      // Chromium sometimes drops a file:// page's localStorage across a reload of that same page, which tests the
      // browser's storage flush rather than the toggle.)
      const again = await ctx.newPage();
      again.on('pageerror', e => pe.push(e.message));
      await again.goto('file://' + P.file); await again.waitForTimeout(250);
      const c = await look(again);
      if (c.theme !== other || c.pressed.join() !== other) errs.push(`${where}: the ${other} choice was not remembered on a new visit (page shows ${c.theme}, toggle ${c.pressed.join() || 'none'})`);
      await again.close();
      await pg.click('.dg-theme button[data-t="auto"]'); await pg.waitForTimeout(150);
      if (dark(await look()) !== (scheme === 'dark')) errs.push(`${where}: Auto on the toggle did not go back to the device's theme`);
      if (P.name === 'gallery' && width === 1280 && scheme === 'light') {
        const g = await pg.evaluate(() => ({ kinds: G.kinds.map(k => k.name), layouts: G.layouts.map(l => l.id), looks: G.looks.map(k => k.id),
          missing: Object.entries(IMG).filter(([k, v]) => !v[0] || !v[1]).map(([k]) => k), cards: document.querySelectorAll('#mixes .card').length }));
        const want = { kinds: KINDS.filter(k => !k.page || PAGES.find(p => p.name === k.id && p.file)).map(k => k.name), layouts: LAYOUTS.map(l => l.id), looks: LOOKS };
        for (const k of Object.keys(want)) if (JSON.stringify(g[k]) !== JSON.stringify(want[k])) errs.push(`gallery: ${k} are ${g[k].join(', ')}, want ${want[k].join(', ')}: run node diagrams/gallery.js`);
        if (g.missing.length) errs.push(`gallery: pictures missing a light or dark version: ${g.missing.join(', ')}`);
        if (!g.cards) errs.push('gallery: no mixes shown');
        await pg.click('#filters button[data-look="sketch"]');
        const n = await pg.evaluate(() => document.querySelectorAll('#mixes .card').length);
        if (n < LAYOUTS.length) errs.push(`gallery: the Sketch chip shows ${n} mixes, want Sketch on all ${LAYOUTS.length} layouts`);
      }
      errs.push(...pe.map(e => `${where}: ${e}`));
      await ctx.close();
    }
  }
  await browser.close();
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log(`ok: ${PAGES.filter(p => p.file).length} pages at 1280 and 400 px, light and dark: toggle switches page and pictures, remembered, no sideways scroll`);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
