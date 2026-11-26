#!/usr/bin/env python3
"""Build and check the technical-diagram library.

  python3 build.py badges   rebuild badges/badges.json from badges/catalogue.json
                            (fetches the pinned npm packages with `npm pack` into .cache/)
  python3 build.py check    lint styles, examples and badges (no network)
  python3 build.py page     check, then write picker.html (the style picker and badge library)
  python3 build.py          same as page
  python3 build.py preview MODEL.json [OUT.html]
                            lint one diagram model and write a page that draws it in every style,
                            with download buttons (used by the Claude Code plugin; no network)
  python3 build.py gallery [DIR]
                            redraw gallery.html and thumbs/gallery.png, gallery-dark.png (node gallery.js): every kind,
                            layout, look and the mixes as pictures, in light and dark (needs Playwright)
  python3 build.py styles   list the styles: id, name, what each is good for, and its thumbnail
  python3 build.py find WORD [WORD...]
                            list badges and glyphs whose id or name matches, for writing models
  python3 build.py skill [OUT.zip]
                            package this folder as one uploadable skill named diagrams (SKILL.md is the source)
                            for claude.ai, the Claude desktop app and Cowork; default dist/diagrams-skill.zip
  python3 build.py plugin [DIR]
                            write ../plugins/diagrams/skills and commands (/diagrams:styles, /diagrams:page, /diagrams:gallery), the plugin the
                            marketplace serves: one self-contained skill (`draw`) with the same files as the zip, so it works
                            in claude.ai chat too

Everything is plain JSON so that adding a style, an example or a badge is one file or one line.
"""
import base64, glob, json, os, re, shutil, subprocess, sys, tarfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
PIN = {'aws-icons': '3.3.0', 'simple-icons': '16.36.0', '@iconify-json/logos': '1.2.16'}
CACHE = os.path.join(HERE, '.cache')
FONTS = [  # family, file in vendor/fonts, weight range
    ('Excalifont', 'Excalifont-Regular.woff2', '400'), ('IBM Plex Sans', 'IBMPlexSans.woff2', '100 700'),
    ('Archivo', 'Archivo.woff2', '100 900'), ('IBM Plex Mono', 'IBMPlexMono-400.woff2', '400'),
    ('IBM Plex Mono', 'IBMPlexMono-600.woff2', '600'), ('Overpass', 'Overpass.woff2', '100 900'),
    ('Hanken Grotesk', 'HankenGrotesk.woff2', '100 900'), ('JetBrains Mono', 'JetBrainsMono.woff2', '100 800')]
FONT_NAMES = {f[0] for f in FONTS}
STYLE_KEYS = ['id', 'name', 'offered', 'after', 'blurb', 'good', 'rules', 'bg', 'font', 'ink', 'sub', 'pal', 'zone', 'node', 'edge', 'title']
MODES = {'zone': ['tint', 'outline', 'header', 'dash', 'rule', 'bar', 'iso'], 'badge': ['native', 'tile', 'disc', 'chip'],
         'title': ['box', 'band', 'left', 'none'], 'head': ['open', 'solid']}
COLOURS = ['violet', 'blue', 'amber', 'green', 'red']
FLOWS = ['blue', 'orange', 'green', 'pink', 'sky', 'vermillion', 'grey']   # Okabe-Ito; the hues are FLOW_HUES in model.js, keep the names in step
TAG_KINDS = ['bad', 'good', 'info']
KINDS = ['cloud', 'region', 'vpc', 'subnet', 'cluster', 'namespace', 'node', 'site', 'vlan']


def path(*p): return os.path.join(HERE, *p)
def load(p): return json.load(open(p, encoding='utf-8'))


def styles():
    out = [load(f) for f in glob.glob(path('styles', '*.json'))]
    return sorted(out, key=lambda s: (s.get('order', 999), s.get('id', '')))


def examples():
    out = [load(f) for f in glob.glob(path('examples', '*.json'))]
    return sorted(out, key=lambda m: (m.get('order', 999), m.get('id', '')))


