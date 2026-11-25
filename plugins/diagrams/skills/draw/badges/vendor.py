#!/usr/bin/env python3
"""Fetch third-party badge art and line glyphs, clean them, and write them into this folder.

  python3 badges/vendor.py         fetch everything listed below and rewrite the vendored files
  python3 badges/vendor.py gcp     only the named sources: k8s, cncf, lf, proj, glyphs, gcp, azure

Run it only to add to or refresh the lists below; its output is committed, so a normal build
(python3 build.py badges) needs no extra network. Each source is pinned:

  own/k8s/    Kubernetes community icon set, kubernetes/community icons/svg at K8S_REF
              (Apache-2.0 or CC-BY-4.0, at our choice; we use CC-BY-4.0 with credit in own/k8s/NOTICE.md)
  own/cncf/   CNCF project icons, cncf/artwork at CNCF_REF
              (provided under the Linux Foundation trademark usage guidelines; see own/cncf/NOTICE.md)
  own/lf/     Linux Foundation projects outside CNCF, each from its own repo at the ref in LF
              (project trademarks under the same guidelines; see own/lf/NOTICE.md)
  own/proj/   other open-source projects with no Simple Icons entry or usable cncf/artwork icon, each
              from the repo at the ref in PROJ, cropped to the mark where the file is a logo with a wordmark
              (each project's trademark; see own/proj/NOTICE.md)
  glyphs.json line glyphs from Lucide, npm lucide-static at LUCIDE (ISC; see GLYPHS-NOTICE.md)
  own/gcp/    Google Cloud product icons, Google's icon zip at GCP_ZIP, checked against GCP_SHA256
              (offered by Google for architecture diagrams and docs; see own/gcp/NOTICE.md)
  own/azure/  Microsoft Azure Architecture Icons, Microsoft's zip at AZURE_ZIP, checked against AZURE_SHA256
              (Microsoft permits them in architecture diagrams; see own/azure/NOTICE.md). Not fetched yet:
              the download host was blocked in the sandbox that built the rest. The first run prints the
              zip's sha256 to pin, and the catalogue lines to paste.

Cleaning: drop editor metadata (Inkscape, Sodipodi, RDF), turn <style> class rules into inline
attributes, and prefix every id with the badge id, so many badges can sit in one page without their
gradients or classes colliding. Raster <image> art is refused: a badge must be vector.
"""
import json, os, re, subprocess, sys, tarfile, urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '..', '.cache')
K8S_REF = '5a8b7c6b472c8b20a4f4c85676c697d9f94a5e87'
CNCF_REF = 'bffd512a8b625f15cf5f8e0427469380b5768e90'
LUCIDE = '1.68.0'
GCP_ZIP = 'https://cloud.google.com/static/icons/files/google-cloud-icons.zip'
GCP_SHA256 = 'a6d9d7921758042538b462f03cf64614c2cebd96743b3ed63580a769fc7de3e9'
AZURE_ZIP = 'https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V21.zip'
AZURE_SHA256 = None   # pin after the first fetch

# badge file name -> folder in the Google Cloud icon zip (each holds <folder>.svg)
GCP = {n: n.replace('-', '_') for n in (
    'anthos artifact-registry bigquery cloud-armor cloud-build cloud-deploy cloud-dns cloud-functions cloud-interconnect '
    'cloud-load-balancing cloud-logging cloud-monitoring cloud-nat cloud-router cloud-run cloud-sql cloud-storage cloud-vpn '
    'compute-engine filestore firestore google-kubernetes-engine identity-and-access-management key-management-service '
    'memorystore pubsub secret-manager virtual-private-cloud vertexai private-service-connect').split()}
GCP.update({'identity-aware-proxy': 'identity-aware_proxy', 'gke-on-prem': 'gke_on-prem'})

