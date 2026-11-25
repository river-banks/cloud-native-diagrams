/* DG: helpers shared by every page template (page.js inlines this file).
   Every top-level diagram <svg> is a direct child of a .dg box (badges are <g>, never nested <svg>), so
   `.dg > svg` selects the two twins and nothing else. Both twins get every change, so the hidden one is
   ready when the theme flips. */
const DG = {
  svgs: dg => [...dg.querySelectorAll(':scope > svg')],
  shown: dg => DG.svgs(dg).find(s => s.getBoundingClientRect().width > 0) || DG.svgs(dg)[0],
  // Badges drawn before plugin 1.7.0 sat beside their box; move each into its .node so dimming covers the logo.
  adopt(dg) {
    DG.svgs(dg).forEach(svg => {
      const nodes = [...svg.querySelectorAll('.node')].map(n => { const r = n.querySelector('rect'); return r && { n, x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') }; }).filter(Boolean);
      svg.querySelectorAll('.badge').forEach(b => {
        if (b.closest('.node') || b.closest('.key')) return;
        const bb = b.getBBox ? b.getBBox() : null; if (!bb) return;
        const hit = nodes.find(o => bb.x >= o.x - 2 && bb.x <= o.x + o.w && bb.y >= o.y - 2 && bb.y <= o.y + o.h);
        if (hit) hit.n.appendChild(b);
      });
    });
  },
  // light(dg, {edges, flows, nodes}): dim everything else; no argument shows the whole drawing again.
  light(dg, { edges = [], flows = [], nodes = [] } = {}) {
    dg.querySelectorAll('.on').forEach(x => x.classList.remove('on'));
    if (!edges.length && !flows.length && !nodes.length) { dg.classList.remove('focus'); return; }
    edges.forEach(i => dg.querySelectorAll(`.edge[data-i="${i}"],.edge-label[data-i="${i}"]`).forEach(x => x.classList.add('on')));
    flows.forEach(f => dg.querySelectorAll(`.edge[data-f="${f}"],.edge-label[data-f="${f}"]`).forEach(x => x.classList.add('on')));
    nodes.forEach(n => dg.querySelectorAll(`.node[data-id="${n}"]`).forEach(x => x.classList.add('on')));
    dg.classList.add('focus');
  },
  // A box's extent in drawing units: from the twin on show (works for every look, isometric blocks too),
  // or from the box's own rect when nothing is on show yet.
  box(dg, id) {
    for (const svg of [DG.shown(dg), ...DG.svgs(dg)]) {
      const g = svg && svg.querySelector(`.node[data-id="${id}"]`); if (!g) continue;
      try { const b = g.getBBox(); if (b.width) return [b.x, b.y, b.width, b.height]; } catch (e) {}
      const r = g.querySelector('rect'); if (r && r.getAttribute('width')) return [+r.getAttribute('x'), +r.getAttribute('y') - 14, +r.getAttribute('width'), +r.getAttribute('height') + 14];
    }
    return null;
  },
  // crop(dg, ids, pad): show only the boxes named, at full size; both twins get the same viewBox.
  crop(dg, ids, pad = 40) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    ids.forEach(id => { const b = DG.box(dg, id); if (!b) return; x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[0] + b[2]); y1 = Math.max(y1, b[1] + b[3]); });
    if (x0 > x1) return;
    const vb = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad].map(Math.round);
    DG.svgs(dg).forEach(svg => { if (!svg.dataset.vb) svg.dataset.vb = svg.getAttribute('viewBox'); svg.setAttribute('viewBox', vb.join(' ')); });
    dg.style.setProperty('--dw', vb[2]); dg.style.setProperty('--dh', vb[3]); dg.dataset.w = vb[2];
  },
  uncrop(dg) { DG.svgs(dg).forEach(svg => { if (svg.dataset.vb) svg.setAttribute('viewBox', svg.dataset.vb); }); dg.style.setProperty('--dw', dg.dataset.dw); dg.dataset.w = dg.dataset.dw; },
  // How big the diagram is shown, as a share of its drawn size (1 = full size).
  scale: dg => dg.getBoundingClientRect().width / +dg.dataset.w,
  // Centre one box in a scrolling container.
  reveal(dg, box, id) {
    const svg = DG.shown(dg), b = DG.box(dg, id); if (!svg || !b) return;
    const vb = svg.getAttribute('viewBox').split(' ').map(Number), k = svg.getBoundingClientRect().width / vb[2];
    box.scrollTo({ left: (b[0] + b[2] / 2 - vb[0]) * k - box.clientWidth / 2, top: (b[1] + b[3] / 2 - vb[1]) * k - box.clientHeight / 2, behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
  },
  // The Light / Dark / Auto toggle. It only sets data-theme on <html>; CSS swaps the twins and the page together.
  theme() {
    const root = document.documentElement, key = 'dg-theme:' + location.pathname;
    try { const t = localStorage.getItem(key); if (t) root.dataset.theme = t === 'auto' ? '' : t; } catch (e) {}
    if (!root.dataset.theme) delete root.dataset.theme;
    const sync = () => document.querySelectorAll('.dg-theme button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === (root.dataset.theme || 'auto'))));
    document.querySelectorAll('.dg-theme button').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.t === 'auto') delete root.dataset.theme; else root.dataset.theme = b.dataset.t;
      try { localStorage.setItem(key, b.dataset.t); } catch (e) {}
      sync(); document.dispatchEvent(new CustomEvent('dg-theme'));
    }));
    sync();
  },
  esc: t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
  // Page text: escaped, `code` in backticks, **bold**.
  md: t => DG.esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'),
};
document.querySelectorAll('.dg').forEach(dg => { dg.dataset.dw = dg.dataset.w; DG.adopt(dg); });
DG.theme();
