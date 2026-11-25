// Lay out a diagram model whose boxes have no coordinates, with ELK's layered algorithm.
//   node layout.js MODEL.json [OUT.json]   prints (or writes) the model with x, y, w, h on every box and zone and pts on every line
//   node layout.js -                       reads the model from stdin (build.py preview and page use this)
// What the model needs: each node and nested zone says which zone it is "in", and each edge says "from" and "to" (node ids).
// Boxes that already have x and y are locks: they stay where they are and their lines are re-routed to them.
// "free": 1 on an edge keeps it out of the layering (boxes it joins can then sit side by side); it gets a simple route.
// Edges with from/to but no pts in a hand-placed model get a simple orthogonal route. Needs Node only (ELK is vendored).
const path = require('path');

const needsLayout = M => (M.nodes || []).some(n => n.x === undefined || n.y === undefined);
const needsRoutes = M => (M.edges || []).some(e => !e.pts);

// Box sizes from the text, matching the renderer's fonts closely enough to leave room.
function size(n) {
  const sub = n.s || [], long = Math.max(n.t.length * 8.4, ...sub.map(s => s.length * 7));
  if (n.lay === 'top') return [n.w || Math.max(120, Math.round(long + 28)), n.h || 76 + 16 * Math.max(1, sub.length)];
  return [n.w || Math.max(150, Math.round(long + (n.b ? 82 : 32))), n.h || Math.max(56, 36 + 16 * sub.length)];
}

// Side-to-side route between two boxes: out of the side that faces the other box, one or two bends.
function route(a, b) {
  const ac = [a.x + a.w / 2, a.y + a.h / 2], bc = [b.x + b.w / 2, b.y + b.h / 2];
  if (b.x >= a.x + a.w + 10 || b.x + b.w <= a.x - 10) {
    const right = b.x >= a.x + a.w;
    const sx = right ? a.x + a.w : a.x, ex = right ? b.x : b.x + b.w;
    const y1 = Math.round(Math.max(a.y + 12, Math.min(a.y + a.h - 12, bc[1]))), y2 = Math.round(Math.max(b.y + 12, Math.min(b.y + b.h - 12, ac[1])));
    if (y1 === y2) return [[sx, y1], [ex, y2]];
    const mx = Math.round((sx + ex) / 2);
    return [[sx, y1], [mx, y1], [mx, y2], [ex, y2]];
  }
  const down = b.y >= a.y + a.h;
  const sy = down ? a.y + a.h : a.y, ey = down ? b.y : b.y + b.h;
  const x1 = Math.round(Math.max(a.x + 12, Math.min(a.x + a.w - 12, bc[0]))), x2 = Math.round(Math.max(b.x + 12, Math.min(b.x + b.w - 12, ac[0])));
  if (x1 === x2) return [[x1, sy], [x2, ey]];
  const my = Math.round((sy + ey) / 2);
  return [[x1, sy], [x1, my], [x2, my], [x2, ey]];
}

function routeMissing(M) {
  const byId = Object.fromEntries(M.nodes.map(n => [n.id, n]));
  M.edges.forEach((e, i) => {
    if (e.pts) return;
    const a = byId[e.from], b = byId[e.to];
    if (!a || !b) throw new Error(`edge ${i + 1}: needs "pts", or "from" and "to" naming boxes`);
    e.pts = route(a, b);
  });
  return M;
}