# badge file name -> the end of the file name in the Azure zip, "...-icon-service-<this>.svg" (matched without case)
AZURE = {
    'aks': 'Kubernetes-Services', 'arc': 'Azure-Arc', 'acr': 'Container-Registries', 'aci': 'Container-Instances',
    'vm': 'Virtual-Machine', 'vmss': 'VM-Scale-Sets', 'vnet': 'Virtual-Networks', 'subnet': 'Subnet',
    'lb': 'Load-Balancers', 'appgw': 'Application-Gateways', 'frontdoor': 'Front-Door-and-CDN-Profiles',
    'firewall': 'Firewalls', 'nsg': 'Network-Security-Groups', 'dns': 'DNS-Zones', 'nat': 'NAT',
    'vpngw': 'Virtual-Network-Gateways', 'expressroute': 'ExpressRoute-Circuits', 'private-link': 'Private-Link',
    'storage': 'Storage-Accounts', 'sql': 'SQL-Database', 'cosmos': 'Azure-Cosmos-DB',
    'postgres': 'Azure-Database-PostgreSQL-Server', 'redis': 'Cache-Redis', 'keyvault': 'Key-Vaults',
    'monitor': 'Monitor', 'log-analytics': 'Log-Analytics-Workspaces', 'app-insights': 'Application-Insights',
    'grafana': 'Azure-Managed-Grafana', 'functions': 'Function-Apps', 'app-service': 'App-Services',
    'service-bus': 'Azure-Service-Bus', 'event-hubs': 'Event-Hubs', 'apim': 'API-Management-Services',
    'openai': 'Azure-OpenAI', 'devops': 'Azure-DevOps', 'resource-group': 'Resource-Groups',
    'subscription': 'Subscriptions', 'bastion': 'Bastions', 'managed-identity': 'Managed-Identities',
    'defender': 'Microsoft-Defender-for-Cloud', 'sentinel': 'Azure-Sentinel', 'backup': 'Recovery-Services-Vaults',
}

# badge file name -> path under kubernetes/community icons/svg/
K8S = {
    # control plane and nodes (only the labelled set exists for these; the label is part of the art)
    'api': 'control_plane_components/labeled/api', 'c-m': 'control_plane_components/labeled/c-m',
    'c-c-m': 'control_plane_components/labeled/c-c-m', 'sched': 'control_plane_components/labeled/sched',
    'kubelet': 'control_plane_components/labeled/kubelet', 'k-proxy': 'control_plane_components/labeled/k-proxy',
    'control-plane': 'infrastructure_components/unlabeled/control-plane', 'node': 'infrastructure_components/unlabeled/node',
    'etcd': 'infrastructure_components/unlabeled/etcd',
    # resources (unlabelled: the node name in the diagram says which object it is)
    **{r: f'resources/unlabeled/{r}' for r in (
        'pod deploy rs sts ds job cronjob svc ing ep netpol cm secret pv pvc sc vol ns sa role c-role rb crb '
        'crd hpa limits quota user group').split()},
}

# badge file name -> CNCF project folder (icon/color first; print or black when colour art is raster)
CNCF = {n: n for n in (
    'buildpacks cert-manager chaosmesh cloudcustodian cloudevents cloudnativepg cni contour coredns cortex crio '
    'crossplane dragonfly emissary-ingress flatcar grpc in-toto karmada keda kserve kubeedge kubeflow kubescape '
    'kubevela kubevirt kyverno litmus metal3-io notary open-policy-agent opencost '
    'openkruise openyurt operatorframework spiffe spire strimzi tikv tuf volcano wasmcloud artifacthub microcks '
    'k8gb openfga confidential-containers').split()}
CNCF.update({'envoy-gateway': 'envoy/envoy-gateway', 'flagger': 'flux/flagger', 'ztunnel': 'istio/ztunnel',
             'kueue': 'kubernetes/sub-projects/kueue', 'jobset': 'kubernetes/sub-projects/Jobset',
             'external-secrets': 'external-secrets-operator'})
# icon files that do not follow <folder>/icon/<v>/<folder>-icon-<v>.svg; {v} is color, print or black
CNCF_FILE = {'kserve': 'k-serve-icon-{v}.svg', 'jobset': 'JobSet-icon-{v}.svg', 'metal3-io': 'metal3-icon-{v}.svg',
             'wasmcloud': 'wasmcloud.icon_green.svg', 'kubeflow': 'kubeflow-icon.svg',
             'notary': 'notary-project-icon-{v}.svg',
             'open-policy-agent': 'opa-icon-{v}.svg', 'opencost': 'Opencost_Icon_Color.svg',
             'external-secrets': 'eso-icon-{v}.svg'}

# badge file name -> (GitHub repo, pinned commit, path): Linux Foundation projects whose art is not in cncf/artwork
LF = {'agentgateway': ('agentgateway/agentgateway', 'ae6db4414b0fbc2e23a27b10ebd384fe28a7e2ee', 'ui/public/favicon.svg')}

