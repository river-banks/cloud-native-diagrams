/* Label: the one place for label text sizes, the 12 px floor and the fit rule. Both the flat and isometric
   bodies of drawDiagram take every label size from here; change a size or the floor here and nowhere else.
     Label.MIN               12: the smallest body text (STANDARD rule 8)
     Label.size(kind, S)     the size in px of one kind of label in style S: its base size, raised to MIN
                             when the base is smaller, so no label ever starts under 12 px. Kinds:
                               title, sub          a node's title and its sub-lines (from the style's node.size, node.subSize)
                               panelHead, panelItem a side list's head line and its other lines
                               isoPanelHead         an isometric side list's first line (isoPanelItem is the same as sub)
                               tag                  a status tag pill's text
                               key, keyHead         a key entry, and the "Key" heading (size depends on the title mode)
                               zone, zoneInline     a zone's title, and one drawn inside a thin inline zone
                               boundaryKind, boundary  a nested zone's kind word (VPC, CLUSTER) and its name
                               isoZoneSub           a nested zone's title on an isometric plate
                               line, lineSub        a line label's first line and the lines under it
                               free, isoFree        a free label in the flat and the isometric view
     Label.base(kind, S)     the style's own size for a kind, before the floor (size() is what drawing uses)
     Label.fit(t, size, max) shrinks the text element t (drawn at size) to fit max px wide, never below
                             Label.MIN. Text that still does not fit keeps that size and is marked
                             data-overflow="1", for the checks to catch, rather than shrinking further.
     Label.wrap(t, size, max, lh)  fit(), and when that still overflows, break t at spaces into lines lh apart
                             (tspans) that each fit at the floor size. A word too wide on its own (shop.example.com,
                             ingress-nginx) is also broken after . - / _ or :. Returns the number of lines; a piece
                             still too wide is marked data-overflow.
     Label.move(t, x, y)     put a fitted or wrapped text element at x, y (its lines follow).
     Label.floor()           MIN: nothing shrinks below it.
   Every text element also carries data-kind (the kind above, or heading, kicker, code, number, step, meta for the fixed
   text the renderer draws), so check.js can name what is under 12 px. */
const Label = {
  MIN: 12,
  size(kind, S) { return Math.max(Label.MIN, Label.base(kind, S)); },
  base(kind, S) {
    const N = S.node, Z = S.zone, T = S.title || {};
    switch (kind) {
      case 'title': return N.size;
      case 'sub': case 'isoPanelItem': return N.subSize;
      case 'panelHead': return N.size + 1;
      case 'panelItem': case 'isoPanelHead': return N.subSize + 1;
      case 'tag': case 'boundaryKind': return 10.5;
      case 'key': case 'line': case 'boundary': case 'isoFree': return 12.5;
      case 'keyHead': return T.mode === 'band' ? 12 : T.mode === 'box' ? 16 : 11.5;
      case 'zone': return Z.size;
      case 'zoneInline': return Z.size + 4;
      case 'isoZoneSub': return 11.5;
      case 'lineSub': return 12;
      case 'free': return 13.5;
    }
    throw new Error('Label.size: unknown kind ' + kind);
  },
  floor() { return Label.MIN; },
  fit(t, size, max) {
    const w = t.getComputedTextLength();
    if (!(w > max)) return t;
    const want = size * max / w, fs = Math.max(Label.floor(size), want);
    if (fs < size) t.setAttribute('font-size', fs.toFixed(2));
    if (want < fs) t.setAttribute('data-overflow', '1');
    return t;
  },
  wrap(t, size, max, lh) {
    if (!Label.fit(t, size, max).hasAttribute('data-overflow')) return 1;
    t.removeAttribute('data-overflow');
    const wide = s => { t.textContent = s; return t.getComputedTextLength() > max; };
    // Words, each with the separator that goes before it. A word too wide on its own (a host name, a
    // hyphenated name) is cut after . - / _ : into pieces that join back with no space.
    const parts = [];
    for (const w of t.textContent.split(/\s+/).filter(Boolean)) {
      if (!wide(w)) { parts.push([' ', w]); continue; }
      w.split(/(?<=[.\-\/_:])(?=.)/).forEach((p, i) => parts.push([i ? '' : ' ', p]));
    }
    const lines = [];
    let cur = '';
    for (const [sep, w] of parts) {
      const s = cur ? cur + sep + w : w;
      if (cur && wide(s)) { lines.push(cur); cur = w; } else cur = s;
    }
    lines.push(cur);
    t.textContent = '';
    lines.forEach((ln, i) => {
      const sp = document.createElementNS(t.namespaceURI, 'tspan');
      sp.setAttribute('x', t.getAttribute('x')); if (i) sp.setAttribute('dy', lh);
      sp.textContent = ln; t.appendChild(sp);
      if (sp.getComputedTextLength() > max) t.setAttribute('data-overflow', '1');
    });
    return lines.length;
  },
  move(t, x, y) {
    t.setAttribute('x', x); t.setAttribute('y', y);
    for (const sp of t.querySelectorAll('tspan')) sp.setAttribute('x', x);
  },
};

/* drawDiagram(svg, MODEL, STYLE, BADGES): one renderer, many styles.
   MODEL is an examples/*.json file, STYLE a styles/*.json file, BADGES the badges map from badges/badges.json.
   Needs the global GLYPHS (badges/glyphs.json) and, for styles with "rough", the rough.js global.
   Label sizes and the fit rule come from Label above; text that cannot fit its box at 12 px is marked
   data-overflow="1" so the checks can catch it.
   Below the model's own height it draws a footer: a key built from what the model uses, and the
   diagram's type, scope and last-updated date. The drawn size is left on the svg as data-w and data-h. */