# ---------------------------------------------------------------- badges
def package(name):
    """Unpack a pinned npm package into .cache/<name>-<version>/package and return that path."""
    ver = PIN[name]; d = os.path.join(CACHE, f'{name.replace("/", "-").lstrip("@")}-{ver}')
    if not os.path.isdir(os.path.join(d, 'package')):
        os.makedirs(d, exist_ok=True)
        tgz = subprocess.run(['npm', 'pack', f'{name}@{ver}', '--silent'], cwd=d, check=True, capture_output=True, text=True).stdout.strip().splitlines()[-1]
        tgz = os.path.basename(tgz)
        with tarfile.open(os.path.join(d, tgz)) as t: t.extractall(d, filter='data')
    return os.path.join(d, 'package')


def nested_svg(text, where):
    vb = re.search(r'viewBox="([^"]+)"', text)
    body = re.search(r'<svg[^>]*>(.*)</svg>', text, re.S)
    if not vb or not body: sys.exit(f'{where}: needs an <svg viewBox="..."> wrapper')
    inner = re.sub(r'<title>.*?</title>', '', body.group(1), flags=re.S).strip()
    if re.search(r'<script|on\w+=', inner, re.I): sys.exit(f'{where}: scripts and event handlers are not allowed in badges')
    return vb.group(1), inner


def build_badges():
    cat = load(path('badges', 'catalogue.json'))
    need = {e['from'].split(':', 1)[0] for e in cat['badges']}
    si_dir = package('simple-icons') if 'si' in need else None
    aws_dir = os.path.join(package('aws-icons'), 'icons', 'architecture-service') if 'aws' in need else None
    si_meta = {}
    if si_dir:
        for d in load(os.path.join(si_dir, 'data', 'simple-icons.json')):
            si_meta[d.get('slug') or re.sub(r'[^a-z0-9]', '', d['title'].lower())] = d
    out = {}
    for e in cat['badges']:
        i, (kind, ref) = e['id'], e['from'].split(':', 1)
        if i in out: sys.exit(f'catalogue.json: duplicate id "{i}"')
        if e['group'] not in cat['groups']: sys.exit(f'catalogue.json: "{i}" uses unknown group "{e["group"]}"')
        if kind == 'si':
            f = os.path.join(si_dir, 'icons', ref + '.svg')
            if not os.path.exists(f): sys.exit(f'catalogue.json: "{i}": no Simple Icons slug "{ref}" in simple-icons {PIN["simple-icons"]}')
            meta = si_meta.get(ref, {})
            out[i] = {'n': e.get('name') or meta.get('title', i), 'k': 'si', 'g': e['group'],
                      'd': re.search(r' d="([^"]+)"', open(f).read()).group(1), 'hex': e.get('hex') or '#' + meta.get('hex', '333333')}
        elif kind in ('aws', 'own'):
            f = os.path.join(aws_dir, ref + '.svg') if kind == 'aws' else path('badges', 'own', ref)
            if not os.path.exists(f): sys.exit(f'catalogue.json: "{i}": file not found: {f}')
            vb, inner = nested_svg(open(f, encoding='utf-8').read(), f)
            hexc = e.get('hex') or (re.search(r'fill="(#[0-9a-fA-F]{6})"', inner) or [None, '#333333'])[1]
            out[i] = {'n': e.get('name', i), 'k': kind, 'g': e['group'], 'vb': vb, 'svg': inner, 'hex': hexc}
        else:
            sys.exit(f'catalogue.json: "{i}": "from" must start with si:, aws: or own:')
    data = {'groups': cat['groups'], 'badges': out}
    json.dump(data, open(path('badges', 'badges.json'), 'w'), separators=(',', ':'))
    print(f'badges/badges.json: {len(out)} badges')
    mermaid_icons(cat)


# Badge id -> name in Iconify's "logos" set, for Mermaid architecture-beta exports. Only names that exist in the pinned set.
MERMAID_SAME = {'apigateway': 'aws-api-gateway', 'stepfunctions': 'aws-step-functions', 'secrets': 'aws-secrets-manager',
                'elasticache': 'aws-elasticache', 'opensearch': 'aws-open-search', 'eventbridge': 'aws-eventbridge',
                'githubactions': 'github-actions', 'gcp-run': 'google-cloud-run', 'gcp-functions': 'google-cloud-functions',
                'k8s-deploy': 'kubernetes'}   # a guess on the file name matched an unrelated brand