# badge file name -> (GitHub repo, pinned commit, path, viewBox or None): other projects' own art.
# A viewBox crops a logo file to its mark (the name is already on the box, so the wordmark goes).
PROJ = {
    'velero': ('vmware-tanzu/velero', '48b876fe2db639b56a84643bd8fb312049bf9cd5', 'site/static/img/Velero.svg', '30 26 148 148'),
    'kamaji': ('clastix/kamaji', '60204b0c2b794792dfdc3c7700b4818217a92a95', 'assets/logo.svg', '114 36 572 570'),
    # cncf/artwork's Kube-OVN icon embeds a bitmap; its stacked logo is all vector, so crop that to the mark
    'kube-ovn': ('cncf/artwork', 'bffd512a8b625f15cf5f8e0427469380b5768e90',
                 'projects/kube-ovn/stacked/color/kube-ovn-stacked-color.svg', '30 58 100 83'),
    'linstor': ('LINBIT/linstor-gui', 'c8e42c262baeeababbd5f7a4638ae2037399dd75', 'public/favicon.svg', None),
}

# our glyph name -> Lucide icon name. HAND names are our own drawings and are never replaced.
HAND = {'robot', 'shield', 'gear', 'person', 'doc', 'policy', 'target', 'chart', 'filter', 'inbox', 'check'}
GLYPHS = {
    'server': 'server', 'server-cog': 'server-cog', 'server-down': 'server-crash', 'storage': 'hard-drive',
    'backup': 'hard-drive-download', 'database': 'database', 'archive': 'archive', 'disk': 'disc-3',
    'cpu': 'cpu', 'chip': 'microchip', 'memory': 'memory-stick', 'switch': 'network', 'router': 'router',
    'firewall': 'brick-wall-fire', 'wall': 'brick-wall', 'cable': 'cable', 'port': 'ethernet-port',
    'loadbalancer': 'split', 'wifi': 'wifi', 'antenna': 'radio-tower', 'satellite': 'satellite-dish',
    'globe': 'globe', 'cloud': 'cloud', 'cloud-cog': 'cloud-cog', 'datacenter': 'warehouse',
    'building': 'building', 'factory': 'factory', 'container': 'container', 'box': 'box', 'boxes': 'boxes',
    'package': 'package', 'layers': 'layers', 'vm': 'monitor', 'laptop': 'laptop', 'terminal': 'terminal',
    'lock': 'lock', 'key': 'key-round', 'shield-check': 'shield-check', 'power': 'plug', 'bolt': 'zap',
    'battery': 'battery-charging', 'fan': 'fan', 'gauge': 'gauge', 'activity': 'activity', 'bell': 'bell',
    'siren': 'siren', 'scale': 'scaling', 'workflow': 'workflow', 'fork': 'git-fork', 'sync': 'refresh-ccw-dot',
    'users': 'users', 'swap': 'arrow-left-right',
}

SVG_NS = 'http://www.w3.org/2000/svg'
XLINK = '{http://www.w3.org/1999/xlink}href'


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as r: return r.read().decode('utf-8')


NUMERIC = {'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height'}


def short(v):
    """Round every number in an attribute to 3 decimals: plenty for badge art, and half the bytes."""
    return re.sub(r'-?\d*\.\d+(?:e-?\d+)?', num, v)


def num(m):
    t = f'{float(m.group()):.3f}'.rstrip('0').rstrip('.')
    t = '0' if t in ('', '-0') else t
    # "1.0004.5" is two numbers; once the first loses its dot, keep them apart
    nxt = m.string[m.end():m.end() + 1]
    return t + ' ' if '.' not in t and nxt == '.' else t


def short_path(d):
    """short() for path data, read token by token so that compact arc flags ("a1 1 0 01.5.5") survive."""
    out, cmd, i, n = [], '', 0, 0
    tok = re.compile(r'\s*,?\s*(?:([MmZzLlHhVvCcSsQqTtAa])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?))')
    while i < len(d):
        m = tok.match(d, i)
        if not m:
            if d[i:].strip(' ,\n\t'): sys.exit(f'cannot read path data at "{d[i:i + 20]}"')
            break
        if m.group(1): cmd, n = m.group(1), 0; out.append(cmd); i = m.end(); continue
        if cmd in 'Aa' and n % 7 in (3, 4):  # a flag is one character, whatever follows it
            j = m.start(2); out.append(' ' + d[j]); i = j + 1; n += 1; continue
        t = f'{float(m.group(2)):.3f}'.rstrip('0').rstrip('.')
        out.append(' ' + ('0' if t in ('', '-0') else t)); i = m.end(); n += 1
    return re.sub(r'([A-Za-z]) ', r'\1', ''.join(out)).strip()


