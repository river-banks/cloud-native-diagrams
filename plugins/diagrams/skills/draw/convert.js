// Turn a diagram model into text formats other tools edit: Mermaid, draw.io, Excalidraw. No browser needed.
//   node convert.js mermaid  MODEL.json [OUT.mmd] [--icons builtin]   Mermaid architecture-beta (zones as groups, boxes as services)
//   node convert.js sequence MODEL.json [OUT.mmd]                     Mermaid sequenceDiagram from the numbered (step) edges
//   node convert.js drawio   MODEL.json [OUT.drawio] [--style LOOK] [--theme dark]   (LOOK: a name or id, default clear)
//                                                                     draw.io file: zones as containers, boxes with their badges, glued lines
//   node convert.js badges   OUT.excalidraw [WORD...]                 every badge (or those matching WORD) as an Excalidraw scene to copy from
// export.js calls these for the same formats. Models without coordinates are laid out first (layout.js).
const fs = require('fs'), path = require('path');
const DM = require('./model.js');
const { layout } = require('./layout.js');
const { themeStyle } = require('./render.js');
const HERE = __dirname;
const load = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const lines = e => (Array.isArray(e.l) ? e.l : e.l ? [e.l] : []).filter(Boolean);

/* ---------------------------------------------------------------- Mermaid */
const mid = s => String(s).replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
const mtext = s => String(s).replace(/[\[\]()"{}:;#]/g, ' ').replace(/\s+/g, ' ').trim();
// architecture-beta titles take only letters, digits, underscores and spaces.
const atitle = s => String(s).replace(/&/g, ' and ').replace(/[^\w ]/g, ' ').replace(/\s+/g, ' ').trim();
const KIND_ICON = { cloud: 'cloud', region: 'cloud', vpc: 'cloud', subnet: 'cloud', site: 'server', cluster: 'server', namespace: 'server', node: 'server', vlan: 'internet' };
const GLYPH_ICON = { database: 'database', storage: 'disk', disk: 'disk', backup: 'disk', archive: 'disk', globe: 'internet', cloud: 'cloud', users: 'internet', person: 'internet' };

// Which side of box n the point p sits on: L, R, T or B.
function side(n, p) {
  const d = [['L', Math.abs(p[0] - n.x)], ['R', Math.abs(p[0] - n.x - n.w)], ['T', Math.abs(p[1] - n.y)], ['B', Math.abs(p[1] - n.y - n.h)]];
  return d.sort((a, b) => a[1] - b[1])[0][0];
}

function toMermaid(M, opts = {}) {
  const logos = opts.icons === 'builtin' ? {} : load(path.join(HERE, 'badges', 'mermaid-logos.json'));
  const icon = n => {
    if (n.b && logos[n.b]) return `logos:${logos[n.b]}`;
    if (n.b && n.b.startsWith('g:') && GLYPH_ICON[n.b.slice(2)]) return GLYPH_ICON[n.b.slice(2)];
    return /db|database|sql|store|cache/i.test(n.t + (n.b || '')) ? 'database' : 'server';
  };
  const out = ['architecture-beta', `    %% ${M.title}${M.type ? ` (${M.type}` + (M.scope ? `, ${M.scope}` : '') + ')' : ''}${M.updated ? `, updated ${M.updated}` : ''}`];
  if (opts.icons !== 'builtin') out.push('    %% Icons named logos:* need the Iconify "logos" pack registered (mermaid.registerIconPacks); use --icons builtin where it is not.');
  const depth = z => { let d = 0, p = z; while ((p = DM.parentZone(M, p)) && d < 9) d++; return d; };
  (M.zones || []).slice().sort((a, b) => depth(a) - depth(b)).forEach(z => {
    const p = DM.parentZone(M, z);
    out.push(`    group ${mid('z_' + z.id)}(${KIND_ICON[z.kind] || 'cloud'})[${atitle(z.t)}]${p ? ` in ${mid('z_' + p.id)}` : ''}`);
  });
  M.nodes.forEach(n => {
    const z = DM.zoneOf(M, n);
    out.push(`    service ${mid(n.id)}(${icon(n)})[${atitle(n.t)}]${z ? ` in ${mid('z_' + z.id)}` : ''}`);
  });
  M.edges.forEach(e => {
    if (e.quiet) return;
    const [a, b] = DM.ends(M, e);
    if (!a || !b || a === b) return;
    const pts = e.pts || [];
    const sa = pts.length ? side(a, pts[0]) : 'R', sb = pts.length ? side(b, pts[pts.length - 1]) : 'L';
    const note = [e.step && `step ${e.step}`, ...lines(e), e.dash && 'async', e.dot && 'to confirm'].filter(Boolean).join(', ');
    if (note) out.push(`    %% ${a.t} to ${b.t}: ${note}`);
    out.push(`    ${mid(a.id)}:${sa} ${e.head === 'none' ? '--' : '-->'} ${sb}:${mid(b.id)}`);
  });
  return out.join('\n') + '\n';
}

// Mermaid sequenceDiagram from the edges that carry a step number, in step order.
function toSequence(M) {
  const steps = M.edges.filter(e => e.step).map(e => [e, DM.ends(M, e)]).filter(([, [a, b]]) => a && b).sort((x, y) => x[0].step - y[0].step);
  if (!steps.length) throw new Error('no numbered edges: give the main path "step": 1, 2, 3...');
  const out = ['sequenceDiagram', `    title ${mtext(M.title)}`, '    autonumber'];
  const seen = [];
  steps.forEach(([, [a, b]]) => [a, b].forEach(n => { if (!seen.includes(n)) seen.push(n); }));
  seen.forEach(n => out.push(`    participant ${mid(n.id)} as ${mtext(n.t)}`));
  steps.forEach(([e, [a, b]]) => {
    const arrow = e.dot ? '--)' : e.dash ? '-)' : '->>';
    out.push(`    ${mid(a.id)}${arrow}${mid(b.id)}: ${mtext(lines(e).join(', ') || 'request')}`);
  });
  return out.join('\n') + '\n';
}

/* ---------------------------------------------------------------- badges as standalone SVG */
function badgeSVG(id, B, GLYPHS, ink = '#333333') {
  if (id.startsWith('g:')) {
    const d = GLYPHS[id.slice(2)]; if (!d) return null;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${d}" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  const b = B[id]; if (!b) return null;
  if (b.k === 'si') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${b.hex}" d="${b.d}"/></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${b.vb}">${b.svg}</svg>`;
}
const b64 = s => Buffer.from(s, 'utf8').toString('base64');

/* ---------------------------------------------------------------- draw.io */
const xa = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
const hx = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toDrawio(M, S, B, GLYPHS) {
  const cells = [], abs = {};
  const solid = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null;
  const bg = solid(S.bg) || '#ffffff', ink = solid(S.ink) || '#111111', sub = solid(S.sub) || '#555555';
  const depth = z => { let d = 0, p = z; while ((p = DM.parentZone(M, p)) && d < 9) d++; return d; };
  const colourOf = z => { let p = z, i = 0; while (p && !p.c && i++ < 9) p = DM.parentZone(M, p); return p ? (S.pal[p.c] || {}) : {}; };
  const geo = (o, parent) => { const px = parent ? abs[parent].x : 0, py = parent ? abs[parent].y : 0; return `<mxGeometry x="${o.x - px}" y="${o.y - py}" width="${o.w}" height="${o.h}" as="geometry"/>`; };
  const DASH = { vpc: '8 5', cluster: '8 5', subnet: '3 3', namespace: '3 3', vlan: '3 3' };
  M.zones.slice().sort((a, b) => depth(a) - depth(b)).forEach(z => {
    const p = DM.parentZone(M, z), c = colourOf(z), nested = !!p;
    const stroke = solid(c.stroke) || sub, fill = nested ? 'none' : (solid(c.fill) || 'none');
    const id = 'z-' + z.id, parent = p ? 'z-' + p.id : null;
    abs[id] = { x: z.x, y: z.y };
    const label = (z.n ? z.n + '  ' : '') + (z.kind && nested ? z.kind.toUpperCase() + '  ' : '') + z.t;
    const st = `rounded=1;arcSize=${nested ? 2 : 3};whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;verticalAlign=top;align=left;spacingLeft=10;spacingTop=4;fontStyle=1;fontSize=${nested ? 12 : 14};` +
      `fillColor=${fill};strokeColor=${stroke};fontColor=${ink};strokeWidth=${nested ? 1.25 : 1.5};` + (DASH[z.kind] && nested ? `dashed=1;dashPattern=${DASH[z.kind]};` : '');
    cells.push(`<mxCell id="${id}" value="${xa(label)}" style="${st}" vertex="1" parent="${parent || 1}">${geo(z, parent)}</mxCell>`);
  });
  const nodeFill = solid(S.node.fill) || bg, nodeStroke = solid(S.node.stroke) || sub;
  M.nodes.forEach(n => {
    const z = DM.zoneOf(M, n), parent = z ? 'z-' + z.id : null, id = 'n-' + n.id;
    const value = `<b>${hx(n.t)}</b>` + (n.s || []).map(s => `<br><font color="${sub}" style="font-size:11px">${hx(s)}</font>`).join('');
    const hasB = !!(n.b && badgeSVG(n.b, B, GLYPHS, ink));
    const st = `rounded=1;arcSize=${Math.min(20, (S.node.r || 0) * 2)};whiteSpace=wrap;html=1;fillColor=${nodeFill};strokeColor=${n.ghost ? sub : nodeStroke};fontColor=${ink};fontSize=13;` +
      (n.ghost ? 'dashed=1;opacity=80;' : '') + (hasB ? (n.lay === 'top' ? 'verticalAlign=bottom;spacingBottom=8;' : 'align=left;spacingLeft=54;') : '');
    cells.push(`<mxCell id="${id}" value="${xa(value)}" style="${st}" vertex="1" parent="${parent || 1}">${geo(n, parent)}</mxCell>`);
    abs[id] = { x: n.x, y: n.y };
    if (hasB) {
      const s = 34, bx = n.lay === 'top' ? n.x + (n.w - s) / 2 : n.x + 12, by = n.lay === 'top' ? n.y + 10 : n.y + (n.h - s) / 2;
      cells.push(`<mxCell id="${id}-badge" value="" style="shape=image;html=1;imageAspect=1;aspect=fixed;image=data:image/svg+xml,${b64(badgeSVG(n.b, B, GLYPHS, ink))};" vertex="1" parent="${id}"><mxGeometry x="${bx - n.x}" y="${by - n.y}" width="${s}" height="${s}" as="geometry"/></mxCell>`);
    }
  });
  const E = S.edge, hot = E.hot || { c: E.c, sw: E.sw * 1.9 };
  M.edges.forEach((e, i) => {
    const [a, b] = DM.ends(M, e), pts = e.pts || [];
    // A named flow keeps its colour (STANDARD.md), so draw.io shows the same meaning as the SVG.
    const fl = e.f && M.flows && M.flows[e.f], fc = fl && DM.flowHues(S.bg)[fl.c];
    const col = fc || solid(e.hot ? hot.c : E.c) || ink, sw = e.hot ? hot.sw : fc ? Math.max(2.4, E.sw * 1.6) : E.sw;
    const st = `edgeStyle=orthogonalEdgeStyle;rounded=${E.r ? 1 : 0};html=1;strokeColor=${col};strokeWidth=${sw};fontColor=${ink};fontSize=11;labelBackgroundColor=${bg};` +
      `endArrow=${e.head === 'none' ? 'none' : (E.head === 'open' ? 'open' : 'block')};endFill=1;` + (e.dash ? 'dashed=1;dashPattern=6 5;' : '') + (e.dot ? 'dashed=1;dashPattern=1 4;' : '');
    const inner = pts.slice(1, -1).map(p => `<mxPoint x="${p[0]}" y="${p[1]}"/>`).join('');
    const ends = (a ? '' : `<mxPoint x="${pts[0][0]}" y="${pts[0][1]}" as="sourcePoint"/>`) + (b ? '' : `<mxPoint x="${pts.at(-1)[0]}" y="${pts.at(-1)[1]}" as="targetPoint"/>`);
    const label = (e.step ? `${e.step}. ` : '') + lines(e).join('\n');
    cells.push(`<mxCell id="e${i + 1}" value="${xa(label)}" style="${st}" edge="1" parent="1"${a ? ` source="n-${a.id}"` : ''}${b ? ` target="n-${b.id}"` : ''}>` +
      `<mxGeometry relative="1" as="geometry">${ends}${inner ? `<Array as="points">${inner}</Array>` : ''}</mxGeometry></mxCell>`);
  });
  (M.labels || []).forEach((l, i) => cells.push(`<mxCell id="l${i + 1}" value="${xa(l.t)}" style="text;html=1;align=center;fontColor=${sub};fontSize=12;" vertex="1" parent="1"><mxGeometry x="${l.x - 100}" y="${l.y - 14}" width="200" height="20" as="geometry"/></mxCell>`));
  const head = `<mxCell id="title" value="${xa(M.title)}" style="text;html=1;fontSize=24;fontStyle=1;align=left;fontColor=${ink};" vertex="1" parent="1"><mxGeometry x="20" y="30" width="${M.w - 40}" height="40" as="geometry"/></mxCell>` +
    `<mxCell id="meta" value="${xa([M.type, M.scope, M.updated && 'Updated ' + M.updated].filter(Boolean).join('  ·  '))}" style="text;html=1;fontSize=12;align=left;fontColor=${sub};" vertex="1" parent="1"><mxGeometry x="20" y="${M.h + 6}" width="${M.w - 40}" height="20" as="geometry"/></mxCell>`;
  return `<mxfile host="cloud-native-diagrams" type="device"><diagram id="${xa(M.id)}" name="${xa(M.title)}"><mxGraphModel grid="1" gridSize="10" page="0" background="${bg}"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${head}${cells.join('')}</root></mxGraphModel></diagram></mxfile>\n`;
}

/* ---------------------------------------------------------------- Excalidraw badge sheet */
function badgeScene(B, GLYPHS, groups, words) {
  const now = Date.now(); let seed = 1;
  const base = (o) => Object.assign({ angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid',
    roughness: 0, opacity: 100, frameId: null, roundness: null, seed: seed, version: 1, versionNonce: seed++, isDeleted: false, boundElements: null,
    updated: now, link: null, locked: false }, o);
  const text = (id, x, y, w, t, size, g) => base({ type: 'text', id, x, y, width: w, height: size * 1.25, groupIds: g, text: t, originalText: t, fontSize: size,
    fontFamily: 2, textAlign: 'center', verticalAlign: 'top', containerId: null, autoResize: true, lineHeight: 1.25 });
  const els = [], files = {};
  const ids = Object.keys(B).filter(i => !words.length || words.some(w => i.includes(w) || B[i].n.toLowerCase().includes(w)));
  let y = 0;
  Object.entries(groups).forEach(([g, gname]) => {
    const mine = ids.filter(i => B[i].g === g); if (!mine.length) return;
    els.push(Object.assign(text(`h-${g}`, 0, y, 600, gname, 20, []), { textAlign: 'left' }));
    y += 40;
    mine.forEach((id, k) => {
      const x = (k % 8) * 120, yy = y + Math.floor(k / 8) * 110, fid = 'f-' + id, gid = 'g-' + id;
      files[fid] = { mimeType: 'image/svg+xml', id: fid, dataURL: 'data:image/svg+xml;base64,' + b64(badgeSVG(id, B, GLYPHS)), created: now };
      els.push(base({ type: 'image', id: 'i-' + id, x: x + 32, y: yy, width: 48, height: 48, groupIds: [gid], strokeColor: 'transparent', status: 'saved', fileId: fid, scale: [1, 1] }));
      els.push(text('t-' + id, x, yy + 54, 112, B[id].n, 12, [gid]));
    });
    y += Math.ceil(mine.length / 8) * 110 + 30;
  });
  return { type: 'excalidraw', version: 2, source: 'https://github.com/river-banks/cloud-native-diagrams/tree/main/diagrams', elements: els, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files };
}

module.exports = { toMermaid, toSequence, toDrawio, badgeSVG, badgeScene };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const icons = flag('--icons'), styleId = flag('--style') || 'clear', theme = flag('--theme') || 'light';
  const [fmt, a1, a2, ...rest] = argv;
  const usage = () => { console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 7).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(2); };
  if (!fmt || !a1) usage();
  const BD = load(path.join(HERE, 'badges', 'badges.json')), GLYPHS = load(path.join(HERE, 'badges', 'glyphs.json'));
  const write = (out, txt) => { if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, txt); console.log(out); } else process.stdout.write(txt); };
  (async () => {
    if (fmt === 'badges') return write(a1, JSON.stringify(badgeScene(BD.badges, GLYPHS, BD.groups, [a2, ...rest].filter(Boolean).map(w => w.toLowerCase()))));
    const M = await layout(load(a1));
    if (fmt === 'mermaid') return write(a2, toMermaid(M, { icons }));
    if (fmt === 'sequence') return write(a2, toSequence(M));
    if (fmt === 'drawio') {
      const all = fs.readdirSync(path.join(HERE, 'styles')).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(HERE, 'styles', f), 'utf8')));
      const id = DM.lookId(all, styleId);
      if (!id) { console.error(`no look "${styleId}". Looks: ${all.filter(s => s.offered).map(s => s.name).join(', ')}`); process.exit(2); }
      const sf = path.join(HERE, 'styles', id + '.json');
      return write(a2, toDrawio(M, themeStyle(load(sf), theme), BD.badges, GLYPHS));
    }
    usage();
  })().catch(e => { console.error(`${a1}: ${e.message}`); process.exit(1); });
}