def mermaid_icons(cat):
    names = load(os.path.join(package('@iconify-json/logos'), 'icons.json'))
    have = set(names['icons']) | set(names.get('aliases', {}))
    out = {}
    for e in cat['badges']:
        i, (kind, ref) = e['id'], e['from'].split(':', 1)
        if i in MERMAID_SAME: cands = [MERMAID_SAME[i]]
        elif kind == 'aws': cands = [MERMAID_SAME.get(i), f'aws-{i}', 'aws-' + re.sub(r'^(AWS|Amazon)', '', ref).lower()]
        elif kind == 'si': cands = [f'{ref}-icon', ref, f'{i}-icon', i]
        else: cands = [f'{i}-icon', i, f'{os.path.basename(ref)[:-4]}-icon', os.path.basename(ref)[:-4]]
        hit = next((c for c in cands if c and c in have), None)
        if hit: out[i] = hit
    open(path('badges', 'mermaid-logos.json'), 'w').write(json.dumps(out, indent=0, sort_keys=True) + '\n')
    print(f'badges/mermaid-logos.json: {len(out)} of {len(cat["badges"])} badges have an Iconify logos icon')


# ---------------------------------------------------------------- checks
def lint_model(m, lib, glyphs, w):
    """Problems with one diagram model (an examples/*.json file or a model written for the plugin)."""
    errs = []
    auto = needs_layout(m)
    for k in ('id', 'title', 'zones', 'nodes', 'edges') + (() if auto else ('w', 'h')):
        if k not in m: errs.append(f'{w}: missing "{k}"')
    if auto:
        ids = {n.get('id') for n in m.get('nodes', [])}
        for i, e in enumerate(m.get('edges', [])):
            if not e.get('pts') and not (e.get('from') in ids and e.get('to') in ids): errs.append(f'{w}: edge {i + 1} needs "from" and "to" naming boxes (auto layout routes it)')
    # A reader needs to know what kind of picture this is, what it covers and how fresh it is.
    for k, eg in (('type', 'Architecture'), ('scope', 'Production, eu-west-1'), ('updated', '2026-11-07')):
        if not m.get(k): errs.append(f'{w}: missing "{k}" (for example "{k}": "{eg}"); it is printed beside the key')
    c = m.get('contract')
    if c is not None and not (isinstance(c, list) and len(c) == 5 and all(isinstance(x, str) and x for x in c)):
        errs.append(f'{w}: "contract" must be five lines: question, reader, must show, left out, where shown')
    if m.get('updated') and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(m['updated'])): errs.append(f'{w}: "updated" must be a date, YYYY-MM-DD')
    for z in m.get('zones', []) + m.get('panels', []):
        if z.get('c') and z['c'] not in COLOURS: errs.append(f'{w}: "{z.get("id")}" colour "{z["c"]}" must be one of {COLOURS}')
    for p in m.get('panels', []):
        if p.get('icon') and p['icon'] not in glyphs: errs.append(f'{w}: panel "{p.get("id")}" uses unknown glyph "{p["icon"]}"')
    for n in m.get('nodes', []):
        if 's' in n and not (isinstance(n['s'], list) and all(isinstance(x, str) for x in n['s'])):
            errs.append(f'{w}: node "{n.get("id")}" "s" must be a list of lines, for example "s": ["business logic"]')
    zones = {z.get('id'): z for z in m.get('zones', [])}
    for z in m.get('zones', []):
        if z.get('inline') and z['inline'] not in glyphs: errs.append(f'{w}: zone "{z.get("id")}" uses unknown glyph "{z["inline"]}"')
        if z.get('kind') and z['kind'] not in KINDS: errs.append(f'{w}: zone "{z.get("id")}" kind "{z["kind"]}" must be one of {KINDS}')
        if z.get('in'):
            p = zones.get(z['in'])
            if not p: errs.append(f'{w}: zone "{z.get("id")}" is in unknown zone "{z["in"]}"'); continue
            seen, q = {z.get('id')}, p
            while q and q.get('in'):
                if q.get('id') in seen: errs.append(f'{w}: zones "{z.get("id")}" and "{q.get("id")}" are inside each other'); break
                seen.add(q.get('id')); q = zones.get(q['in'])
            if all(k in z and k in p for k in 'xywh') and not (p['x'] <= z['x'] and p['y'] <= z['y'] and z['x'] + z['w'] <= p['x'] + p['w'] and z['y'] + z['h'] <= p['y'] + p['h']):
                errs.append(f'{w}: zone "{z.get("id")}" says it is in "{p.get("id")}" but sticks out of it')
    for n in m.get('nodes', []):
        if n.get('in') and n['in'] not in zones: errs.append(f'{w}: node "{n.get("id")}" is in unknown zone "{n["in"]}"')
    # Flows and tags (STANDARD.md): colour on lines means one named thing, status is a tag on the box.
    flows, tags = m.get('flows') or {}, m.get('tags') or {}
    for k, f in flows.items():
        if not f.get('t'): errs.append(f'{w}: flow "{k}" needs "t", the words the key prints')
        if f.get('c') not in FLOWS: errs.append(f'{w}: flow "{k}" colour "{f.get("c")}" must be one of {FLOWS}')
    if len({f.get('c') for f in flows.values()}) < len(flows): errs.append(f'{w}: two flows share a colour; each flow needs its own')
    for i, e in enumerate(m.get('edges', [])):
        if e.get('f') and e['f'] not in flows: errs.append(f'{w}: edge {i + 1} uses unknown flow "{e["f"]}" (add it to "flows")')
    for k, t in tags.items():
        if not t.get('t') or t.get('k') not in TAG_KINDS: errs.append(f'{w}: tag "{k}" needs "t" (the pill text) and "k", one of {TAG_KINDS}')
    for n in m.get('nodes', []):
        if n.get('tag') and n['tag'] not in tags: errs.append(f'{w}: node "{n.get("id")}" uses unknown tag "{n["tag"]}" (add it to "tags")')
    for n in m.get('nodes', []):
        b = n.get('b')
        if not b: continue
        if b.startswith('g:'):
            if b[2:] not in glyphs: errs.append(f'{w}: node "{n["id"]}" uses unknown glyph "{b}" (add it to badges/glyphs.json)')
        elif b not in lib: errs.append(f'{w}: node "{n["id"]}" uses unknown badge "{b}" (add it to badges/catalogue.json)')
    return errs


