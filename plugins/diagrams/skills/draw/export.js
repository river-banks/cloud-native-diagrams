// Draw one diagram model in one style and save it as SVG and PNG.
//   node export.js MODEL.json LOOK [OUT]       writes OUT.svg and OUT.png (OUT defaults to MODEL without .json);
//                                              LOOK is a style id or name, any case: clear, Sketch, Isometric, dark...
//   node export.js MODEL.json all [OUTDIR]     writes <id>-<style>.png for every style (for a quick contact sheet)
//   add --theme dark to either for the style's dark version (--theme both writes the light files and OUT-dark.svg/.png beside them), and --view sequence for the numbered steps as a sequence diagram;
//   add --no-header to leave out the title and kicker and crop the empty band, for a page that owns the title (page.js)
//   node export.js MODEL.json mermaid|sequence|drawio [OUT]   text formats, no browser needed (see convert.js);
//                                                             drawio takes --style LOOK (default clear) and --theme
// Needs python3 and Playwright with Chromium. Exits 1 if text does not fit its box or a badge drew nothing,
// after still writing the files, so you can look at what went wrong.
const FORMATS = { mermaid: '.mmd', sequence: '.sequence.mmd', drawio: '.drawio' };
if (FORMATS[process.argv[3]]) {
  const [src, fmt, out, ...rest] = process.argv.slice(2);
  const args = [require('path').join(__dirname, 'convert.js'), fmt, src, (out && !out.startsWith('--') ? out : src.replace(/\.json$/, '')) + FORMATS[fmt], ...(out && out.startsWith('--') ? [out] : []), ...rest];
  const r = require('child_process').spawnSync('node', args, { stdio: 'inherit' });
  process.exit(r.status);
}
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('export.js needs Playwright: npm i -g playwright && npx playwright install chromium. Or open the preview page and press Download SVG or PNG.'); process.exit(3); }
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const DM = require('./model.js');

const argv = process.argv.slice(2);
const ti = argv.indexOf('--theme'), theme = ti >= 0 ? argv.splice(ti, 2)[1] : 'light';
const vi = argv.indexOf('--view'), view = vi >= 0 ? argv.splice(vi, 2)[1] : 'map';
const hi = argv.indexOf('--no-header'), header = hi >= 0 ? (argv.splice(hi, 1), '0') : '1';
if (!['light', 'dark', 'both'].includes(theme)) { console.error('--theme must be light, dark or both'); process.exit(2); }
const THEMES = theme === 'both' ? ['light', 'dark'] : [theme];
const [src, style = '', outArg] = argv;
if (!src || !style) { console.error('usage: node export.js MODEL.json LOOK|all [OUT]'); process.exit(2); }
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-')), 'preview.html');
try { execFileSync('python3', [path.join(__dirname, 'build.py'), 'preview', path.resolve(src), tmp], { stdio: ['ignore', 'ignore', 'inherit'] }); }
catch (e) { process.exit(1); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('page error: ' + e.message));
  await page.goto('file://' + tmp);
  const all = await page.evaluate(() => STYLES.map(s => ({ id: s.id, name: s.name, offered: s.offered })));
  const ids = all.map(s => s.id), one = style === 'all' ? null : DM.lookId(all, style);
  const want = style === 'all' ? ids : [one];
  if (style !== 'all' && !one) { console.error(`no look "${style}". Looks: ${all.filter(s => s.offered).map(s => s.name).join(', ')} (or a style id: ${ids.join(', ')})`); process.exit(2); }
  const stem = outArg || src.replace(/\.json$/, '');
  for (const st of want) for (const th of THEMES) {
    await page.goto(`file://${tmp}?style=${st}&theme=${th}&view=${view}&header=${header}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const svg = document.getElementById('main');
      return {
        svg: diagramSVG(), id: MODEL.id, w: +svg.dataset.w, h: +svg.dataset.h,
        overflow: [...svg.querySelectorAll('text[data-overflow]')].map(t => t.textContent),
        empty: [...svg.querySelectorAll('g.badge')].filter(g => !g.querySelector('path, rect, circle')).map(g => g.dataset.badge),
      };
    });
    let out;
    if (style === 'all') { fs.mkdirSync(stem, { recursive: true }); out = path.join(stem, `${r.id}-${st}${th === 'dark' ? '-dark' : ''}`); }
    else { out = stem + (th === 'dark' && theme === 'both' ? '-dark' : ''); fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out + '.svg', r.svg); }
    // PNG from the standalone SVG at the model's own size (2x), so it matches the page's Download PNG.
    const shot = await browser.newPage({ viewport: { width: r.w, height: r.h }, deviceScaleFactor: 2 });
    await shot.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0}svg{display:block}</style>${r.svg}`);
    await shot.evaluate(() => document.fonts.ready); await shot.waitForTimeout(100);
    await shot.screenshot({ path: out + '.png' });
    await shot.close();
    console.log(`${out}.png${style === 'all' ? '' : ` and ${out}.svg`}`);
    if (r.overflow.length) errs.push(`${st}${th === 'dark' ? ' dark' : ''}: text too long for its box (shorten it or widen the box): ${r.overflow.join(' | ')}`);
    if (r.empty.length) errs.push(`${st}${th === 'dark' ? ' dark' : ''}: badges drew nothing: ${r.empty.join(', ')}`);
  }
  await browser.close();
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
})();
