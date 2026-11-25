/* Reading a diagram model: which box each line starts and ends at, which zone holds a box,
   and a plain-language description. Shared by the renderer (in the browser) and the
   exporters (in Node: export.js mermaid, drawio, excalidraw). No drawing here. */
const DiagramModel = (() => {
  const inBox = (p, n, pad = 4) => p && n.x !== undefined && p[0] >= n.x - pad && p[0] <= n.x + n.w + pad && p[1] >= n.y - pad && p[1] <= n.y + n.h + pad;
  const boxAt = (M, p) => (M.nodes || []).find(n => inBox(p, n));
  const byId = M => Object.fromEntries((M.nodes || []).map(n => [n.id, n]));

  // [fromNode, toNode] for one edge; either can be null (a tee that starts on another line, a line to nowhere).
  function ends(M, e) {
    const ids = byId(M), pts = e.pts || [];
    const a = ids[e.from] || (e.tee ? null : boxAt(M, pts[0]));
    const b = ids[e.to] || boxAt(M, pts[pts.length - 1]);
    return [a || null, b || null];
  }

  // The innermost zone that holds a box: its "in", or the smallest zone around it.
  function zoneOf(M, n) {
    const zs = M.zones || [];
    if (n.in) return zs.find(z => z.id === n.in) || null;
    const around = zs.filter(z => n.x >= z.x && n.y >= z.y && n.x + n.w <= z.x + z.w && n.y + n.h <= z.y + z.h);
    return around.sort((a, b) => a.w * a.h - b.w * b.h)[0] || null;
  }

  // The zone a zone sits in: its "in", or the smallest zone around it.
  function parentZone(M, z) {
    const zs = M.zones || [];
    if (z.in) return zs.find(o => o.id === z.in) || null;
    const around = zs.filter(o => o !== z && z.x >= o.x && z.y >= o.y && z.x + z.w <= o.x + o.w && z.y + z.h <= o.y + o.h);
    return around.sort((a, b) => a.w * a.h - b.w * b.h)[0] || null;
  }

  const label = e => (Array.isArray(e.l) ? e.l : e.l ? [e.l] : []).filter(Boolean).join(', ');
  const lineKind = e => e.dot ? 'to confirm' : e.dash ? 'async' : '';

  // A screen-reader description: what the picture is, the zones and their boxes, then every line in step order.
  function describe(M) {
    const out = [];
    out.push(`${M.type || 'Diagram'}: ${M.title}.` + (M.scope ? ` Scope: ${M.scope}.` : '') + (M.updated ? ` Updated ${M.updated}.` : ''));
    (M.zones || []).forEach(z => {
      const inside = (M.nodes || []).filter(n => zoneOf(M, n) === z).map(n => n.t + (n.ghost ? ' (planned)' : ''));
      const p = parentZone(M, z);
      out.push(`${z.kind ? z.kind[0].toUpperCase() + z.kind.slice(1) + ' ' : 'Zone '}${z.n ? z.n + ' ' : ''}"${z.t}"${p ? ` inside "${p.t}"` : ''}${inside.length ? ': ' + inside.join(', ') : ''}.`);
    });
    const loose = (M.nodes || []).filter(n => !zoneOf(M, n)).map(n => n.t);
    if (loose.length) out.push(`Also: ${loose.join(', ')}.`);
    const edges = (M.edges || []).filter(e => !e.quiet).map(e => [e, ends(M, e)]).filter(([, [a, b]]) => a && b);
    edges.sort((x, y) => (x[0].step || 99) - (y[0].step || 99));
    edges.forEach(([e, [a, b]]) => {
      const bits = [label(e), lineKind(e), e.hot ? 'main path' : ''].filter(Boolean).join('; ');
      out.push(`${e.step ? 'Step ' + e.step + ': ' : ''}${a.t} to ${b.t}${bits ? ' (' + bits + ')' : ''}.`);
    });
    return out.join(' ');
  }

  // The numbered (step) lines as a sequence diagram: one box per participant in order of first use,
  // a lifeline under each, and one arrow per step, top to bottom. It is an ordinary model, so every style draws it.
  function sequence(M) {
    const steps = (M.edges || []).filter(e => e.step).map(e => [e, ends(M, e)]).filter(([, [a, b]]) => a && b && a !== b).sort((x, y) => x[0].step - y[0].step);
    const who = [];
    steps.forEach(([, [a, b]]) => [a, b].forEach(n => { if (!who.includes(n)) who.push(n); }));
    const BW = 180, GAP = 70, X0 = 30, Y0 = 110, BH = 40 + 16 * Math.max(1, ...who.map(n => (n.s || []).length)), ROW = 76, top = Y0 + BH + 56;
    const cx = n => X0 + who.indexOf(n) * (BW + GAP) + BW / 2;
    const bottom = top + Math.max(1, steps.length) * ROW;
    const nodes = who.map((n, i) => {
      const z = zoneOf(M, n);
      return { id: n.id, t: n.t, s: n.s || [], b: n.b, x: X0 + i * (BW + GAP), y: Y0, w: BW, h: BH, tone: z && z.c, hero: n.hero, ghost: n.ghost, tag: n.tag };
    });
    const edges = who.map(n => ({ pts: [[cx(n), Y0 + BH], [cx(n), bottom]], head: 'none', quiet: 1 }));
    steps.forEach(([e, [a, b]], k) => {
      const y = top + k * ROW + 20;
      edges.push({ pts: [[cx(a), y], [cx(b), y]], step: e.step, hot: e.hot, f: e.f, dash: e.dash, dot: e.dot, l: e.l || ['step ' + e.step], from: a.id, to: b.id });
    });
    return Object.assign({}, M, {
      id: M.id + '-sequence', title: M.title, kicker: 'Sequence view', type: 'Sequence', w: Math.max(560, X0 * 2 + who.length * (BW + GAP) - GAP),
      h: bottom + 24, zones: [], panels: [], labels: [], nodes, edges, view: 'sequence',
    });
  }

  // Flow hues (STANDARD.md): Okabe-Ito, safe for colour-blind readers. The light set is darkened where needed so every
  // hue is at least 3:1 on every light style background; the dark set is for dark pages. check.js holds both to 3:1.
  const FLOW_HUES = {
    light: { blue: '#0072B2', orange: '#A87400', green: '#008C66', pink: '#B8608F', sky: '#1F86C4', vermillion: '#D55E00', grey: '#6e7781' },
    dark: { blue: '#4c8df6', orange: '#f0b443', green: '#3cc6a0', pink: '#e39ac4', sky: '#a6e6ff', vermillion: '#f08a4b', grey: '#9aa4ae' },
  };
  const lum = hex => { const n = parseInt(hex.slice(1), 16); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(n >> 16) + .7152 * f(n >> 8 & 255) + .0722 * f(n & 255); };
  // A #rgb or #rrggbb background darker than this takes the dark set.
  const isDark = bg => { let h = String(bg || '').trim(); if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + [...h.slice(1)].map(c => c + c).join(''); return /^#[0-9a-f]{6}$/i.test(h) && lum(h) < .2; };
  const flowHues = bg => FLOW_HUES[isDark(bg) ? 'dark' : 'light'];

  // The style id for a look the user named: the id or the display name, any case ("Isometric", "iso", "DARK"). null if none.
  const lookId = (styles, name) => { const k = String(name || '').trim().toLowerCase(); const s = styles.find(s => String(s.id).toLowerCase() === k || String(s.name).toLowerCase() === k); return s ? s.id : null; };

  return { lookId, ends, zoneOf, parentZone, describe, label, lineKind, inBox, sequence, FLOW_HUES, flowHues, isDark };
})();
if (typeof module !== 'undefined') module.exports = DiagramModel;