def model_warnings(m, w):
    """Things a reader will trip over but that do not stop a build."""
    nodes = m.get('nodes', [])
    zones = m.get('zones', [])
    def box_at(pt):
        if not pt: return None
        for n in nodes:
            if 'x' in n and n['x'] - 4 <= pt[0] <= n['x'] + n['w'] + 4 and n['y'] - 4 <= pt[1] <= n['y'] + n['h'] + 4: return n
    def zone_of(n):
        if n.get('in'): return n['in']
        inside = [z for z in zones if 'x' in n and z['x'] <= n['x'] and z['y'] <= n['y'] and n['x'] + n['w'] <= z['x'] + z['w'] and n['y'] + n['h'] <= z['y'] + z['h']]
        return min(inside, key=lambda z: z['w'] * z['h'])['id'] if inside else None
    byid = {n['id']: n for n in nodes}
    out = []
    for i, e in enumerate(m.get('edges', [])):
        pts = e.get('pts') or []
        a = byid.get(e.get('from')) or (None if e.get('tee') else box_at(pts[0] if pts else None))
        b = byid.get(e.get('to')) or box_at(pts[-1] if pts else None)
        name = f'edge {i + 1}' + (f' ({a["id"]} to {b["id"]})' if a and b else '')
        if e.get('f') and e.get('hot'): out.append(f'{w}: {name} has both a flow and "hot"; with flows, colour already says which path, so drop "hot"')
        if e.get('head') == 'both': out.append(f'{w}: {name} has head "both"; draw two edges, or one edge the way the data goes and say the answer comes back on it')
        if a and b and not e.get('l') and not e.get('quiet') and zone_of(a) != zone_of(b):
            out.append(f'{w}: {name} crosses from one zone to another with no label; add "l": ["PROTOCOL PORT", "what moves"]')
    flows = m.get('flows') or {}
    if len(flows) > 5: out.append(f'{w}: {len(flows)} flows; past five colours readers stop telling them apart, so split the diagram or merge flows')
    if {'blue', 'sky'} <= {f.get('c') for f in flows.values()}: out.append(f'{w}: flows use both blue and sky; on light pages they look alike, so pick another hue for one of them')
    return out