def inline_styles(root):
    """Move simple `.a,.b{k:v;...}` rules from <style> into each element's style attribute."""
    rules = {}
    for st in root.iter(f'{{{SVG_NS}}}style'):
        css = re.sub(r'/\*.*?\*/', '', st.text or '', flags=re.S)
        for sel, body in re.findall(r'([^{}]+)\{([^}]*)\}', css):
            for s in sel.split(','):
                s = s.strip()
                if not re.fullmatch(r'\.?[\w-]+', s): sys.exit(f'unsupported CSS selector "{s}"')
                rules.setdefault(s, []).append(body.strip().rstrip(';'))
    for el in root.iter():
        if not isinstance(el.tag, str): continue
        cls = el.attrib.pop('class', '').split()
        decl = rules.get(el.tag.split('}')[-1], []) + [b for c in cls for b in rules.get('.' + c, [])]
        if decl: el.set('style', ';'.join(decl + ([el.get('style')] if el.get('style') else [])))


def clean(text, prefix, where):
    text = re.sub(r'<!DOCTYPE[^>]*>', '', text)
    root = ET.fromstring(text)
    if root.tag != f'{{{SVG_NS}}}svg': sys.exit(f'{where}: not an SVG')
    if not root.get('viewBox'):
        w, h = (re.match(r'[\d.]+', root.get(k, '')) for k in ('width', 'height'))
        if not (w and h): sys.exit(f'{where}: needs a viewBox or a width and height')
        root.set('viewBox', f'0 0 {w.group()} {h.group()}')
    if any(e.tag == f'{{{SVG_NS}}}image' for e in root.iter()): raise ValueError('raster image')
    inline_styles(root)
    # drop non-SVG elements, metadata, styles, titles; drop non-SVG attributes
    def prune(p):
        for c in list(p):
            if not isinstance(c.tag, str) or not c.tag.startswith(f'{{{SVG_NS}}}') or \
               c.tag.split('}')[1] in ('metadata', 'style', 'title', 'desc', 'script'):
                p.remove(c); continue
            prune(c)
    prune(root)
    used = set()
    for e in root.iter():
        for k, v in e.attrib.items():
            used.update(re.findall(r'url\(#([^)]+)\)', v))
            if k in ('href', XLINK) and v.startswith('#'): used.add(v[1:])
    for e in root.iter():
        if e.get('id') and e.get('id') not in used: del e.attrib['id']
    ids = used
    for e in root.iter():
        for k in list(e.attrib):
            v = e.attrib[k]
            if k == XLINK: del e.attrib[k]; e.set('href', v); k = 'href'
            elif k.startswith('{') or k.startswith('on') or k in ('data-name',): del e.attrib[k]; continue
            v = e.get(k)
            if k == 'id': e.set(k, f'{prefix}-{v}')
            elif k == 'href' and v.startswith('#') and v[1:] in ids: e.set(k, f'#{prefix}-{v[1:]}')
            elif k == 'd': e.set(k, short_path(v))
            elif k in ('transform', 'points') or k in NUMERIC: e.set(k, short(v))
            elif 'url(#' in v: e.set(k, re.sub(r'url\(#([^)]+)\)', lambda m: f'url(#{prefix}-{m.group(1)})', v))
        if e.tag == f'{{{SVG_NS}}}text' or e.tag == f'{{{SVG_NS}}}tspan':
            st = re.sub(r'font-family:[^;]*;?|-inkscape-font-specification:[^;]*;?', '', e.get('style', ''))
            e.set('style', st); e.set('font-family', "'IBM Plex Sans', Arial, sans-serif")
        if 'style' in e.attrib:
            keep = [d.strip() for d in e.get('style').split(';') if d.strip() and not d.strip().startswith('-inkscape')]
            if e.tag.split('}')[1] not in ('text', 'tspan'):  # Inkscape writes text settings on every shape
                keep = [d for d in keep if not re.match(r'(font|line-height|text-|letter-|word-|writing-|baseline|direction|'
                                                         r'block-progression|white-space|shape-|isolation|mix-blend|solid-|'
                                                         r'color-|image-rendering|enable-background|marker|overflow|visibility|'
                                                         r'display:inline|color:)', d)]
            if keep: e.set('style', ';'.join(keep))
            else: del e.attrib['style']
    ET.register_namespace('', SVG_NS)
    inner = ''.join(ET.tostring(c, encoding='unicode') for c in root)
    inner = re.sub(r'\s*xmlns(:\w+)?="[^"]*"', '', inner)
    inner = re.sub(r'>\s+<', '><', inner).strip()
    return f'<svg xmlns="{SVG_NS}" viewBox="{root.get("viewBox")}">{inner}</svg>\n'


