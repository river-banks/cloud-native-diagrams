/* The Light / Dark / Auto toggle, one copy for every page that has one: the page templates (page.js inlines it
   before _dg.js), the style picker and preview (build.py), and the gallery (gallery.js). The statechart and
   Field Notes pages carry the same few lines inline, because each is one hand-written file.
   It only sets data-theme on <html> (no attribute = Auto, follows the device); CSS switches the page and every
   drawing together. The choice is remembered per page; storage may be blocked, so every access is guarded.
     dgToggle({ fixed })   wire every `.dg-theme button[data-t]`; `fixed` (light|dark|auto) wins over the stored choice
     dgTheme()             the theme on show now: 'light' or 'dark'
   Listeners hear a `dg-theme` event on document whenever the theme on show may have changed. */
function dgTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function dgToggle(opts) {
  const root = document.documentElement, key = 'dg-theme:' + location.pathname, fixed = opts && opts.fixed;
  const set = t => { if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme; };
  if (fixed) set(fixed);
  else { try { const t = localStorage.getItem(key); if (t) set(t); } catch (e) {} }
  if (!root.dataset.theme) delete root.dataset.theme;
  const sync = () => document.querySelectorAll('.dg-theme button[data-t]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === (root.dataset.theme || 'auto'))));
  const told = () => document.dispatchEvent(new CustomEvent('dg-theme', { detail: dgTheme() }));
  document.querySelectorAll('.dg-theme button[data-t]').forEach(b => b.addEventListener('click', () => {
    set(b.dataset.t);
    try { localStorage.setItem(key, b.dataset.t); } catch (e) {}
    sync(); told();
  }));
  if (window.matchMedia) {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => { if (!root.dataset.theme) told(); };
    if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
  }
  sync();
}