def needs_layout(m):
    return any('x' not in n or 'y' not in n for n in m.get('nodes', [])) or any(not e.get('pts') for e in m.get('edges', []))


def lay_out(m, where):
    """A model with every box placed and every line routed: auto layout (layout.js, ELK) for boxes with no x and y."""
    if not needs_layout(m): return m
    try: r = subprocess.run(['node', path('layout.js'), '-'], input=json.dumps(m), capture_output=True, text=True)
    except FileNotFoundError: sys.exit(f'{where}: boxes without x and y need Node for auto layout (layout.js); install Node or give every box x, y, w, h and every line pts')
    if r.returncode: sys.exit(f'{where}: auto layout failed: {r.stderr.strip()}')
    return json.loads(r.stdout)


def check():
    errs = []
    lib = load(path('badges', 'badges.json'))['badges']
    cat = load(path('badges', 'catalogue.json'))
    glyphs = load(path('badges', 'glyphs.json'))
    if set(lib) != {e['id'] for e in cat['badges']}:
        errs.append('badges.json is out of date with catalogue.json: run python3 build.py badges')
    S = styles(); ids = [s.get('id') for s in S]
    if len(set(ids)) != len(ids): errs.append(f'styles: duplicate id in {ids}')
    for s in S:
        clash = [o['id'] for o in S if o is not s and str(s.get('name', '')).lower() in (o.get('id'), str(o.get('name', '')).lower())]
        if clash: errs.append(f'styles/{s.get("id")}.json: name "{s.get("name")}" is also used by {clash}; a look must be pickable by name')
    if not any(s.get('offered') and s.get('id') == 'clear' for s in S): errs.append('styles/clear.json: the default look must be offered')
    if not os.path.exists(path('thumbs', 'six-looks.png')): errs.append('thumbs/six-looks.png: missing (the picture of the offered looks the draw rules show)')
    for s in S:
        w = f'styles/{s.get("id")}.json'
        errs += [f'{w}: missing "{k}"' for k in STYLE_KEYS if k not in s]
        if any(k not in s for k in STYLE_KEYS): continue
        if not isinstance(s['offered'], bool): errs.append(f'{w}: "offered" must be true (named in the list of looks) or false (kept, but not offered)')
        if not isinstance(s.get('dark'), dict): errs.append(f'{w}: needs a "dark" block (the tokens to change on a dark page; {{}} if the style is dark already)')
        if not glob.glob(path('styles', s['id'] + '.json')): errs.append(f'{w}: file name must match its id')
        for f in (s['font'], s.get('subFont', s['font'])):
            if f not in FONT_NAMES: errs.append(f'{w}: font "{f}" is not bundled (add it to vendor/fonts and FONTS in build.py)')
        errs += [f'{w}: pal needs "{c}"' for c in COLOURS if c not in s['pal']]
        for part, key, mode in (('zone', 'mode', 'zone'), ('node', 'badge', 'badge'), ('title', 'mode', 'title'), ('edge', 'head', 'head')):
            if s[part].get(key) not in MODES[mode]: errs.append(f'{w}: {part}.{key} must be one of {MODES[mode]}')
    pb = open(os.path.join(HERE, '..', 'playbook', 'cloud-native-diagrams.html'), encoding='utf-8').read()
    errs += [f'styles/{i}.json: add a <li data-style="{i}"> row to the diagrams part of playbook/cloud-native-diagrams.html' for i in ids if f'data-style="{i}"' not in pb]
    warns = []
    for m in examples():
        errs += lint_model(m, lib, glyphs, f'examples/{m.get("id")}.json')
        if not errs: warns += model_warnings(lay_out(m, f'examples/{m.get("id")}.json'), f'examples/{m.get("id")}.json')
    skill_md()  # SKILL.md, the one source of the skill, must have the frontmatter the plugin and the zip need
    if warns: print('\n'.join('warning: ' + x for x in warns), file=sys.stderr)
    if errs: sys.exit('\n'.join(errs))
    print(f'ok: {len(S)} styles, {len(examples())} examples, {len(lib)} badges, {len(glyphs)} glyphs')