def write(folder, name, svg):
    os.makedirs(os.path.join(HERE, 'own', folder), exist_ok=True)
    open(os.path.join(HERE, 'own', folder, name + '.svg'), 'w', encoding='utf-8').write(svg)


def vendor_k8s():
    for n, p in K8S.items():
        url = f'https://raw.githubusercontent.com/kubernetes/community/{K8S_REF}/icons/svg/{p}.svg'
        write('k8s', n, clean(fetch(url), f'k8s-{n}', url))
    print(f'own/k8s: {len(K8S)} icons')


def vendor_cncf():
    for n, p in CNCF.items():
        leaf = CNCF_FILE.get(n, p.split('/')[-1] + '-icon-{v}.svg')
        for v in ('color', 'print', 'black'):
            url = f'https://raw.githubusercontent.com/cncf/artwork/{CNCF_REF}/projects/{p}/icon/{v}/{leaf.format(v=v)}'
            try: write('cncf', n, clean(fetch(url), f'cncf-{n}', url)); break
            except ValueError: continue
            except urllib.error.HTTPError as e: sys.exit(f'{url}: {e}')
        else: sys.exit(f'cncf {n}: no vector icon art')
    print(f'own/cncf: {len(CNCF)} icons')


def vendor_lf():
    for n, (repo, ref, path) in LF.items():
        url = f'https://raw.githubusercontent.com/{repo}/{ref}/{path}'
        write('lf', n, clean(fetch(url), f'lf-{n}', url))
    print(f'own/lf: {len(LF)} icons')


def vendor_proj():
    for n, (repo, ref, path, vb) in PROJ.items():
        url = f'https://raw.githubusercontent.com/{repo}/{ref}/{path}'
        svg = clean(fetch(url), f'proj-{n}', url)
        if vb:  # crop: a new viewBox, and a clip to it, as the box it is drawn in may not share its shape
            x, y, w, h = vb.split()
            head, inner = svg.split('>', 1)
            head, found = re.subn(r'viewBox="[^"]*"', f'viewBox="{vb}"', head)
            if not found: sys.exit(f'{url}: no viewBox to crop')
            svg = (f'{head}><clipPath id="proj-{n}-crop"><rect x="{x}" y="{y}" width="{w}" height="{h}"/></clipPath>'
                   f'<g clip-path="url(#proj-{n}-crop)">{inner.rsplit("</svg>", 1)[0]}</g></svg>\n')
        write('proj', n, svg)
    print(f'own/proj: {len(PROJ)} icons')


def to_path(tag, a):
    f = lambda k, d=0: float(a.get(k, d))
    g = lambda x: f'{x:g}'
    # A path's first moveto is absolute even when written "m"; joined after another element it would not be.
    # Make it "M", and keep any pairs after it relative linetos ("m3 7 8 5" is "M3 7l8 5").
    if tag == 'path':
        m = re.match(r'\s*m\s*(-?(?:\d+\.?\d*|\.\d+))[\s,]*(-?(?:\d+\.?\d*|\.\d+))\s*,?\s*(.*)', a['d'], re.S)
        if not m: return a['d']
        rest = m.group(3)
        return f'M{m.group(1)} {m.group(2)}' + ('l' + rest if re.match(r'[-\d.]', rest) else rest)
    if tag == 'line': return f'M{g(f("x1"))} {g(f("y1"))}L{g(f("x2"))} {g(f("y2"))}'
    if tag in ('polyline', 'polygon'):
        pts = re.findall(r'-?[\d.]+', a['points']); pairs = [f'{pts[i]} {pts[i + 1]}' for i in range(0, len(pts), 2)]
        return 'M' + 'L'.join(pairs) + ('Z' if tag == 'polygon' else '')
    if tag in ('circle', 'ellipse'):
        cx, cy = f('cx'), f('cy'); rx = f('r') if tag == 'circle' else f('rx'); ry = f('r') if tag == 'circle' else f('ry')
        return f'M{g(cx - rx)} {g(cy)}a{g(rx)} {g(ry)} 0 1 0 {g(2 * rx)} 0a{g(rx)} {g(ry)} 0 1 0 {g(-2 * rx)} 0'
    if tag == 'rect':
        x, y, w, h = f('x'), f('y'), f('width'), f('height'); r = f('rx', a.get('ry', 0))
        if not r: return f'M{g(x)} {g(y)}h{g(w)}v{g(h)}h{g(-w)}Z'
        return (f'M{g(x + r)} {g(y)}h{g(w - 2 * r)}a{g(r)} {g(r)} 0 0 1 {g(r)} {g(r)}v{g(h - 2 * r)}'
                f'a{g(r)} {g(r)} 0 0 1 {g(-r)} {g(r)}h{g(-(w - 2 * r))}a{g(r)} {g(r)} 0 0 1 {g(-r)} {g(-r)}'
                f'v{g(-(h - 2 * r))}a{g(r)} {g(r)} 0 0 1 {g(r)} {g(-r)}Z')
    sys.exit(f'lucide: unsupported element {tag}')