async function layout(M0) {
  const M = JSON.parse(JSON.stringify(M0));
  M.zones = M.zones || []; M.nodes = M.nodes || []; M.edges = M.edges || [];
  if (!needsLayout(M)) return routeMissing(M);
  const ELK = require(path.join(__dirname, 'vendor', 'elk-0.12.0.bundled.js'));
  const zone = Object.fromEntries(M.zones.map(z => [z.id, z]));
  const locked = new Set(M.nodes.filter(n => n.x !== undefined && n.y !== undefined).map(n => n.id));
  const elkNode = {};
  // Spacing is read from each box's parent, so every zone carries it too.
  const SPACING = {
    'elk.spacing.nodeNode': '56', 'elk.layered.spacing.nodeNodeBetweenLayers': '64',
    'elk.spacing.edgeNode': '24', 'elk.spacing.edgeEdge': '16', 'elk.layered.spacing.edgeNodeBetweenLayers': '24',
    'elk.spacing.edgeLabel': '6',
  };
  const graph = {
    id: '__root', children: [], edges: [],
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': (M.direction || 'right').toUpperCase(),
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.edgeRouting': 'ORTHOGONAL',
      ...SPACING, 'elk.edgeLabels.inline': 'false',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', 'elk.spacing.componentComponent': '48',
    },
  };
  const parentOf = z => z.in ? zone[z.in] : null;
  const depth = z => { let d = 0, p = z; while ((p = parentOf(p)) && d < 9) d++; return d; };
  // Zones first, parents before children, then boxes into their zones.
  M.zones.slice().sort((a, b) => depth(a) - depth(b)).forEach(z => {
    const top = depth(z) ? 40 : (z.inline ? 20 : 58);
    const n = { id: 'z:' + z.id, children: [], layoutOptions: Object.assign({}, SPACING, { 'elk.padding': `[top=${top},left=${z.inline ? 260 : 20},bottom=20,right=20]` }) };
    elkNode[n.id] = n;
    (z.in ? elkNode['z:' + z.in].children : graph.children).push(n);
  });
  M.nodes.forEach(nd => {
    const [w, h] = size(nd);
    const n = { id: 'n:' + nd.id, width: w, height: h };
    elkNode[n.id] = n;
    (nd.in ? elkNode['z:' + nd.in] : graph).children.push(n);
  });
  M.edges.forEach((e, i) => {
    if (e.pts && !(e.from && e.to)) return;
    if (!e.from || !e.to) throw new Error(`edge ${i + 1}: auto layout needs "from" and "to"`);
    if (locked.has(e.from) || locked.has(e.to) || e.free) return;   // free: this line does not shape the layout; routed after
    const lines = (Array.isArray(e.l) ? e.l : e.l ? [e.l] : []).filter(Boolean);
    const ed = { id: 'e' + i, sources: ['n:' + e.from], targets: ['n:' + e.to] };
    if (lines.length) ed.labels = [{ text: lines.join(' / '), width: Math.max(...lines.map(l => l.length)) * 7 + 14, height: lines.length * 14 + 8 }];
    graph.edges.push(ed);
  });
  const out = await new ELK().layout(graph);
  const X0 = 20, Y0 = 100, abs = {};
  (function walk(n, ox, oy) {
    (n.children || []).forEach(c => { abs[c.id] = { x: ox + c.x, y: oy + c.y, w: c.width, h: c.height }; walk(c, ox + c.x, oy + c.y); });
  })(out, X0, Y0);
  abs.__root = { x: X0, y: Y0 };
  const put = (o, b) => { o.x = Math.round(b.x); o.y = Math.round(b.y); o.w = Math.round(b.w); o.h = Math.round(b.h); };
  M.zones.forEach(z => put(z, abs['z:' + z.id]));
  M.nodes.forEach(n => { if (!locked.has(n.id)) put(n, abs['n:' + n.id]); });
  const edges = [];
  (function collect(n) { (n.edges || []).forEach(e => edges.push(e)); (n.children || []).forEach(collect); })(out);
  edges.forEach(e => {
    const src = M.edges[+e.id.slice(1)], c = abs[e.container || '__root'] || abs.__root;
    const s = (e.sections || [])[0]; if (!s) return;
    src.pts = [s.startPoint, ...(s.bendPoints || []), s.endPoint].map(p => [Math.round(c.x + p.x), Math.round(c.y + p.y)]);
  });
  // Locked boxes were not in ELK's sizing: grow their zones (and the zones around those) to hold them.
  const PAD = 20;
  M.nodes.filter(n => locked.has(n.id)).forEach(n => { const [w, h] = size(n); n.w = n.w || w; n.h = n.h || h; });
  M.nodes.filter(n => locked.has(n.id) && n.in).forEach(n => {
    let z = zone[n.in], inner = n;
    while (z) {
      const top = depth(z) ? 40 : (z.inline ? 20 : 58);   // same title room as the ELK padding
      const x0 = Math.min(z.x, inner.x - PAD), y0 = Math.min(z.y, inner.y - top);
      const x1 = Math.max(z.x + z.w, inner.x + inner.w + PAD), y1 = Math.max(z.y + z.h, inner.y + inner.h + PAD);
      Object.assign(z, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      inner = z; z = parentOf(z);
    }
  });
  routeMissing(M);
  // The canvas holds everything: ELK's area, locked boxes, grown zones and every line.
  let maxX = out.width + X0, maxY = out.height + Y0;
  M.zones.concat(M.nodes).forEach(o => { if (o.x !== undefined) { maxX = Math.max(maxX, o.x + (o.w || 0)); maxY = Math.max(maxY, o.y + (o.h || 0)); } });
  M.edges.forEach(e => (e.pts || []).forEach(p => { maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }));
  M.w = Math.max(M.w || 0, Math.round(maxX + X0));
  M.h = Math.max(M.h || 0, Math.round(maxY + 20));
  M.laidOut = 'elk';
  return M;
}

module.exports = { layout, needsLayout, needsRoutes, route };

if (require.main === module) {
  const [src, dst] = process.argv.slice(2);
  if (!src) { console.error('usage: node layout.js MODEL.json|- [OUT.json]'); process.exit(2); }
  const fs = require('fs');
  let M;
  try { M = JSON.parse(src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(src, 'utf8')); }
  catch (e) { console.error(`${src}: ${e.message}`); process.exit(1); }
  layout(M).then(R => {
    const txt = JSON.stringify(R, null, 1);
    if (dst) fs.writeFileSync(dst, txt + '\n'); else process.stdout.write(txt);
  }).catch(e => { console.error(`${src}: ${e.message}`); process.exit(1); });
}