# ---------------------------------------------------------------- page
def assemble(models, preview=False):
    """The picker page with fonts, rough.js, data and renderer inlined. preview=True: a page for one user model."""
    css = ''.join(f"@font-face{{font-family:'{n}';src:url(data:font/woff2;base64,"
                  f"{base64.b64encode(open(path('vendor', 'fonts', f), 'rb').read()).decode()}) format('woff2');font-weight:{w};font-display:block}}\n"
                  for n, f, w in FONTS)
    data = (f'const STYLES = {json.dumps(styles(), ensure_ascii=False)};\n'
            f'const EXAMPLES = {json.dumps(models, ensure_ascii=False)};\n'
            f'const PREVIEW = {"true" if preview else "false"};\n'
            f'const GLYPHS = {open(path("badges", "glyphs.json")).read()};\n'
            f'const BADGE_DATA = {open(path("badges", "badges.json")).read()};')
    page = open(path('page.html'), encoding='utf-8').read()
    for k, v in (('/*FONTS*/', css), ('/*TOGGLE*/', open(path('pages', '_toggle.js'), encoding='utf-8').read()), ('/*ROUGH*/', open(path('vendor', 'rough-4.6.6.js')).read()),
                 ('/*DATA*/', data), ('/*RENDER*/', open(path('model.js')).read() + '\n' + open(path('render.js')).read())):
        assert k in page, k
        page = page.replace(k, v)
    return page


def build_page():
    check()
    page = assemble([lay_out(m, f'examples/{m["id"]}.json') for m in examples()])
    open(path('picker.html'), 'w', encoding='utf-8').write(page)
    print(f'picker.html: {len(page) // 1024} KB')


def preview():
    args = sys.argv[2:]
    if not args: sys.exit('usage: python3 build.py preview MODEL.json [OUT.html]')
    src = args[0]
    out = args[1] if len(args) > 1 else os.path.splitext(src)[0] + '.preview.html'
    try: m = load(src)
    except (OSError, ValueError) as e: sys.exit(f'{src}: {e}')
    errs = lint_model(m, load(path('badges', 'badges.json'))['badges'], load(path('badges', 'glyphs.json')), src)
    if errs: sys.exit('\n'.join(errs))
    m = lay_out(m, src)
    for x in model_warnings(m, src): print('warning: ' + x, file=sys.stderr)
    open(out, 'w', encoding='utf-8').write(assemble([m], preview=True))
    print(f'{out}: "{m["title"]}" in {len(styles())} styles ({", ".join(s["id"] for s in styles())})')


def build_gallery():
    out = sys.argv[2] if len(sys.argv) > 2 else HERE
    sys.exit(subprocess.call(['node', path('gallery.js'), '--out', out]))


def list_styles():
    S = styles()
    print('Looks to offer (draw in Clear unless the user names another; names and ids both work):\n')
    for s in [s for s in S if s['offered']]:
        print(f'{s["name"]:<12} id {s["id"]:<12} (after {s["after"]})\n{"":<12} good for: {s["good"]}\n{"":<12} thumbnail: {path("thumbs", s["id"] + ".png")}')
    print(f'\nthe offered looks side by side: {path("thumbs", "six-looks.png")}')
    rest = [s for s in S if not s['offered']]
    if rest: print('\nAlso in the catalogue, not offered (use only if the user asks for it by name): ' + ', '.join(f'{s["name"]} ({s["id"]})' for s in rest))


def find():
    words = [w.lower() for w in sys.argv[2:]]
    lib = load(path('badges', 'badges.json'))
    glyphs = load(path('badges', 'glyphs.json'))
    rows = [(i, b['n'], lib['groups'][b['g']]) for i, b in lib['badges'].items()] + [(f'g:{g}', g, 'glyph (unbranded line icon)') for g in glyphs]
    hit = [r for r in rows if not words or any(w in r[0].lower() or w in r[1].lower() for w in words)]
    for i, n, g in hit: print(f'{i:<22} {n:<34} {g}')
    if words:
        miss = [w for w in words if not any(w in r[0].lower() or w in r[1].lower() for r in rows)]
        if miss: print(f'\nno badge for: {", ".join(miss)}. Use the closest glyph, or add a line to badges/catalogue.json in the cloud-native-diagrams repo.')


SKILL_SKIP = {'.cache', 'dist', 'node_modules', '__pycache__'}