function drawDiagram(svg, M0, S, B) {
  let M = Object.assign({ kicker: "", zones: [], nodes: [], edges: [], labels: [], panels: [] }, M0);
  const NS = 'http://www.w3.org/2000/svg';
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', `0 0 ${M.w} ${M.h}`);
  // Accessible name and description, kept in the exported SVG too.
  const uid = 'dg' + (drawDiagram.n = (drawDiagram.n || 0) + 1);
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-labelledby', `${uid}-t ${uid}-d`); svg.removeAttribute('aria-label');
  const tEl = document.createElementNS(NS, 'title'); tEl.id = uid + '-t'; tEl.textContent = `${M.title}${S.name ? `, ${S.name} style` : ''}`; svg.appendChild(tEl);
  const dEl = document.createElementNS(NS, 'desc'); dEl.id = uid + '-d'; dEl.textContent = typeof DiagramModel !== 'undefined' ? DiagramModel.describe(M) : M.title; svg.appendChild(dEl);
  const rc = S.rough && window.rough ? rough.svg(svg) : null;
  let seed = 7;
  const el = (tag, at, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in at) if (at[k] !== undefined && at[k] !== null) e.setAttribute(k, at[k]);
    (parent || svg).appendChild(e); return e;
  };
  const N = S.node, Z = S.zone, E = Object.assign({}, S.edge);
  const L = kind => Label.size(kind, S);   // every label's base size
  const CARD = S.card || '#ffffff', RULE = S.rule || '#111111';   // light surfaces (title box, number discs) and the Transit rule
  // Every style shows the main path: styles without their own "hot" draw it thicker in the line colour.
  if (!E.hot) E.hot = { c: E.c, sw: +(E.sw * 1.9).toFixed(2) };
  const pal = c => S.pal[c] || {};
  const lum = hex => { const n = parseInt(hex.slice(1), 16); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(n >> 16) + .7152 * f(n >> 8 & 255) + .0722 * f(n & 255); };
  // Flows (the standard, STANDARD.md): when colour on lines means one thing, such as which door or which kind of
  // traffic, the model names its flows ("flows": {"api": {"t": "Kubernetes API", "c": "blue"}}) and each edge says "f": "api".
  // The hues live in model.js (Okabe-Ito, with lighter twins for dark pages). Every style draws them.
  const DARKBG = DiagramModel.isDark(S.bg);
  const FLOW = DiagramModel.flowHues(S.bg), FLOW_SW = Math.max(2.4, E.sw * 1.6);
  const flowOf = e => e && e.f && M0.flows ? M0.flows[e.f] : null;
  const flowCol = f => FLOW[f.c];
  // One line's colour and width. A quiet line (lifeline, guide) stays thin and grey even if it names a flow;
  // the main path keeps its width; a flow line is a little wider so its colour reads.
  const lineLook = ed => {
    const hot = ed.hot && E.hot, fl = flowOf(ed);
    if (ed.quiet) return { hot: false, col: S.sub, sw: 1 };
    return { hot, col: fl ? flowCol(fl) : hot ? E.hot.c : E.c, sw: hot ? E.hot.sw : fl ? FLOW_SW : E.sw };
  };
  const tagOf = nd => nd.tag && M0.tags ? M0.tags[nd.tag] : null;
  // Status tags (NEW RULE, OPEN, PLANNED...): a pill on the box's top edge, so line colour never has to mean status too.
  const TAGK = { bad: ['#b42318', '#b42318', '#ffffff'], good: [S.bg, '#1a7f37', '#1a7f37'], info: [S.bg, S.sub, S.ink] };
  if (DARKBG) { TAGK.good = [S.bg, '#4ac26b', '#4ac26b']; TAGK.bad = ['#e5534b', '#e5534b', '#ffffff']; }
  function tagPill(tg, x, y, parent) {
    const [fill, stroke, ink] = TAGK[tg.k] || TAGK.info;
    const g = el('g', { class: 'tag' }, parent), bg = el('rect', { x, y, height: 18, rx: 9, fill, stroke, 'stroke-width': 1.2 }, g);
    const t = text(x + 9, y + 13, tg.t.toUpperCase(), { size: L('tag'), kind: 'tag', weight: 700, fill: ink, ls: .5, font: S.subFont }, g);
    const w = t.getComputedTextLength() + 18; bg.setAttribute('width', w); return w;
  }
  const rrPath = (x, y, w, h, r) => r ? `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z` : `M${x} ${y}H${x + w}V${y + h}H${x}Z`;

  function rect(x, y, w, h, o, parent) {
    const g = parent || svg;
    if (rc) {
      if (o.fill && o.fill !== 'none') el('path', { d: rrPath(x, y, w, h, o.r || 0), fill: o.fill }, g);
      if (o.hatch) g.appendChild(rc.path(rrPath(x + 2, y + 2, w - 4, h - 4, o.r || 0), { seed: seed++, stroke: 'none', fill: o.hatch, fillStyle: 'hachure', hachureGap: 7, hachureAngle: -41, fillWeight: .7, roughness: .9 }));
      if (o.stroke && o.stroke !== 'none') g.appendChild(rc.path(rrPath(x, y, w, h, o.r || 0), { seed: seed++, stroke: o.stroke, strokeWidth: o.sw || 1.4, roughness: S.rough.roughness, bowing: S.rough.bowing, strokeLineDash: o.dash ? (Array.isArray(o.dash) ? o.dash : [7, 6]) : undefined }));
      return;
    }
    el('rect', { x, y, width: w, height: h, rx: o.r || 0, fill: o.fill || 'none', stroke: o.stroke || 'none', 'stroke-width': o.sw || 1, 'stroke-dasharray': o.dash || null }, g);
  }
  function text(x, y, s, o, parent) {
    const t = el('text', { x, y, fill: o.fill || S.ink, 'font-family': `'${o.font || S.font}', sans-serif`, 'font-size': o.size || 14, 'font-weight': o.weight || 400, 'text-anchor': o.anchor || 'start', 'letter-spacing': o.ls || null, 'data-kind': o.kind || null }, parent);
    t.textContent = o.upper ? s.toUpperCase() : s;
    if (o.max) Label.fit(t, o.size || 14, o.max);
    return t;
  }
  function glyph(name, x, y, size, color, sw, parent) {
    const g = el('g', { transform: `translate(${x} ${y}) scale(${size / 24})` }, parent);
    el('path', { d: GLYPHS[name], fill: 'none', stroke: color, 'stroke-width': sw || 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  }
  function stepMark(cx, cy, n, parent) {
    el('circle', { cx, cy, r: 10, fill: E.stepFill || '#16191f' }, parent);
    text(cx, cy + 4.5, String(n), { size: 12, kind: 'step', weight: 700, anchor: 'middle', fill: E.stepInk || '#fff' }, parent);
  }
  // A brand badge in one of five treatments.
  function badge(id, x, y, s, mode, tint, parent) {
    const g = el('g', { class: 'badge', 'data-badge': id }, parent);
    if (id.startsWith('g:')) {
      const name = id.slice(2);
      if (mode === 'native') return glyph(name, x + s * .06, y + s * .06, s * .88, tint || S.ink, 1.8, g);
      const GT = N.glyphTile || {};
      const bg = mode === 'chip' ? '#ffffff' : (GT.bg || tint || '#3d4652');
      const fg = mode === 'chip' ? '#0f2d55' : (GT.fg || '#ffffff');
      if (mode === 'disc') el('circle', { cx: x + s / 2, cy: y + s / 2, r: s / 2, fill: bg }, g);
      else el('rect', { x, y, width: s, height: s, rx: mode === 'tile' ? (N.tileR ?? s * .22) : s * .22, fill: bg }, g);
      return glyph(name, x + s * .2, y + s * .2, s * .6, fg, 2, g);
    }
    const b = B[id]; if (!b) return;
    const title = el('title', {}, g); title.textContent = b.n;
    if (b.k === 'aws' || b.k === 'own') {
      // Full-colour SVG art (official AWS tile or one of our own): keep it as drawn; only round the corners to suit the style.
      const r = mode === 'native' ? .12 : (mode === 'tile' ? (N.tileR !== undefined ? N.tileR / s : .14) : .18);
      // Drawn into a plain <g> with a transform (no nested <svg>), so a page can select a diagram's own
      // top-level <svg> without also hitting every badge.
      const cid = 'clip-' + S.id + '-' + id + '-' + Math.round(x) + '-' + Math.round(y);
      const pad = mode === 'chip' ? s * .12 : 0;
      if (mode === 'chip') el('rect', { x, y, width: s, height: s, rx: s * .18, fill: '#ffffff' }, g);
      if (mode === 'disc') { el('circle', { cx: x + s / 2, cy: y + s / 2, r: s / 2, fill: b.hex }, g); }
      const inner = mode === 'disc' ? s * .1 : pad, iw = s - 2 * inner;
      const cp = el('clipPath', { id: cid }, g);
      el('rect', { x: x + inner, y: y + inner, width: iw, height: iw, rx: r * iw }, cp);
      const [vx, vy, vw, vh] = String(b.vb).trim().split(/[\s,]+/).map(Number), k = Math.min(iw / vw, iw / vh);
      const holder = el('g', { 'clip-path': `url(#${cid})` }, g);
      const n = el('g', { transform: `translate(${+(x + inner + (iw - vw * k) / 2).toFixed(2)} ${+(y + inner + (iw - vh * k) / 2).toFixed(2)}) scale(${+k.toFixed(5)}) translate(${-vx} ${-vy})` }, holder);
      n.innerHTML = b.svg; return;
    }
    // Simple Icons glyph (24 x 24, one path), in the brand colour.
    const light = lum(b.hex) > .55;
    const put = (gx, gy, gs, fill) => { const t = el('g', { transform: `translate(${gx} ${gy}) scale(${gs / 24})` }, g); el('path', { d: b.d, fill }, t); };
    if (mode === 'native') {
      const cb = S.contrastBg || S.bg, dark = cb && cb[0] === '#' && lum(cb) < .2;
      return put(x + s * .05, y + s * .05, s * .9, (dark && lum(b.hex) < .05) ? '#ffffff' : b.hex);
    }
    if (mode === 'chip') { el('rect', { x, y, width: s, height: s, rx: s * .18, fill: '#ffffff' }, g); return put(x + s * .18, y + s * .18, s * .64, lum(b.hex) > .7 ? '#333' : b.hex); }
    const fg = light ? '#111111' : '#ffffff';
    if (mode === 'disc') el('circle', { cx: x + s / 2, cy: y + s / 2, r: s / 2, fill: b.hex }, g);
    else el('rect', { x, y, width: s, height: s, rx: N.tileR ?? s * .22, fill: b.hex }, g);
    put(x + s * .21, y + s * .21, s * .58, fg);
  }

  /* ---- isometric: the whole model is projected; work out the canvas first */
  const ISO = Z.mode === 'iso';
  const ISOK = (S.iso && S.iso.k) || .78, IC = Math.cos(Math.PI / 6) * ISOK, IS = .5 * ISOK, IY0 = 100;
  const FLAT = M;
  let P = null;
  if (ISO) {
    const H0 = M.h - IY0, ox = 30 + H0 * IC, oy = IY0 + 30;
    P = (x, y) => [ox + (x - (y - IY0)) * IC, oy + (x + (y - IY0)) * IS];
    M = Object.assign({}, M, { w: Math.round((M.w + H0) * IC + 60), h: Math.round((M.w + H0) * IS + IY0 + 60) });
  }

  /* ---- background */
  const bgRect = el('rect', { x: 0, y: 0, width: M.w, height: M.h, fill: S.bg });
  const GH = M.h + 240;
  if (S.grid) {
    const gp = el('g', { class: 'grid', stroke: '#ffffff', 'stroke-width': 1 });
    for (let x = 0; x <= M.w; x += 20) el('line', { x1: x, y1: 0, x2: x, y2: GH, 'stroke-opacity': x % 100 ? .05 : .11 }, gp);
    for (let y = 0; y <= GH; y += 20) el('line', { x1: 0, y1: y, x2: M.w, y2: y, 'stroke-opacity': y % 100 ? .05 : .11 }, gp);
  }

  /* ---- title (left out when the model says "header": false: a page that owns the title crops the band, see the end) */
  const T = S.title, HEAD = M0.header !== false;
  if (HEAD && T.mode === 'box') {
    const s = M.kicker ? `${M.title} – ${M.kicker}` : M.title; const w = s.length * T.size * .5 + 60;
    const cx = M.zones.length ? (Math.min(...M.zones.map(z => z.x)) + Math.max(...M.zones.map(z => z.x + z.w))) / 2 : M.w / 2;
    rect(cx - w / 2, 14, w, 64, { r: 12, stroke: S.ink, sw: 1.6, fill: CARD });
    text(cx, 58, s, { size: T.size, kind: 'heading', anchor: 'middle' });
  } else if (HEAD && T.mode === 'band') {
    el('rect', { x: 0, y: 0, width: M.w, height: 76, fill: '#111111' });
    el('rect', { x: 20, y: 22, width: 32, height: 32, fill: '#ffcd00' });
    text(36, 45, M.code || M.title.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(), { size: 14, kind: 'code', weight: 800, anchor: 'middle', fill: '#111111' });
    text(68, 50, M.title, { size: T.size, kind: 'heading', weight: T.weight, fill: '#ffffff' });
    text(M.w - 20, 48, M.kicker.toUpperCase(), { size: 13, kind: 'kicker', weight: 800, anchor: 'end', fill: '#ffcd00', ls: 1.5 });
  } else if (HEAD) {
    text(20, 40, M.kicker, { size: 13, kind: 'kicker', weight: 600, fill: S.sub, upper: 1, ls: 1.6, font: S.subFont });
    text(20, 76, T.upper ? M.title.toUpperCase() : M.title, { size: T.size, kind: 'heading', weight: T.weight });
  }

  if (ISO) drawIso(); else {
  /* ---- zones and panels */
  const zoneOf = n => DiagramModel.zoneOf(M, n);
  const numMark = (cx, cy, n, c) => {
    if (Z.mode === 'tint') { rect(cx - 14, cy - 14, 28, 28, { r: 14, stroke: c.stroke, sw: 1.6, fill: CARD }); text(cx, cy + 6, String(n), { size: 16, kind: 'number', anchor: 'middle', weight: 600 }); }
    else if (Z.mode === 'outline') { el('rect', { x: cx - 12, y: cy - 12, width: 24, height: 24, fill: c.stroke }); text(cx, cy + 5, String(n), { size: 13, kind: 'number', anchor: 'middle', weight: 700, fill: '#fff' }); }
    else if (Z.mode === 'header') { el('circle', { cx, cy, r: 13, fill: '#ffffff' }); text(cx, cy + 5, String(n), { size: 14, kind: 'number', anchor: 'middle', weight: 800, fill: c.stroke }); }
    else if (Z.mode === 'rule') { el('rect', { x: cx - 14, y: cy - 14, width: 28, height: 28, fill: '#ffcd00' }); text(cx, cy + 6, String(n), { size: 16, kind: 'number', anchor: 'middle', weight: 800 }); }
  };
  function frame(z, title, n, icon) {
    const c = pal(z.c), x = z.x, y = z.y, w = z.w, h = z.h;
    const inline = !!z.inline;
    let tx = (z.tx || x + 16), ty = inline ? y + h / 2 + 7 : y + 34, tcol = S.ink, size = L('zone'), weight = 700, upper = 0, ls = null, font = S.font;
    if (Z.mode === 'tint') rect(x, y, w, h, { r: Z.r, fill: c.fill, hatch: c.hatch, stroke: c.stroke, sw: Z.sw });
    if (Z.mode === 'outline') { el('rect', { x, y, width: w, height: h, fill: 'none', stroke: c.stroke, 'stroke-width': Z.sw }); tcol = c.stroke; weight = 600; if (!inline) { tx = z.tx || x; ty = y + 17; } }
    if (Z.mode === 'header') {
      el('rect', { x, y, width: w, height: h, rx: Z.r, fill: c.fill, stroke: c.stroke, 'stroke-width': Z.sw });
      if (inline) { el('path', { d: `M${x + Z.r} ${y}H${x + 380}V${y + h}H${x + Z.r}A${Z.r} ${Z.r} 0 0 1 ${x} ${y + h - Z.r}V${y + Z.r}A${Z.r} ${Z.r} 0 0 1 ${x + Z.r} ${y}Z`, fill: c.stroke }); }
      else el('path', { d: `M${x} ${y + Z.bar}V${y + Z.r}A${Z.r} ${Z.r} 0 0 1 ${x + Z.r} ${y}H${x + w - Z.r}A${Z.r} ${Z.r} 0 0 1 ${x + w} ${y + Z.r}V${y + Z.bar}Z`, fill: c.stroke });
      tcol = '#ffffff'; weight = 800; if (!inline) ty = y + 28; if (!inline && z.tx) tx = x + 16;
    }
    if (Z.mode === 'dash') { el('rect', { x, y, width: w, height: h, rx: Z.r, fill: '#ffffff', 'fill-opacity': .035, stroke: c.stroke, 'stroke-width': Z.sw, 'stroke-dasharray': '7 5' }); tcol = c.stroke; upper = 1; ls = 1.4; weight = 600; }
    if (Z.mode === 'rule') { el('rect', { x, y, width: w, height: h, fill: Z.fill || '#f3f2ee' }); el('rect', { x, y, width: w, height: 4, fill: RULE }); weight = 800; if (!inline) ty = y + 38; }
    if (Z.mode === 'bar') { el('rect', { x, y, width: w, height: h, rx: Z.r, fill: Z.fill, stroke: Z.line, 'stroke-width': 1 }); el('path', { d: `M${x + Z.r} ${y}V${y + h}` , stroke: 'none' }); el('rect', { x, y: y + 1, width: 4, height: h - 2, rx: 2, fill: c.stroke }); tcol = c.stroke; upper = 1; ls = 1.2; weight = 700; }
    // title row
    let ox = tx;
    if (icon && Z.mode === 'outline' && !inline) { el('rect', { x, y, width: 24, height: 24, fill: c.stroke }); glyph(icon, x + 3, y + 3, 18, '#fff', 2.2); }
    if (icon && (Z.mode !== 'outline' || inline)) {
      const isz = 26;
      if (Z.mode === 'header' && !inline) glyph(icon, ox, ty - 19, 24, '#fff', 2);
      else glyph(icon, ox, ty - (inline ? 19 : 20), isz, Z.mode === 'header' ? '#fff' : (Z.mode === 'rule' || Z.mode === 'tint' ? (c.stroke || S.ink) : (c.stroke || S.ink)), 2);
      ox += 36;
    }
    if (n) {
      if (Z.mode === 'dash' || Z.mode === 'bar') { text(ox, ty, String(n).padStart(2, '0'), { size, kind: 'number', weight: 700, fill: tcol, font: S.subFont }); ox += size * 2; }
      else if (Z.mode === 'outline') { numMark(x + 12, y + 12, n, c); ox = x + 32; ty = y + 17; }
      else { numMark(ox + 14, ty - 7, n, c); ox += 38; }
    }
    if (Z.mode === 'outline' && !n && !inline) ox = x + (icon ? 32 : 10);
    text(ox, ty, title, { size: inline ? L('zoneInline') : size, kind: inline ? 'zoneInline' : 'zone', weight, fill: tcol, upper, ls, font, max: inline ? 340 : z.x + z.w - ox - 12 });
  }
  // Zones inside zones (a namespace in a cluster in a region) are drawn as boundaries, parents first.
  const parentOf = z => DiagramModel.parentZone(M, z);
  const depth = z => { let d = 0, p = z; while ((p = parentOf(p)) && d < 9) d++; return d; };
  const zoneColour = z => { let p = z, i = 0; while (p && !p.c && i++ < 9) p = parentOf(p); return p ? p.c : null; };
  const KIND = { cloud: ['cloud', 'solid'], region: ['globe', 'solid'], site: ['building', 'solid'], vpc: ['layers', 'dash'], cluster: ['boxes', 'dash'],
                 subnet: ['port', 'fine'], namespace: ['box', 'fine'], vlan: ['cable', 'fine'], node: ['server', 'solid'] };
  function boundary(z) {
    const col = pal(zoneColour(z)).stroke || S.sub, [icon, pat] = KIND[z.kind] || ['layers', 'dash'];
    const dash = pat === 'dash' ? [8, 5] : pat === 'fine' ? [3, 3] : null, r = Math.min(Z.r || 0, 10);
    const g = el('g', { class: 'boundary', 'data-id': z.id, 'data-kind': z.kind || '' });
    if (!rc) el('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: r, fill: col, 'fill-opacity': .045 }, g);
    rect(z.x, z.y, z.w, z.h, { r, stroke: col, sw: pat === 'solid' ? 1.5 : 1.25, dash }, g);
    glyph(icon, z.x + 9, z.y + 7, 17, col, 2, g);
    let x = z.x + 33, y = z.y + 20;
    if (z.kind) { const k = text(x, y, z.kind.toUpperCase(), { size: L('boundaryKind'), kind: 'boundaryKind', weight: 700, fill: S.sub, font: S.subFont, ls: 1 }, g); x += k.getComputedTextLength() + 8; }
    const t = text(x, y, z.t, { size: L('boundary'), kind: 'boundary', weight: 700, fill: S.ink }, g);
    // No room beside the kind word: the name goes on its own line under it, still inside the 40 px title room.
    if (x > z.x + 33 && t.getComputedTextLength() > z.x + z.w - x - 10) { x = z.x + 33; y = z.y + 35; Label.move(t, x, y); }
    Label.fit(t, L('boundary'), z.x + z.w - x - 10);
  }
  M.zones.slice().sort((a, b) => depth(a) - depth(b)).forEach(z => depth(z) ? boundary(z) : frame(z, z.t, z.n, z.inline));
  M.panels.forEach(p => {
    frame(p, p.t, null, p.icon);
    const c = pal(p.c);
    let y = p.y + (Z.mode === 'outline' ? 60 : 74);
    p.items.forEach((it, i) => {
      const lines = p.kind === 'num' ? it : it;
      if (p.kind === 'check') glyph('check', p.x + 18, y - 17, 22, Z.mode === 'header' || Z.mode === 'tint' || Z.mode === 'outline' || Z.mode === 'bar' || Z.mode === 'dash' ? (c.stroke || S.ink) : S.ink, 2.4);
      else {
        const cx = p.x + 30, cy = y - 6;
        if (Z.mode === 'rule') { el('rect', { x: cx - 13, y: cy - 13, width: 26, height: 26, fill: '#ffcd00' }); }
        else if (rc) rect(cx - 13, cy - 13, 26, 26, { r: 13, stroke: c.stroke, sw: 1.4, fill: CARD });
        else el('circle', { cx, cy, r: 12, fill: Z.mode === 'header' || Z.mode === 'outline' ? c.stroke : 'none', stroke: c.stroke || S.ink, 'stroke-width': 1.5 });
        text(cx, cy + 5, String(i + 1), { size: 13.5, kind: 'number', anchor: 'middle', weight: 700, fill: Z.mode === 'header' || Z.mode === 'outline' ? '#fff' : (Z.mode === 'rule' ? '#111' : (c.stroke || S.ink)), font: S.subFont });
      }
      lines.forEach((ln, j) => {
        const head = p.kind === 'num' && j === 0;
        text(p.x + 56, y + j * 22, ln, { max: p.w - 68, size: head ? L('panelHead') : L('panelItem'), kind: head ? 'panelHead' : 'panelItem', weight: head ? (N.weight || 600) : 400, fill: head || p.kind === 'check' ? S.ink : S.sub, font: head || p.kind === 'check' ? S.font : S.subFont });
      });
      y += lines.length * 22 + (p.kind === 'num' ? 30 : 9);
    });
  });

  /* ---- edges (under the boxes) */
  const eg0 = el('g', {});
  function polyD(pts, r) {
    if (!r || pts.length < 3) return 'M' + pts.map(p => p.join(' ')).join('L');
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
      const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by), rr = Math.min(r, l1 / 2, l2 / 2);
      d += `L${bx - (bx - ax) / l1 * rr} ${by - (by - ay) / l1 * rr}Q${bx} ${by} ${bx + (cx - bx) / l2 * rr} ${by + (cy - by) / l2 * rr}`;
    }
    return d + `L${pts.at(-1)[0]} ${pts.at(-1)[1]}`;
  }
  function head(p, q, col, sw, parent) {
    const a = Math.atan2(p[1] - q[1], p[0] - q[0]), L = (E.head === 'open' ? 10 : 9) * (E.hs || 1), W = .45;
    const p1 = [p[0] - L * Math.cos(a - W), p[1] - L * Math.sin(a - W)], p2 = [p[0] - L * Math.cos(a + W), p[1] - L * Math.sin(a + W)];
    if (E.head === 'open') {
      if (rc) { parent.appendChild(rc.linearPath([p1, p, p2], { seed: seed++, stroke: col, strokeWidth: sw, roughness: .6 })); return; }
      el('path', { d: `M${p1}L${p}L${p2}`, fill: 'none', stroke: col, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, parent);
    } else el('path', { d: `M${p1}L${p}L${p2}Z`, fill: col }, parent);
  }
  const trim = (p, q, d) => { const l = Math.hypot(p[0] - q[0], p[1] - q[1]); return [p[0] - (p[0] - q[0]) / l * d, p[1] - (p[1] - q[1]) / l * d]; };
  M.edges.forEach((ed, ei) => {
    // one group per edge, tagged with its index and flow, so a page can highlight one path
    const eg = el('g', { class: 'edge', 'data-i': ei, 'data-f': ed.f || null }, eg0);
    if (ed.quiet) {   // a lifeline or guide: thin, dashed, no head, not in the key
      if (rc) eg.appendChild(rc.linearPath(ed.pts, { seed: seed++, stroke: S.sub, strokeWidth: 1, roughness: .5, strokeLineDash: [4, 6] }));
      else el('path', { d: 'M' + ed.pts.map(p => p.join(' ')).join('L'), fill: 'none', stroke: S.sub, 'stroke-width': 1, 'stroke-dasharray': '4 5', 'stroke-opacity': .7 }, eg);
      return;
    }
    const { hot, col, sw } = lineLook(ed);
    const pts = ed.pts.map(p => p.slice());
    const n = pts.length, hd = ed.head || 'end';
    const back = E.head === 'solid' ? 7 * (E.hs || 1) : 1;
    if (hd !== 'none') pts[n - 1] = trim(pts[n - 1], pts[n - 2], back);
    if (hd === 'both') pts[0] = trim(pts[0], pts[1], back);
    if (hot && E.hot.under) el('path', { d: polyD(ed.pts, E.r), fill: 'none', stroke: E.hot.under, 'stroke-width': E.hot.usw, 'stroke-linejoin': 'round' }, eg);
    // Line meanings are fixed: solid is a request, dashed is async or batch, dotted is still to confirm.
    const dash = ed.dot ? (rc ? [1.5, 6] : '1 5') : ed.dash ? (rc ? [7, 7] : '6 5') : null;
    const lw = ed.dot ? sw + .4 : sw;
    if (rc) eg.appendChild(rc.linearPath(pts, { seed: seed++, stroke: col, strokeWidth: lw, roughness: .8, bowing: .6, strokeLineDash: dash || undefined }));
    else el('path', { d: polyD(pts, E.r), fill: 'none', stroke: col, 'stroke-width': lw, 'stroke-dasharray': dash, 'stroke-linecap': ed.dot ? 'round' : null, 'stroke-linejoin': 'round' }, eg);
    if (hd !== 'none') head(ed.pts[n - 1], ed.pts[n - 2], col, sw, eg);
    if (hd === 'both') head(ed.pts[0], ed.pts[1], col, sw, eg);
  });
  // free labels belong to no one edge, so they carry the class with no data-i and fade when a path is picked
  M.labels.forEach(l => {
    const w = l.t.length * 7.4 + 16, lg0 = el('g', { class: 'edge-label' }, eg0);
    el('rect', { x: l.x - w / 2, y: l.y - 15, width: w, height: 22, fill: S.bg, rx: 4 }, lg0);
    text(l.x, l.y + 1, l.t, { size: L('free'), kind: 'free', anchor: 'middle', fill: S.sub, font: S.subFont }, lg0);
  });

  /* ---- nodes */
  M.nodes.forEach(nd => {
    const z = zoneOf(nd); const c = pal(z && zoneColour(z));
    const g = el('g', { class: 'node', 'data-id': nd.id });
    let fill = N.fill;
    if (N.tone && nd.tone) fill = pal(nd.tone).fill || fill;
    const H = (nd.hero && N.hero) || {};
    if (H.fill) fill = H.fill === 'zone' ? c.fill : H.fill;
    if (N.shadow) el('rect', { x: nd.x + 2, y: nd.y + 4, width: nd.w, height: nd.h, rx: N.r, fill: '#000', 'fill-opacity': .1 }, g);
    if (nd.ghost) {
      // Planned or optional: a dashed outline in the role colour, whatever the style's box looks like.
      g.setAttribute('opacity', .78);
      rect(nd.x, nd.y, nd.w, nd.h, { r: N.r, fill: fill === 'none' ? null : fill, stroke: S.sub, sw: 1.3, dash: rc ? 1 : '5 4' }, g);
    } else if (N.stroke !== 'none' || fill !== 'none') {
      const stroke = H.stroke ? (H.stroke === 'zone' ? c.stroke : H.stroke) : N.stroke;
      if (rc) rect(nd.x, nd.y, nd.w, nd.h, { r: N.r, fill, stroke, sw: N.sw }, g);
      else el('rect', { x: nd.x, y: nd.y, width: nd.w, height: nd.h, rx: N.r, fill, stroke, 'stroke-width': N.sw }, g);
    }
    const bs = N.bs, lay = nd.lay || 'left';
    let sub = nd.s.slice();
    if (N.paren && sub.length) { sub[0] = '(' + sub[0]; sub[sub.length - 1] += ')'; }
    const tSize = L('title'), sSize = L('sub'), tH = tSize * 1.25, sH = sSize * 1.3;
    const tint = c.stroke || S.ink;
    if (lay === 'top') {
      const by = nd.y + 9; const cx = nd.x + nd.w / 2;
      if (nd.b) badge(nd.b, cx - bs / 2, by, bs, N.badge, tint, g);   // inside .node, so a page dims the box and its logo together
      let y = by + bs + tSize + 4;
      const tt = text(cx, y, nd.t, { size: tSize, kind: 'title', weight: N.weight || 600, anchor: 'middle' }, g);
      y += (Label.wrap(tt, tSize, nd.w - 12, tH) - 1) * tH;
      sub.forEach(s => {
        y += sH;
        const st = text(cx, y, s, { size: sSize, kind: 'sub', anchor: 'middle', fill: S.sub, font: S.subFont }, g);
        y += (Label.wrap(st, sSize, nd.w - 10, sH) - 1) * sH;
      });
    } else {
      const hasB = !!nd.b;
      const tx = hasB ? nd.x + 14 + bs + 12 : nd.x + nd.w / 2;
      if (hasB) badge(nd.b, nd.x + 14, nd.y + (nd.h - bs) / 2, bs, N.badge, tint, g);
      const anchor = hasB ? 'start' : 'middle';
      const max = hasB ? nd.x + nd.w - tx - 8 : nd.w - 16;
      // draw and wrap first, then centre the whole block in the box
      const tt = text(tx, 0, nd.t, { size: tSize, kind: 'title', weight: N.weight || 600, anchor }, g), tn = Label.wrap(tt, tSize, max, tH);
      const sts = sub.map(s => text(tx, 0, s, { size: sSize, kind: 'sub', anchor, fill: S.sub, font: S.subFont }, g)), sn = sts.map(t => Label.wrap(t, sSize, max, sH));
      const blockH = tSize + (tn - 1) * tH + sH * sn.reduce((a, b) => a + b, 0);
      let y = nd.y + (nd.h - blockH) / 2 + tSize * .82;
      Label.move(tt, tx, y); y += (tn - 1) * tH;
      sts.forEach((t, i) => { y += sH; Label.move(t, tx, y); y += (sn[i] - 1) * sH; });
    }
    const tg = tagOf(nd);
    if (tg) tagPill(tg, nd.x + 10, nd.y - 9, g);
  });

  /* ---- numbered steps on arrows (reference-architecture convention) */
  const taken = M.labels.map(l => [l.x - (l.t.length * 7.4 + 16) / 2, l.y - 15, l.t.length * 7.4 + 16, 22]);
  if (E.steps) M.edges.filter(e => e.step).forEach(e => {
    let best = 0, bi = 0;
    for (let i = 1; i < e.pts.length; i++) { const l = Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1]); if (l > best) { best = l; bi = i; } }
    const [a, b] = [e.pts[bi - 1], e.pts[bi]];
    const vertical = a[0] === b[0];
    const cx = (a[0] + b[0]) / 2 + (vertical ? 16 : 0), cy = (a[1] + b[1]) / 2 - (vertical ? 0 : 15);
    stepMark(cx, cy, e.step);
    taken.push([cx - 11, cy - 11, 22, 22]);
  });

  /* ---- edge labels: l: ["HTTPS 443", "what moves"], beside the longest clear segment, never on a line or a box */
  const lg = el('g', { class: 'edge-labels' });
  const hit = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  const segs = [];
  M.edges.forEach((e, i) => e.pts.forEach((p, j) => { if (j) { const q = e.pts[j - 1]; segs.push([Math.min(p[0], q[0]) - 1, Math.min(p[1], q[1]) - 1, Math.abs(p[0] - q[0]) + 2, Math.abs(p[1] - q[1]) + 2, i]); } }));
  M.edges.forEach((e, ei) => {
    if (!e.l) return;
    const lines = (Array.isArray(e.l) ? e.l : [e.l]).filter(Boolean);
    if (!lines.length) return;
    const g = el('g', { class: 'edge-label', 'data-i': ei, 'data-f': e.f || null }, lg);
    const bg = el('rect', { rx: 3, fill: S.bg, 'fill-opacity': .94 }, g);
    // STANDARD rule 8: text is at least 12 px at the drawn size.
    const ts = lines.map((ln, k) => text(0, 0, ln, { size: L(k ? 'lineSub' : 'line'), kind: k ? 'lineSub' : 'line', weight: k ? 400 : 600, fill: k ? S.sub : S.ink, font: S.subFont, anchor: 'middle' }, g));
    const w = Math.max(...ts.map(t => t.getComputedTextLength())) + 10, h = lines.length * 15 + 5;
    const cands = [];
    const order = e.pts.slice(1).map((p, j) => [j + 1, Math.hypot(p[0] - e.pts[j][0], p[1] - e.pts[j][1])]).sort((a, b) => b[1] - a[1]);
    order.forEach(([j, len]) => {
      const [a, b] = [e.pts[j - 1], e.pts[j]];
      [.5, .3, .7, .15, .85].forEach(f => {
        const mx = a[0] + (b[0] - a[0]) * f, my = a[1] + (b[1] - a[1]) * f;
        if (a[1] === b[1]) { cands.push([mx - w / 2, my - h - 5]); cands.push([mx - w / 2, my + 5]); }
        else { cands.push([mx + 7, my - h / 2]); cands.push([mx - w - 7, my - h / 2]); }
      });
    });
    let best = null, bestCost = Infinity, bestWhy = [];
    cands.forEach((c, k) => {
      const box = [c[0], c[1], w, h], why = new Set();
      let cost = k * .01;
      if (c[0] < 4 || c[1] < 4 || c[0] + w > M.w - 4 || c[1] + h > M.h - 4) { cost += 1e5; why.add('edge of the picture'); }
      M.nodes.forEach(n => { if (hit(box, [n.x - 2, n.y - 2, n.w + 4, n.h + 4])) { cost += 1000; why.add('a box'); } });
      M.zones.concat(M.panels).forEach(z => {
        if (hit(box, [z.x, z.y, z.w, depth(z) ? 28 : 44])) { cost += 1000; why.add('a zone title'); }   // never over a zone title
        [[z.x, z.y, z.w, 1], [z.x, z.y + z.h, z.w, 1], [z.x, z.y, 1, z.h], [z.x + z.w, z.y, 1, z.h]].forEach(r => { if (hit(box, r)) cost += 20; });
      });
      taken.forEach(t => { if (hit(box, t)) { cost += 1000; why.add('another label'); } });
      segs.forEach(sg => { if (hit(box, sg)) cost += sg[4] === ei ? 500 : 30; });
      if (cost < bestCost) { bestCost = cost; best = box; bestWhy = [...why]; }
    });
    const [bx, by] = best;
    bg.setAttribute('x', bx); bg.setAttribute('y', by); bg.setAttribute('width', w); bg.setAttribute('height', h);
    ts.forEach((t, k) => { t.setAttribute('x', bx + w / 2); t.setAttribute('y', by + 14 + k * 15); });
    if (bestWhy.length) g.setAttribute('data-crowded', bestWhy.join(', '));
    taken.push(best);
  });

  }

  /* ---- isometric body: zones as plates, lines on the ground, boxes as blocks with the badge standing on top */
  function drawIso() {
    const F = FLAT, I = S.iso || {}, DEP = I.depth || 16, PL = I.plate || 8;
    const mix = (hex, t, to = '#000000') => { const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16); const c = k => Math.round((a >> k & 255) * (1 - t) + (b >> k & 255) * t); return '#' + ((1 << 24) + (c(16) << 16) + (c(8) << 8) + c(0)).toString(16).slice(1); };
    const pts = a => a.map(p => p.join(',')).join(' ');
    const quad = (x, y, w, h, lift = 0) => [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)].map(([a, b]) => [a, b - lift]);
    const hull = ps => {   // convex hull, anticlockwise (monotone chain)
      const s = ps.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [], hi = [];
      s.forEach(p => { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
      s.slice().reverse().forEach(p => { while (hi.length > 1 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); });
      return lo.slice(0, -1).concat(hi.slice(0, -1));
    };
    const parentOf = z => DiagramModel.parentZone(F, z);
    const depthZ = z => { let d = 0, p = z; while ((p = parentOf(p)) && d < 9) d++; return d; };
    const colourZ = z => { let p = z, i = 0; while (p && !p.c && i++ < 9) p = parentOf(p); return p ? p.c : null; };
    const titles = [];
    // plates, parents first
    F.zones.concat(F.panels || []).slice().sort((a, b) => depthZ(a) - depthZ(b)).forEach(z => {
      const c = pal(colourZ(z)), d = depthZ(z), lift = d * 6, stroke = c.stroke || S.sub, fill = c.fill || mix(stroke, .88, '#ffffff');
      const g = el('g', { class: 'plate', 'data-id': z.id });
      const top = quad(z.x, z.y, z.w, z.h, lift);
      if (!d) {   // a slab: two visible sides under the top
        el('polygon', { points: pts([top[3], top[2], [top[2][0], top[2][1] + PL], [top[3][0], top[3][1] + PL]]), fill: mix(fill, .18) }, g);
        el('polygon', { points: pts([top[2], top[1], [top[1][0], top[1][1] + PL], [top[2][0], top[2][1] + PL]]), fill: mix(fill, .3) }, g);
      }
      el('polygon', { points: pts(top), fill: d ? mix(fill, .04) : fill, stroke, 'stroke-width': d ? 1.2 : Z.sw, 'stroke-dasharray': d && z.kind && /vpc|cluster/.test(z.kind) ? '8 5' : (d && z.kind && /subnet|namespace|vlan/.test(z.kind) ? '3 3' : null) }, g);
      const [tx, ty] = P(z.x + 14, z.y + 10);
      const label = (z.n ? String(z.n).padStart(2, '0') + '  ' : '') + (z.kind && d ? z.kind.toUpperCase() + '  ' : '') + z.t;
      titles.push([tx, ty - lift - 6, label, d, stroke]);
    });
    // side lists: their lines stand upright down the plate
    const sideLines = [];
    (F.panels || []).forEach(p => {
      let y = p.y + 64;
      p.items.forEach((it, i) => {
        it.forEach((ln, j) => { const [x, yy] = P(p.x + 24, y + j * 20); sideLines.push(text(x, yy, (j ? '' : (p.kind === 'num' ? `${i + 1}. ` : '✓ ')) + ln, { size: L(j ? 'isoPanelItem' : 'isoPanelHead'), kind: j ? 'isoPanelItem' : 'isoPanelHead', weight: j ? 400 : 600, fill: j ? S.sub : S.ink, font: S.subFont })); });
        y += it.length * 20 + 12;
      });
    });
    // lines on the ground
    const eg = el('g', { class: 'edges' });
    F.edges.forEach(ed => {
      const q = ed.pts.map(p => P(p[0], p[1]));
      const { col, sw } = lineLook(ed);
      const dash = ed.dot ? '1 5' : (ed.dash || ed.quiet) ? '6 5' : null;
      el('polyline', { points: pts(q), fill: 'none', stroke: col, 'stroke-width': sw, 'stroke-dasharray': dash, 'stroke-linecap': ed.dot ? 'round' : null, 'stroke-linejoin': 'round' }, eg);
      if ((ed.head || 'end') !== 'none' && !ed.quiet) {
        const [p, r] = [q[q.length - 1], q[q.length - 2]], a = Math.atan2(p[1] - r[1], p[0] - r[0]), L = 9;
        el('path', { d: `M${p[0] - L * Math.cos(a - .45)} ${p[1] - L * Math.sin(a - .45)}L${p[0]} ${p[1]}L${p[0] - L * Math.cos(a + .45)} ${p[1] - L * Math.sin(a + .45)}Z`, fill: col }, eg);
      }
    });
    // blocks, far to near
    const blocks = [];
    F.nodes.slice().sort((a, b) => (a.x + a.w / 2 + a.y + a.h / 2) - (b.x + b.w / 2 + b.y + b.h / 2)).forEach(nd => {
      const z = DiagramModel.zoneOf(F, nd), c = pal(z && colourZ(z)), lift = z ? depthZ(z) * 6 + 6 : 0;
      const g = el('g', { class: 'node', 'data-id': nd.id });
      // the block stands inside the box's footprint, so the lines that end at the footprint stay visible on the ground
      const ix = Math.min(nd.w * .16, 26), iy = Math.min(nd.h * .16, 26), bx = nd.x + ix, by = nd.y + iy, bw = nd.w - 2 * ix, bh = nd.h - 2 * iy;
      const base = quad(bx, by, bw, bh, lift), top = quad(bx, by, bw, bh, lift + DEP);
      const blk = { g, hull: hull(base.concat(top)), tag: null }; blocks.push(blk);
      const face = (N.tone && nd.tone && pal(nd.tone).fill) || (nd.hero ? (c.fill || N.fill) : N.fill), side = mix(c.stroke || '#8a94a6', .55, '#ffffff');
      if (nd.ghost) g.setAttribute('opacity', .6);
      el('polygon', { points: pts([top[3], top[2], base[2], base[3]]), fill: side, stroke: N.stroke, 'stroke-width': .8 }, g);
      el('polygon', { points: pts([top[2], top[1], base[1], base[2]]), fill: mix(side, .18), stroke: N.stroke, 'stroke-width': .8 }, g);
      el('polygon', { points: pts(top), fill: face, stroke: nd.ghost ? S.sub : (nd.hero ? (c.stroke || S.ink) : N.stroke), 'stroke-width': nd.hero ? 2 : N.sw, 'stroke-dasharray': nd.ghost ? '5 4' : null }, g);
      const [cx, cy] = P(nd.x + nd.w / 2, nd.y + nd.h / 2), cyT = cy - lift - DEP;
      const bs = N.bs, sub = nd.s || [];
      if (nd.b) badge(nd.b, cx - bs / 2, cyT - bs - 4, bs, N.badge, c.stroke || S.ink, g);
      const w = (nd.w + nd.h) * IC - 16;
      const max = Math.max(80, w * .75), tSize = L('title'), sSize = L('sub'), tH = tSize * 1.25, sH = sSize + 3;
      let y = cyT + 13;
      const tt = text(cx, y, nd.t, { size: tSize, kind: 'title', weight: N.weight || 700, anchor: 'middle' }, g);
      y += (Label.wrap(tt, tSize, max, tH) - 1) * tH;
      sub.slice(0, 2).forEach(t => {
        y += sH;
        const st = text(cx, y, t, { size: sSize, kind: 'sub', anchor: 'middle', fill: S.sub, font: S.subFont }, g);
        y += (Label.wrap(st, sSize, max, sH) - 1) * sH;
      });
      // status tag, upright and centred above the badge
      const tg = tagOf(nd);
      if (tg) { const tgG = el('g', {}, g); const tw = tagPill(tg, 0, 0, tgG); const ty = cyT - (nd.b ? bs + 4 : 0) - 24; tgG.setAttribute('transform', `translate(${cx - tw / 2} ${ty})`); blk.tag = [cx - tw / 2, ty, tw, 18]; }
    });
    // zone titles on a pill, drawn now so labels can keep off them, and moved on top of everything at the end
    const tgAll = el('g', { class: 'plate-titles' }), titleBoxes = [];
    titles.forEach(([x, y, t, d, stroke]) => {
      const g = el('g', { class: 'plate-title' }, tgAll), bg = el('rect', { rx: 4, fill: S.bg, stroke, 'stroke-width': 1 }, g);
      const tt = text(x, y, t, { size: L(d ? 'isoZoneSub' : 'zone'), kind: d ? 'isoZoneSub' : 'zone', weight: 700, fill: d ? S.ink : stroke, font: S.font, upper: !d, ls: d ? null : 1, anchor: 'middle' }, g);
      const w = tt.getComputedTextLength() + 14; bg.setAttribute('x', x - w / 2); bg.setAttribute('y', y - 15); bg.setAttribute('width', w); bg.setAttribute('height', 21);
      titleBoxes.push([x - w / 2, y - 15, w, 21]);
    });
    // labels and steps, upright and clear of blocks, badges, plate titles and other labels.
    // Everything already drawn is an obstacle in projected (screen) space: a block is its outline (a convex hull
    // of its top and base), a badge, tag or line of block text is its box. Each label tries spots on and beside
    // each stretch of its line, longest first, and takes the cheapest; one that still sits on something is marked
    // data-crowded with what it sits on, the same as the flat views, for check.js to catch.
    // does the box [x, y, w, h] overlap the convex polygon (or segment) poly? separating axes
    const hitPoly = (r, poly) => {
      const rp = [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0] + r[2], r[1] + r[3]], [r[0], r[1] + r[3]]];
      const axes = [[1, 0], [0, 1]].concat(poly.map((p, i) => { const q = poly[(i + 1) % poly.length]; return [q[1] - p[1], p[0] - q[0]]; }));
      return axes.every(([ax, ay]) => {
        if (!ax && !ay) return true;
        const pr = ps => ps.reduce(([mn, mx], p) => { const d = p[0] * ax + p[1] * ay; return [Math.min(mn, d), Math.max(mx, d)]; }, [Infinity, -Infinity]);
        const [a0, a1] = pr(rp), [b0, b1] = pr(poly);
        return a0 < b1 && b0 < a1;
      });
    };
    const hit = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    const boxOf = e => { const r = e.getBBox(); return [r.x, r.y, r.width, r.height]; };
    const solid = [];   // [what, polygon or null, box or null]
    blocks.forEach(b => {
      solid.push(['a block', b.hull, null]);
      b.g.querySelectorAll(':scope > text').forEach(t => solid.push(['a block', null, boxOf(t)]));
      b.g.querySelectorAll(':scope > g.badge').forEach(t => solid.push(['a badge', null, boxOf(t)]));
      if (b.tag) solid.push(['a block', null, b.tag]);
    });
    titleBoxes.forEach(r => solid.push(['a plate title', null, r]));
    sideLines.forEach(t => solid.push(['a side list', null, boxOf(t)]));
    const taken = [];
    (F.labels || []).forEach(l => { const [x, y] = P(l.x, l.y); taken.push(boxOf(text(x, y, l.t, { size: L('isoFree'), kind: 'isoFree', anchor: 'middle', fill: S.sub, font: S.subFont }))); });
    const lines = F.edges.map(ed => ed.pts.map(p => P(p[0], p[1])));
    const lg = el('g', { class: 'edge-labels' });
    F.edges.forEach((e, ei) => {
      const ls = (Array.isArray(e.l) ? e.l : e.l ? [e.l] : []).filter(Boolean), step = E.steps && e.step;
      if (!ls.length && !step) return;
      let g = null, bg = null, ts = [], w = 22, h = 0;
      if (ls.length) {
        g = el('g', { class: 'edge-label', 'data-i': ei, 'data-f': e.f || null }, lg); bg = el('rect', { rx: 3, fill: S.bg, 'fill-opacity': .9 }, g);
        ts = ls.map((ln, k) => text(0, 0, ln, { size: L(k ? 'lineSub' : 'line'), kind: k ? 'lineSub' : 'line', weight: k ? 400 : 600, fill: k ? S.sub : S.ink, font: S.subFont, anchor: 'middle' }, g));
        w = Math.max(...ts.map(t => t.getComputedTextLength())) + 10; h = ls.length * 15 + 4;
      }
      const SH = step ? 26 : 0, H = h + SH;   // a step number stands just above its label
      const cands = [];
      e.pts.slice(1).map((p, j) => [j + 1, Math.hypot(p[0] - e.pts[j][0], p[1] - e.pts[j][1])]).sort((a, b) => b[1] - a[1]).forEach(([j]) => {
        const [a, b] = [e.pts[j - 1], e.pts[j]];
        [.5, .3, .7, .15, .85].forEach(f => {
          const [mx, my] = P(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
          // above, below, right, left, then the four corners (projected lines run diagonally), then on the line
          cands.push([mx - w / 2, my - H - 6], [mx - w / 2, my + 6], [mx + 8, my - H / 2], [mx - w - 8, my - H / 2],
            [mx + 4, my + 4], [mx - w - 4, my - H - 4], [mx + 4, my - H - 4], [mx - w - 4, my + 4], [mx - w / 2, my - H / 2]);
        });
      });
      let best = null, bestCost = Infinity, bestWhy = [];
      cands.forEach((c, k) => {
        const box = [c[0] - 2, c[1] - 2, w + 4, H + 4], why = new Set();
        let cost = k * .01;
        if (c[0] < 4 || c[1] < 4 || c[0] + w > M.w - 4 || c[1] + H > M.h - 4) { cost += 1e5; why.add('edge of the picture'); }
        solid.forEach(([what, poly, r]) => { if (poly ? hitPoly(box, poly) : hit(box, r)) { cost += 1000; why.add(what); } });
        taken.forEach(t => { if (hit(box, t)) { cost += 1000; why.add('another label'); } });
        lines.forEach((q, li) => q.forEach((p, j) => { if (j && hitPoly(box, [q[j - 1], p])) cost += li === ei ? 60 : 15; }));
        if (cost < bestCost) { bestCost = cost; best = [c[0], c[1], w, H]; bestWhy = [...why]; }
      });
      const [bx, by] = best;
      if (step) stepMark(bx + w / 2, by + 11, e.step, lg);
      if (g) {
        bg.setAttribute('x', bx); bg.setAttribute('y', by + SH); bg.setAttribute('width', w); bg.setAttribute('height', h);
        ts.forEach((t, k) => Label.move(t, bx + w / 2, by + SH + 14 + k * 15));
        if (bestWhy.length) g.setAttribute('data-crowded', bestWhy.join(', '));
      }
      taken.push(best);
    });
    svg.appendChild(tgAll);   // plate titles stay on top
  }

  /* ---- footer: the key (only what this model uses) and the diagram's type, scope and date */
  const used = {
    hot: M.edges.some(e => e.hot && !flowOf(e)), sync: M.edges.some(e => !e.hot && !e.dash && !e.dot && !e.quiet && !flowOf(e)),
    dash: M.edges.some(e => e.dash), dot: M.edges.some(e => e.dot),
    ghost: M.nodes.some(n => n.ghost), steps: !!E.steps && M.edges.some(e => e.step),
    glyph: M.nodes.some(n => n.b && n.b.startsWith('g:')),
  };
  const items = [];
  const lineSample = (o) => (g, x, y) => {
    if (o.under) el('path', { d: `M${x} ${y}H${x + 34}`, stroke: o.under, 'stroke-width': o.usw }, g);
    if (rc) g.appendChild(rc.linearPath([[x, y], [x + 34, y]], { seed: seed++, stroke: o.c, strokeWidth: o.sw, roughness: .8, strokeLineDash: o.dash ? o.dash.split(' ').map(Number) : undefined }));
    else el('path', { d: `M${x} ${y}H${x + 34}`, stroke: o.c, 'stroke-width': o.sw, 'stroke-dasharray': o.dash || null, 'stroke-linecap': o.dash && o.dash[0] === '1' ? 'round' : null }, g);
    return 40;
  };
  // Flows first: they are what the colour on this diagram means. Then status tags, then the fixed line meanings.
  Object.entries(M0.flows || {}).forEach(([id, f]) => { if (M.edges.some(e => e.f === id)) items.push([lineSample({ c: flowCol(f), sw: FLOW_SW }), f.t]); });
  Object.entries(M0.tags || {}).forEach(([id, tg]) => { if (M.nodes.some(n => n.tag === id)) items.push([(g, x, y) => tagPill(tg, x, y - 9, g) + 6, tg.m || tg.t, tg.t.length * 8 + 30]); });
  if (used.hot) items.push([lineSample(E.hot), 'Main path']);
  if (used.sync) items.push([lineSample({ c: E.c, sw: E.sw }), 'Request, reply on the same line']);
  if (used.dash) items.push([lineSample({ c: E.c, sw: E.sw, dash: '6 5' }), 'Async or batch']);
  if (used.dot) items.push([lineSample({ c: E.c, sw: E.sw + .4, dash: '1 5' }), 'To confirm']);
  if (used.ghost) items.push([(g, x, y) => { rect(x, y - 10, 34, 20, { r: Math.min(N.r, 6), stroke: S.sub, sw: 1.3, dash: rc ? 1 : '5 4' }, g); return 40; }, 'Planned or optional']);
  if (used.steps) items.push([(g, x, y) => { stepMark(x + 10, y, 1, g); return 26; }, 'Step order']);
  if (used.glyph) items.push([(g, x, y) => { badge('g:box', x, y - 11, 22, N.badge, S.sub, g); return 28; }, 'Generic part (no product logo)']);
  const meta = [M.type, M.scope, M.updated && `Updated ${M.updated}`].filter(Boolean).join('\u2002·\u2002');
  let FH = 0;
  if ((items.length && M.key !== false) || meta) {
    const fg = el('g', { class: 'key' });
    const top = M.h, pad = 20, rowH = 30;
    const lab = (x, y, s, o) => text(x, y, s, Object.assign({ size: L('key'), kind: 'key', fill: S.sub, font: S.subFont }, o), fg);
    // Each style frames its key the way it frames its title.
    let x = pad, y = top + 34;
    if (T.mode === 'band') { el('rect', { x: 0, y: top, width: M.w, height: 4, fill: RULE }, fg); lab(x, y + 4, 'KEY', { size: L('keyHead'), kind: 'keyHead', weight: 800, fill: S.ink, ls: 1.4 }); x += 46; }
    else if (T.mode === 'box') { lab(x, y + 4, 'Key', { size: L('keyHead'), kind: 'keyHead', fill: S.ink, font: S.font }); x += 44; }
    else { el('path', { d: `M${pad} ${top + 8}H${M.w - pad}`, stroke: S.sub, 'stroke-opacity': .35, 'stroke-width': 1 }, fg); lab(x, y + 4, 'KEY', { size: L('keyHead'), kind: 'keyHead', weight: 700, ls: 1.4 }); x += 44; }
    const x0 = x;
    let metaW = 0;
    if (meta) { const t = lab(M.w - pad, y + 4, meta, { anchor: 'end', kind: 'meta' }); metaW = t.getComputedTextLength() + 28; }
    if (M.key !== false) items.forEach(([draw, label, swHint]) => {
      const t = lab(0, 0, label);
      const w = t.getComputedTextLength();
      const sw = swHint || 44;   // a sample's width, so a wide one (a tag pill) wraps before it hits the meta text
      if (x > x0 && x + sw + w > M.w - pad - (y === top + 34 ? metaW : 0)) { x = x0; y += rowH; }
      const g = el('g', {}, fg);
      const dx = draw(g, x, y);
      t.setAttribute('x', x + dx); t.setAttribute('y', y + 4.5);
      x += dx + w + 26;
    });
    FH = y - top + 26;
    if (T.mode === 'box') rect(pad / 2, top + 6, M.w - pad, FH - 10, { r: 10, stroke: S.sub, sw: 1.1 }, fg);
  }
  const H = M.h + FH;
  bgRect.setAttribute('height', H);
  // No header: start the drawing just above its topmost part instead of leaving the empty title band.
  let Y0 = 0;
  if (!HEAD) {
    let top = Infinity;
    const toSvg = svg.getCTM() && svg.getCTM().inverse();
    for (const c of svg.children) {
      if (c === bgRect || /^(title|desc|defs|style)$/.test(c.tagName) || c.getAttribute('class') === 'grid') continue;
      try {
        const b = c.getBBox(), m = toSvg && c.getCTM() ? toSvg.multiply(c.getCTM()) : null;   // the part's own transform counts
        if (!b.width && !b.height) continue;
        top = Math.min(top, m ? Math.min(m.b * b.x + m.d * b.y + m.f, m.b * (b.x + b.width) + m.d * (b.y + b.height) + m.f) : b.y);
      } catch (e) {}
    }
    if (top < Infinity) Y0 = Math.max(0, Math.floor(top - 16));
    bgRect.setAttribute('y', Y0); bgRect.setAttribute('height', H - Y0);
  }
  svg.setAttribute('viewBox', `0 ${Y0} ${M.w} ${H - Y0}`);
  svg.setAttribute('data-w', M.w); svg.setAttribute('data-h', H - Y0);
  return svg;
}


/* themeStyle(STYLE, 'dark'): the style with its "dark" block laid over it (objects merge, everything else replaces).
   Styles that are dark already have an empty block. */
function themeStyle(S, theme) {
  if (theme !== 'dark' || !S.dark) return S;
  const merge = (a, b) => {
    const o = Object.assign({}, a);
    for (const k in b) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? merge(a[k], b[k]) : b[k];
    return o;
  };
  return Object.assign(merge(S, S.dark), { theme: 'dark' });
}
if (typeof module !== 'undefined') module.exports = { themeStyle, Label };