def vendor_glyphs():
    d = os.path.join(CACHE, f'lucide-static-{LUCIDE}')
    if not os.path.isdir(os.path.join(d, 'package')):
        os.makedirs(d, exist_ok=True)
        tgz = subprocess.run(['npm', 'pack', f'lucide-static@{LUCIDE}', '--silent'], cwd=d, check=True,
                             capture_output=True, text=True).stdout.strip().splitlines()[-1]
        with tarfile.open(os.path.join(d, tgz)) as t: t.extractall(d, filter='data')
    nodes = json.load(open(os.path.join(d, 'package', 'icon-nodes.json')))
    gpath = os.path.join(HERE, 'glyphs.json')
    glyphs = json.load(open(gpath)); added = 0
    for ours, theirs in GLYPHS.items():
        if ours in HAND: sys.exit(f'{ours}: name taken by one of our own glyphs')
        glyphs[ours] = ''.join(to_path(t, a) for t, a in nodes[theirs]); added += 1
    out = '{\n' + ',\n'.join(f' {json.dumps(k)}: {json.dumps(v)}' for k, v in glyphs.items()) + '\n}\n'
    open(gpath, 'w').write(out)
    print(f'glyphs.json: {added} glyphs from Lucide {LUCIDE}, {len(glyphs)} in all')


def fetch_zip(url, pin):
    import hashlib, io, zipfile
    with urllib.request.urlopen(url, timeout=120) as r: data = r.read()
    got = hashlib.sha256(data).hexdigest()
    if pin and got != pin: sys.exit(f'{url}: changed upstream (sha256 {got}); look at the new icons, then update the pin')
    if not pin: print(f'{url}: sha256 {got} (pin it in vendor.py)')
    return zipfile.ZipFile(io.BytesIO(data))


def vendor_gcp():
    z = fetch_zip(GCP_ZIP, GCP_SHA256)
    for n, folder in GCP.items():
        write('gcp', n, clean(z.read(f'{folder}/{folder}.svg').decode('utf-8'), f'gcp-{n}', f'{folder}.svg'))
    print(f'own/gcp: {len(GCP)} icons')


def vendor_azure():
    z = fetch_zip(AZURE_ZIP, AZURE_SHA256)
    files = {re.sub(r'^.*icon-service-', '', f.lower()): f for f in z.namelist() if f.lower().endswith('.svg') and 'icon-service-' in f.lower()}
    missing = []
    for n, name in AZURE.items():
        f = files.get(name.lower() + '.svg')
        if not f: missing.append(name); continue
        write('azure', n, clean(z.read(f).decode('utf-8'), f'az-{n}', f))
    print(f'own/azure: {len(AZURE) - len(missing)} icons' + (f'; not in this zip: {", ".join(missing)}' if missing else ''))
    for n, name in AZURE.items():
        if name not in missing: print(f'  {{"id": "az-{n}", "name": "Azure {name.replace("-", " ")}", "from": "own:azure/{n}.svg", "group": "azure"}},')


if __name__ == '__main__':
    ALL = {'k8s': vendor_k8s, 'cncf': vendor_cncf, 'lf': vendor_lf, 'proj': vendor_proj, 'glyphs': vendor_glyphs, 'gcp': vendor_gcp, 'azure': vendor_azure}
    for k in sys.argv[1:] or ALL: ALL[k]()