def skill_md(name='draw'):
    """SKILL.md (the one source of the skill) with its frontmatter name set: `draw` in the plugin, `diagrams` in the zip."""
    src = open(path('SKILL.md'), encoding='utf-8').read()
    if not re.match(r'---\nname: draw\ndescription: .+\n---\n', src):
        sys.exit('SKILL.md must start with frontmatter: "name: draw" then a one-line "description:"')
    left = re.findall(r'<!--/?(?:plugin|skill)\b|\bPLUGIN\b|CLAUDE_PLUGIN_ROOT', src)
    if left:
        sys.exit(f'SKILL.md: {sorted(set(left))} left over; the same text runs everywhere, write paths as SKILL/...')
    return src.replace('name: draw\n', f'name: {name}\n', 1)


# The other kinds of picture the skill offers live beside diagrams/ in the repo; the skill carries their
# reference pages under kinds/ (gallery.js reads them from either place).
KIND_DIRS = [('statechart', ('..', 'statechart')), ('field-notes', ('..', 'explainers'))]


# Inside the skill the kind READMEs sit at kinds/<name>/README.md, so their repo paths are rewritten on the way in.
KIND_README_PATHS = [('python3 statechart/stamp.py', 'python3 SKILL/kinds/statechart/stamp.py'),
                     ('`diagrams/pages/_toggle.js`', '`SKILL/pages/_toggle.js`'),
                     ('[transit](../transit/)', 'transit (a separate explainer kit, not in this skill)'),
                     ('[`diagrams/`](../diagrams/)', 'this skill (`SKILL/`)'),
                     ('](../diagrams/STANDARD.md)', '](../../STANDARD.md)'),
                     ('(`scripts/check` runs it on both example pages)', '(the source repo\'s `scripts/check` runs it)')]


def skill_text(full, rel):
    """The bytes a skill file carries: the source unchanged, except a kind README with its paths made true inside the skill."""
    data = open(full, 'rb').read()
    if not (rel.startswith('kinds/') and rel.endswith('/README.md')): return data
    t = data.decode('utf-8')
    for a, b in KIND_README_PATHS: t = t.replace(a, b)
    left = re.findall(r'\]\(\.\./(?!statechart/|field-notes/|\.\./)[^)]*\)|(?<![/\w])(?:statechart|diagrams)/stamp\.py|(?<!SKILL/)diagrams/pages/', t)
    if left: sys.exit(f'{rel}: repo paths that do not exist inside the skill: {sorted(set(left))}; add them to KIND_README_PATHS')
    return t.encode('utf-8')


def skill_files():
    """(source path, path inside the skill folder) for every file the skill carries besides SKILL.md."""
    for name, rel in KIND_DIRS:
        base = path(*rel)
        for root, dirs, files in os.walk(base):
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in SKILL_SKIP)
            for f in sorted(files):
                if f.startswith('.') or f.endswith('.pyc'): continue
                full = os.path.join(root, f)
                yield full, f'kinds/{name}/' + os.path.relpath(full, base).replace(os.sep, '/')
    for root, dirs, files in os.walk(HERE):
        dirs[:] = sorted(d for d in dirs if not (root == HERE and d in SKILL_SKIP) and not d.startswith('.'))
        for f in sorted(files):
            if f.startswith('.') or f.endswith('.pyc') or (root == HERE and f == 'SKILL.md'): continue
            full = os.path.join(root, f)
            yield full, os.path.relpath(full, HERE).replace(os.sep, '/')


def build_skill():
    out = sys.argv[2] if len(sys.argv) > 2 else path('dist', 'diagrams-skill.zip')
    check()
    md = skill_md('diagrams')
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    n = 0
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('diagrams/SKILL.md', md)
        for full, rel in skill_files():
            z.writestr('diagrams/' + rel, skill_text(full, rel)); n += 1
    print(f'{out}: skill "diagrams", {n + 1} files, {os.path.getsize(out) // 1024} KB')


PLUGIN_OUT = os.path.join(HERE, '..', 'plugins', 'diagrams')
STYLES_COMMAND = ('---\ndescription: Show the six diagram looks (Clear, Sketch, Blueprint, Isometric, Dark, Infographic) '
                  'as pictures, with what each is good for, and the brand badge library.\n---\n\n'
                  'Use the `draw` skill from this plugin and follow its "Just show the styles" part: list the six looks '
                  'with `build.py styles`, show `picker.html` or `thumbs/six-looks.png` (pictures, not just names), and say '
                  'that Clear is the default and any diagram can be asked for in another look by name. For kinds, page '
                  'layouts and mixes as pictures too, point to `/diagrams:gallery`.\n')

PAGE_COMMAND = ('---\ndescription: Build a page around a diagram: pick a layout (A Scroll-along, B Plate, C Long read, '
                'D Incident review, E Reference, F Explorer), a look and a theme (Light, Dark or Auto), or say "show me all" '
                'to pick from pictures.\nargument-hint: "[layout] [look] [light|dark|auto] | show me all"\n---\n\n'
                'Use the `draw` skill from this plugin and follow its "Put a diagram on a page" part. The request: $ARGUMENTS\n\n'
                '- A named combination ("Long read, Blueprint, dark"): build that page directly.\n'
                '- "Show me all": draw the diagram once, show the six layouts on one sheet (lettered and named), let the user '
                'pick one, show that layout in the six looks, let the user pick again, then build it.\n'
                '- Nothing named: show the pictures first (`gallery.html`, or `thumbs/gallery.png` where HTML cannot be shown) '
                'and ask for a layout letter or a mix by its words ("Plate, Sketch"). If the user would rather you choose, '
                'recommend a layout and build it in Clear with the Auto theme.\n')

GALLERY_COMMAND = ('---\ndescription: Browse every kind of diagram (Map, Sequence, Statechart, Field Notes), page layout (A-F), '
                   'look and mix of them as pictures, each labelled with the words to ask for it, in Light or Dark.\n'
                   'argument-hint: "[kind | layout | look]"\n---\n\n'
                   'Use the `draw` skill from this plugin and follow its "Pick by picture" part. The request: $ARGUMENTS\n\n'
                   '- Show `gallery.html` (open it, present it as a file, or publish it as a private artifact); where HTML '
                   'cannot be shown, present `thumbs/gallery.png` (or `thumbs/gallery-dark.png` on a dark surface).\n'
                   '- If the request names a kind, layout or look, point at that section and its mixes.\n'
                   '- Ask the user to pick by number, letter or the words under a picture ("page, Plate, Sketch"), then '
                   'draw or build exactly that. Clear is the default look when none is picked.\n')


def build_plugin():
    """Write the generated part of plugins/diagrams, the plugin the marketplace serves.

    claude.ai chat copies only a skill's own folder into its sandbox, so the plugin's one skill (`draw`)
    holds everything: SKILL.md plus every file the zip carries. plugins/diagrams/.claude-plugin/plugin.json
    is hand-edited; skills/ and commands/ there are written here, never by hand, and scripts/check fails
    when they differ from what this writes."""
    out = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else PLUGIN_OUT)
    check()
    for d in ('skills', 'commands'):
        if os.path.isdir(os.path.join(out, d)): shutil.rmtree(os.path.join(out, d))
    skill = os.path.join(out, 'skills', 'draw')
    os.makedirs(skill)
    os.makedirs(os.path.join(out, 'commands'))
    with open(os.path.join(out, 'commands', 'styles.md'), 'w', encoding='utf-8', newline='\n') as f: f.write(STYLES_COMMAND)
    with open(os.path.join(out, 'commands', 'page.md'), 'w', encoding='utf-8', newline='\n') as f: f.write(PAGE_COMMAND)
    with open(os.path.join(out, 'commands', 'gallery.md'), 'w', encoding='utf-8', newline='\n') as f: f.write(GALLERY_COMMAND)
    with open(os.path.join(skill, 'SKILL.md'), 'w', encoding='utf-8', newline='\n') as f: f.write(skill_md())
    n = 0
    for full, rel in skill_files():
        dest = os.path.join(skill, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if rel.startswith('kinds/') and rel.endswith('/README.md'):
            with open(dest, 'wb') as f: f.write(skill_text(full, rel))
        else: shutil.copy2(full, dest)
        n += 1
    print(f'{os.path.relpath(out)}: plugin "diagrams", skill "draw" with {n + 1} files')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'page'
    {'badges': build_badges, 'check': check, 'page': build_page, 'preview': preview, 'find': find, 'styles': list_styles, 'gallery': build_gallery, 'skill': build_skill, 'plugin': build_plugin}.get(cmd, lambda: sys.exit(__doc__))()
