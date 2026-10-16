/* VidTube front-end core: state, API client, router, layout, shared components. */
'use strict';
window.VT = (() => {
  const state = { me: null, user: null, channel: null, prefs: {}, managed: [], unread: 0, platform: 'vidtube', cats: {}, es: null, autoplay: true, event: null, installPrompt: null, installed: false };
  const routes = [];
  const listeners = {};

  /* ---------- tiny DOM helper ---------- */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k in el && k !== 'list' && k !== 'form' && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    } else if (attrs !== undefined) children.unshift(attrs);
    append(el, children);
    return el;
  }
  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const I = {
    menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'), search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    upload: svg('<path d="M12 16V4m0 0-4 4m4-4 4 4M4 20h16"/>'), bell: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Zm4 4h4"/>'),
    home: svg('<path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9Z"/>'), shorts: svg('<path d="M10 4h4l6 6-6 6h-4V4Z" transform="rotate(90 12 12)"/><path d="m10 9 5 3-5 3V9Z" fill="currentColor"/>'),
    subs: svg('<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 4h10M10 12l5 2.5-5 2.5v-5Z"/>'), library: svg('<path d="M4 6h12v14H4zM16 6l4-2v14l-4 2"/><path d="m8 11 4 2-4 2v-4Z"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2"/>'), playlist: svg('<path d="M4 6h12M4 10h12M4 14h8M16 14l4 2-4 2v-4Z"/>'),
    like: svg('<path d="M7 11v9H3v-9h4Zm0 0 4-8a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 16.8 20H7"/>'), dislike: svg('<path d="M17 13V4h4v9h-4Zm0 0-4 8a2 2 0 0 1-2-2v-4H6a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 7.2 4H17"/>'),
    share: svg('<path d="M14 5l7 6-7 6v-4C8 13 5 15 3 19c0-6 4-11 11-12V5Z"/>'), save: svg('<path d="M4 6h12M4 10h12M4 14h8M18 12v8M14 16h8"/>'),
    download: svg('<path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16"/>'), more: svg('<circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/>'),
    moreh: svg('<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
    help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7M12 17h.01"/>'), studio: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3V9Z" fill="currentColor"/>'),
    admin: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/>'), globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    check: svg('<path d="m5 12 5 5L20 7"/>'), close: svg('<path d="M6 6l12 12M18 6 6 18"/>'), play: svg('<path d="M7 5v14l12-7L7 5Z" fill="currentColor"/>'),
    logout: svg('<path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10"/>'), heart: svg('<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z" fill="currentColor"/>'),
    pin: svg('<path d="M12 17v5M8 3h8l-1 7 3 3H6l3-3-1-7Z"/>'), flag: svg('<path d="M5 21V4h11l-1 4 1 4H5"/>'), trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
    edit: svg('<path d="M4 20h4l11-11-4-4L4 16v4ZM13 7l4 4"/>'), chevron: svg('<path d="m9 6 6 6-6 6"/>'), chevd: svg('<path d="m6 9 6 6 6-6"/>'), back: svg('<path d="m15 6-6 6 6 6"/>'),
    eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'), eyeoff: svg('<path d="M3 3l18 18M10 10a3 3 0 0 0 4 4M9.9 5.2A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6A16 16 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 4.3-1"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), chart: svg('<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>'), comment: svg('<path d="M4 5h16v11H8l-4 4V5Z"/>'),
    paint: svg('<path d="M12 3a9 9 0 0 0 0 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 0 0 3-3 9 9 0 0 0-8-11Z"/><circle cx="7.5" cy="11.5" r="1" fill="currentColor"/><circle cx="12" cy="7.5" r="1" fill="currentColor"/><circle cx="16.5" cy="11.5" r="1" fill="currentColor"/>'),
    money: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>'), music: svg('<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/>'),
    users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.6"/>'), list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    inbox: svg('<path d="M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6l2-8Z"/>'), sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>'),
    moon: svg('<path d="M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11Z"/>'), copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/>'), mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
    scissors: svg('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M20 4 8.5 15.5M8.5 8.5 20 20"/>'), lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'), mute: svg('<path d="M4 9v6h4l5 4V5L8 9H4ZM16 9l5 6M21 9l-5 6"/>'), sound: svg('<path d="M4 9v6h4l5 4V5L8 9H4ZM16 8a5 5 0 0 1 0 8M18.5 5.5a9 9 0 0 1 0 13"/>'),
    verified: svg('<path d="M12 2l2.4 2 3.1-.4 1 3 2.7 1.6-1 3 1 3-2.7 1.6-1 3-3.1-.4L12 22l-2.4-2-3.1.4-1-3L2.8 15.8l1-3-1-3 2.7-1.6 1-3 3.1.4L12 2Z" fill="currentColor" stroke="none"/><path d="m8.5 12 2.5 2.5 4.5-5" stroke="var(--surface)" stroke-width="2"/>'),
  };
  const icon = (name, cls = '') => { const t = document.createElement('span'); t.innerHTML = I[name] || ''; const s = t.firstChild; if (s) { s.classList.add('ico'); if (cls) s.classList.add(cls); } return s || t; };

  /* ---------- formatting ---------- */
  const fmtNum = n => { n = Number(n) || 0; if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K'; return String(n); };
  const fmtFull = n => (Number(n) || 0).toLocaleString('en');
  const fmtDur = s => { s = Math.max(0, Math.round(Number(s) || 0)); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); };
  const fmtHours = s => { const hrs = (Number(s) || 0) / 3600; return hrs >= 100 ? fmtNum(Math.round(hrs)) : hrs.toFixed(1); };
  function ago(ts) {
    if (!ts) return '';
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d / 60) + ' min ago'; if (d < 86400) return Math.floor(d / 3600) + ' hours ago';
    if (d < 86400 * 30) { const n = Math.floor(d / 86400); return n === 1 ? '1 day ago' : n + ' days ago'; }
    if (d < 86400 * 365) { const n = Math.floor(d / (86400 * 30)); return n === 1 ? '1 month ago' : n + ' months ago'; }
    const n = Math.floor(d / (86400 * 365)); return n === 1 ? '1 year ago' : n + ' years ago';
  }
  const fmtDate = ts => (ts ? new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const fmtDateTime = ts => (ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fileUrl = n => (n ? '/files/' + n : null);
  const platformName = p => (p === 'geotube' ? 'GeoTube' : 'VidTube');

  /* ---------- API ---------- */
  async function api(method, url, body, opts = {}) {
    const init = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined && !opts.raw) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    if (opts.raw) init.body = body;
    const res = await fetch(url, init);
    let data = null;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
    return data;
  }
  const get = (url) => api('GET', url);
  const post = (url, body) => api('POST', url, body);
  const patch = (url, body) => api('PATCH', url, body);
  const put = (url, body) => api('PUT', url, body);
  const del = (url) => api('DELETE', url);
  // Uploads a File with progress (XHR gives upload progress events; fetch does not).
  function upload(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total, e.loaded); };
      xhr.onload = () => { let d = {}; try { d = JSON.parse(xhr.responseText); } catch {} if (xhr.status >= 200 && xhr.status < 300) resolve(d); else reject(new Error(d.error || 'Upload failed')); };
      xhr.onerror = () => reject(new Error('Upload failed: network error'));
      xhr.send(file);
      if (onProgress) onProgress.cancel = () => xhr.abort();
    });
  }

  /* ---------- session ---------- */
  async function loadMe() {
    const [me, ev] = await Promise.all([get('/api/me'), get('/api/event/halloween').catch(() => null)]);
    state.event = ev;
    setMe(me);
    return me;
  }
  // A counted view moves the Halloween progress along; tell the viewer when the GIF maker unlocks.
  function eventViewCounted() {
    const ev = state.event;
    if (!ev || !ev.active || !state.user) return;
    ev.watched++;
    if (!ev.unlocked && ev.watched >= ev.goal) { ev.unlocked = true; toast('🎃 Unlocked: you can now make your own GIFs! Press GIF under a comment → My GIFs.'); }
  }
  function setMe(me) {
    state.user = me.user || null; state.channel = me.channel || null; state.prefs = me.prefs || {}; state.managed = me.managed || []; state.unread = me.unread || 0;
    applyTheme();
    renderTopbar(); renderSidebar();
    if (state.user) connectEvents(); else if (state.es) { state.es.close(); state.es = null; }
    emit('me');
  }
  function applyTheme() {
    const t = state.prefs.theme || localStorage.getItem('vt_theme') || 'system';
    if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  }
  const isMod = () => state.user && ['moderator', 'admin'].includes(state.user.role);
  const isAdmin = () => state.user && state.user.role === 'admin';
  function requireLogin(msg = 'Sign in to do that') {
    if (state.user) return true;
    modal({ title: 'Sign in', body: h('div', h('p', msg), h('div', { class: 'row mt16' }, h('a', { class: 'btn primary', href: href('/login'), onclick: closeModal }, 'Sign in'), h('a', { class: 'btn', href: href('/register'), onclick: closeModal }, 'Create account'))) });
    return false;
  }
  function connectEvents() {
    if (state.es) return;
    const es = new EventSource('/api/events');
    es.addEventListener('notification', e => {
      const n = JSON.parse(e.data);
      state.unread++; renderTopbar();
      toast(n.title, { action: n.link ? { label: 'Open', fn: () => navigate(n.link) } : null });
      emit('notification', n);
    });
    es.onerror = () => { es.close(); state.es = null; setTimeout(() => { if (state.user) connectEvents(); }, 15000); };
    state.es = es;
  }
  const on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return () => { listeners[ev] = listeners[ev].filter(f => f !== fn); }; };
  const emit = (ev, data) => { for (const f of listeners[ev] || []) try { f(data); } catch (e) { console.error(e); } };

  /* ---------- router ---------- */
  function route(pattern, handler, opts = {}) {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ rx, keys, handler, opts });
  }
  function href(path) { return (state.platform === 'geotube' && !path.startsWith('/geotube') ? '/geotube' : '') + path; }
  function navigate(path, { replace = false } = {}) {
    if (/^https?:/.test(path)) { location.href = path; return; }
    if (!path.startsWith('/geotube') && !path.startsWith('/vidtube') && state.platform === 'geotube') path = '/geotube' + path;
    if (path.startsWith('/vidtube')) path = path.slice(8) || '/';
    history[replace ? 'replaceState' : 'pushState']({}, '', path);
    render();
  }
  let current = null;
  async function render() {
    let path = location.pathname;
    const platform = path === '/geotube' || path.startsWith('/geotube/') ? 'geotube' : 'vidtube';
    if (platform === 'geotube' || path === '/vidtube' || path.startsWith('/vidtube/')) path = path.slice(8) || '/';
    const changedPlatform = platform !== state.platform;
    state.platform = platform;
    document.documentElement.dataset.platform = platform;
    document.title = platformName(platform);
    if (changedPlatform) { renderTopbar(); renderSidebar(); }
    const query = Object.fromEntries(new URLSearchParams(location.search));
    const main = $('#main');
    if (current && current.cleanup) { try { current.cleanup(); } catch {} }
    closeMenus(); closeModal();
    document.body.classList.remove('drawer');
    for (const r of routes) {
      const m = r.rx.exec(path);
      if (!m) continue;
      const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const ctx = { params, query, path, platform, cleanup: null };
      current = ctx;
      main.innerHTML = ''; main.append(h('div', { class: 'spinner' }));
      try {
        const node = await r.handler(ctx);
        if (current !== ctx) return;
        main.innerHTML = ''; if (node) main.append(node);
        if (!query.c) window.scrollTo(0, 0);
      } catch (e) {
        if (current !== ctx) return;
        console.error(e);
        main.innerHTML = '';
        main.append(h('div', { class: 'empty' }, h('h3', e.status === 401 ? 'Sign in to continue' : e.status === 403 ? 'Not available' : e.status === 404 ? 'Not found' : 'Something went wrong'), h('p', e.message),
          e.status === 401 ? h('a', { class: 'btn primary mt8', href: href('/login?next=' + encodeURIComponent(location.pathname + location.search)) }, 'Sign in') : h('a', { class: 'btn mt8', href: href('/') }, 'Go home')));
      }
      highlightNav();
      return;
    }
    main.innerHTML = ''; main.append(h('div', { class: 'empty' }, h('h3', 'Page not found'), h('a', { class: 'btn', href: href('/') }, 'Go home')));
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/files/') || url.pathname.startsWith('/media/') || url.pathname.startsWith('/api/')) return;
    e.preventDefault();
    if (url.pathname + url.search === location.pathname + location.search) return;
    history.pushState({}, '', url.pathname + url.search + url.hash);
    render();
  });
  window.addEventListener('popstate', render);

  /* ---------- layout: top bar ---------- */
  // Jack-o'-lantern version of the play-button logo, used while the Halloween event runs.
  const HALLOWEEN_MARK = '<svg viewBox="0 0 32 32"><path d="M15 2h3.5l-1 5h-2.5z" fill="#15803d"/><path d="M15.5 2c2-1 4 0 5 1.5" stroke="#15803d" stroke-width="1.6" fill="none" stroke-linecap="round"/><rect x="2" y="7" width="28" height="21" rx="9" fill="#f97316"/><path d="M9 7c-2 5-2 12 0 20M16 6.5v22M23 7c2 5 2 12 0 20" stroke="#ea580c" stroke-width="1.4" fill="none" opacity=".7"/><path d="M6.5 15.5l4.5-3.5 1.5 3.5z" fill="#1a0b2e"/><path d="M25.5 15.5l-4.5-3.5-1.5 3.5z" fill="#1a0b2e"/><path d="M12 18l9 4.5-9 4.5z" fill="#1a0b2e"/></svg>';
  function logo() {
    const geo = state.platform === 'geotube';
    const hw = !!(state.event && state.event.active);
    const mark = hw ? HALLOWEEN_MARK : geo
      ? '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#e6b400"/><path d="M9 10c3-3 8-2 10 1s-1 6 2 8-1 5-4 4-7 1-8-3 1-7 0-10Z" fill="#fff3b0"/><path d="M13 13l6 3-6 3v-6Z" fill="#1a1400"/></svg>'
      : '<svg viewBox="0 0 32 32"><rect x="2" y="6" width="28" height="20" rx="6" fill="#e6b400"/><path d="M13 11l8 5-8 5v-10Z" fill="#1a1400"/></svg>';
    const fav = document.querySelector('link[rel="icon"]');
    if (fav) fav.href = hw ? '/img/favicon-halloween.svg' : '/img/favicon.svg';
    return h('a', { class: 'logo' + (hw ? ' halloween' : ''), href: geo ? '/geotube' : '/', title: hw ? 'Happy Halloween!' : '', html: mark + (geo ? '<span>Geo<span class="tube">Tube</span></span>' : '<span>Vid<span class="tube">Tube</span></span>') + (hw ? '<span class="hw-bat" aria-hidden="true">🦇</span>' : '') });
  }
  // Unread notifications in the browser tab, the way Gmail does it: "(3) VidTube". Pages set their own
  // document.title freely; the observer puts the count back in front of it.
  const TITLE_BADGE = /^\(\d+\+?\) /;
  function syncTitle() {
    const base = document.title.replace(TITLE_BADGE, "");
    const want = (state.user && state.unread ? "(" + (state.unread > 99 ? "99+" : state.unread) + ") " : "") + base;
    if (document.title !== want) document.title = want;
  }
  new MutationObserver(syncTitle).observe(document.head, { childList: true, subtree: true, characterData: true });
  function renderTopbar() {
    syncTitle();
    const bar = $('#topbar'); bar.innerHTML = '';
    const menuBtn = h('button', { class: 'btn icon', 'aria-label': 'Menu', onclick: () => {
      if (window.innerWidth <= 900) document.body.classList.toggle('drawer'); else { document.body.classList.toggle('mini'); localStorage.setItem('vt_mini', document.body.classList.contains('mini') ? '1' : '0'); }
    } }, icon('menu'));
    bar.append(menuBtn, logo(), searchBar());
    const actions = h('div', { class: 'actions' });
    if (state.user) {
      actions.append(h('a', { class: 'btn icon', href: href('/studio/upload'), title: 'Upload video' }, icon('upload')));
      const bell = h('button', { class: 'btn icon', title: 'Notifications', onclick: e => notifPanel(e.currentTarget) }, icon('bell'), state.unread ? h('span', { class: 'badge-dot' }, state.unread > 99 ? '99+' : state.unread) : null);
      actions.append(bell);
      actions.append(h('button', { class: 'btn icon', title: 'Account', onclick: e => accountMenu(e.currentTarget) }, avatar(state.channel ? state.channel.avatar : null, state.channel ? state.channel.name : state.user.email)));
    } else {
      actions.append(h('button', { class: 'btn icon', title: 'Theme', onclick: toggleTheme }, icon('moon')));
      actions.append(h('a', { class: 'btn outline', href: href('/login') }, 'Sign in'));
    }
    bar.append(actions);
  }
  function toggleTheme() {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem('vt_theme', next); state.prefs.theme = next; applyTheme();
    if (state.user) patch('/api/prefs', { theme: next }).catch(() => {});
  }
  function avatar(file, name, cls = '') {
    const a = h('span', { class: 'avatar ' + cls });
    if (file) a.append(h('img', { src: fileUrl(file), alt: '' })); else a.textContent = (name || '?').trim().charAt(0).toUpperCase();
    return a;
  }
  function searchBar() {
    const input = h('input', { type: 'search', placeholder: state.platform === 'geotube' ? 'Search maps, countryballs, history...' : 'Search', autocomplete: 'off', 'aria-label': 'Search' });
    const q = new URLSearchParams(location.search).get('q'); if (q && location.pathname.endsWith('/results')) input.value = q;
    const box = h('div', { class: 'suggest hidden' });
    const form = h('form', { onsubmit: e => { e.preventDefault(); const v = input.value.trim(); if (v) navigate('/results?q=' + encodeURIComponent(v)); box.classList.add('hidden'); input.blur(); } }, input, h('button', { type: 'submit', 'aria-label': 'Search' }, icon('search')));
    let timer = null, items = [], active = -1;
    const show = list => {
      items = list; active = -1; box.innerHTML = '';
      if (!list.length) return box.classList.add('hidden');
      list.forEach(s => box.append(h('div', { onmousedown: e => { e.preventDefault(); if (s.channel) navigate('/@' + s.channel); else { input.value = s.text; form.requestSubmit(); } } }, icon(s.history ? 'history' : s.channel ? 'users' : 'search'), h('span', { class: 'grow ellipsis' }, s.text), s.channel ? h('span', { class: 'dim small' }, '@' + s.channel) : null)));
      box.classList.remove('hidden');
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => { try { const r = await get(`/api/search/suggest?platform=${state.platform}&q=${encodeURIComponent(input.value)}`); show(r.items); } catch {} }, 150); });
    input.addEventListener('focus', () => { if (!input.value) input.dispatchEvent(new Event('input')); });
    input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150));
    input.addEventListener('keydown', e => {
      if (box.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; $$('div', box).forEach((d, i) => d.classList.toggle('active', i === active)); input.value = items[active].text; }
      if (e.key === 'Escape') box.classList.add('hidden');
    });
    return h('div', { class: 'searchbar' }, form, box);
  }
  document.addEventListener('keydown', e => { if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); const i = $('.searchbar input'); if (i) i.focus(); } });

  /* ---------- layout: sidebar ---------- */
  let subsCache = null;
  async function renderSidebar() {
    const sb = $('#sidebar'); sb.innerHTML = '';
    const item = (name, label, path, opts = {}) => h('a', { class: 'nav-item', href: opts.abs ? path : href(path), dataset: { path }, onclick: () => document.body.classList.remove('drawer') }, icon(name), h('span', label));
    sb.append(item('home', 'Home', '/'), item('shorts', 'Shorts', '/shorts'), item('subs', 'Subscriptions', '/subscriptions'), item('chart', 'Trending', '/trending'));
    sb.append(h('div', { class: 'nav-sep' }));
    if (state.user) {
      sb.append(item('library', 'Library', '/library'), item('history', 'History', '/history'), item('playlist', 'Playlists', '/playlists'), item('like', 'Liked videos', '/liked'), item('clock', 'Watch later', '/playlist?list=WL'));
      if (state.channel) sb.append(item('users', 'Your channel', '/@' + state.channel.handle));
      sb.append(h('div', { class: 'nav-sep' }));
    } else {
      sb.append(h('div', { style: { padding: '8px 12px 12px' } }, h('p', { class: 'small muted' }, 'Sign in to like videos, comment and subscribe.'), h('a', { class: 'btn outline sm', href: href('/login') }, 'Sign in')), h('div', { class: 'nav-sep' }));
    }
    const geo = state.platform === 'geotube';
    sb.append(h('a', { class: 'switch-platform', href: geo ? '/' : '/geotube' }, icon(geo ? 'studio' : 'globe'), h('div', h('b', geo ? 'Switch to VidTube' : 'Switch to GeoTube'), h('span', { class: 'small muted' }, geo ? 'All videos, every topic' : 'Mapping & Countryballs only'))));
    if (state.user) {
      sb.append(h('div', { class: 'nav-sep' }));
      sb.append(item('studio', state.channel ? 'Studio' : 'Create a channel', state.channel ? '/studio' : '/settings?tab=channel'));
      if (isMod()) sb.append(item('admin', 'Moderation', '/admin'));
    }
    sb.append(item('settings', 'Settings', '/settings'), item('help', 'Help', '/help'));
    if (!state.installed) sb.append(item('download', 'Get the app', '/download'));
    if (state.user) {
      const subsWrap = h('div');
      sb.append(subsWrap);
      try {
        const subs = subsCache && subsCache.platform === state.platform ? subsCache.items : (await get('/api/subscriptions?platform=' + state.platform));
        subsCache = { platform: state.platform, items: subs };
        if (subs.length) {
          subsWrap.append(h('div', { class: 'nav-section' }, 'Subscriptions'));
          subs.slice(0, 12).forEach(s => subsWrap.append(h('a', { class: 'sub-item', href: href('/@' + s.handle) }, avatar(s.avatar, s.name, 'sm'), h('span', { class: 'ellipsis' }, s.name))));
          if (subs.length > 12) subsWrap.append(h('a', { class: 'sub-item', href: href('/subscriptions') }, icon('chevd'), h('span', 'Show all')));
        }
      } catch {}
    }
    sb.append(h('div', { class: 'nav-foot' }, geo ? 'GeoTube is the mapping & Countryballs corner of VidTube. Off-topic uploads are reviewed by moderators.' : 'VidTube · a video platform by Lucas', h('br'), h('a', { href: href('/help') }, 'Guidelines'), ' · ', h('a', { href: href('/help#privacy') }, 'Privacy')));
    highlightNav();
  }
  const invalidateSubs = () => { subsCache = null; renderSidebar(); };
  function highlightNav() {
    let path = location.pathname; if (path.startsWith('/geotube')) path = path.slice(8) || '/';
    $$('#sidebar .nav-item').forEach(a => a.classList.toggle('active', a.dataset.path === path || (a.dataset.path === '/playlist?list=WL' && path === '/playlist' && location.search.includes('list=WL'))));
  }

  /* ---------- menus, modals, toasts ---------- */
  let openMenu = null;
  function closeMenus() { if (openMenu) { openMenu.remove(); openMenu = null; } }
  function menu(anchor, items, { align = 'right', head = null } = {}) {
    closeMenus();
    const m = h('div', { class: 'menu' });
    if (head) m.append(h('div', { class: 'head' }, head), h('div', { class: 'sep' }));
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { m.append(h('div', { class: 'sep' })); continue; }
      m.append(h('button', { class: 'item' + (it.danger ? ' danger' : ''), onclick: e => { e.stopPropagation(); closeMenus(); it.fn && it.fn(); } }, it.icon ? icon(it.icon) : null, h('span', { class: 'grow' }, it.label), it.right ? h('span', { class: 'dim small' }, it.right) : null));
    }
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let left = align === 'right' ? r.right - mw : r.left; left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    let top = r.bottom + 4; if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    m.style.left = left + 'px'; m.style.top = top + window.scrollY + 'px';
    openMenu = m;
    setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target)) { closeMenus(); document.removeEventListener('click', off); } }), 0);
    return m;
  }
  function modal({ title, body, foot, wide = false, onClose = null }) {
    closeModal();
    const ov = $('#overlay');
    const m = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-label': title },
      h('div', { class: 'm-head' }, h('h2', title), h('button', { class: 'btn icon', onclick: closeModal, 'aria-label': 'Close' }, icon('close'))),
      h('div', { class: 'm-body' }, body), foot ? h('div', { class: 'm-foot' }, foot) : null);
    ov.append(m);
    ov.onclick = e => { if (e.target === ov) closeModal(); };
    ov._onClose = onClose;
    const f = $('input, textarea, select, button.primary', m); if (f) setTimeout(() => f.focus(), 30);
    return m;
  }
  function closeModal() { const ov = $('#overlay'); if (ov._onClose) { const f = ov._onClose; ov._onClose = null; f(); } ov.innerHTML = ''; }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeMenus(); } });
  function confirm(title, text, { danger = false, ok = 'Confirm' } = {}) {
    return new Promise(resolve => {
      modal({ title, body: h('p', text), foot: [h('button', { class: 'btn', onclick: () => { closeModal(); resolve(false); } }, 'Cancel'), h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { closeModal(); resolve(true); } }, ok)], onClose: () => resolve(false) });
    });
  }
  function prompt(title, { label = '', value = '', multiline = false, ok = 'Save', placeholder = '' } = {}) {
    return new Promise(resolve => {
      const input = multiline ? h('textarea', { class: 'input', placeholder }) : h('input', { class: 'input', placeholder });
      input.value = value;
      const submit = () => { closeModal(); resolve(input.value); };
      if (!multiline) input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
      modal({ title, body: h('div', { class: 'field' }, label ? h('label', label) : null, input), foot: [h('button', { class: 'btn', onclick: () => { closeModal(); resolve(null); } }, 'Cancel'), h('button', { class: 'btn primary', onclick: submit }, ok)], onClose: () => resolve(null) });
    });
  }
  function toast(text, { bad = false, action = null, ms = 4000 } = {}) {
    const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, h('span', text), action ? h('button', { onclick: () => { t.remove(); action.fn(); } }, action.label) : null);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), ms);
  }
  const errToast = e => toast(e.message || String(e), { bad: true });

  /* ---------- account menu + notifications ---------- */
  function accountMenu(anchor) {
    const items = [];
    if (state.channel) items.push({ icon: 'users', label: 'Your channel', fn: () => navigate('/@' + state.channel.handle) }, { icon: 'studio', label: 'Studio', fn: () => navigate('/studio') });
    else items.push({ icon: 'studio', label: 'Create a channel', fn: () => navigate('/settings?tab=channel') });
    for (const m of state.managed) items.push({ icon: 'studio', label: 'Manage ' + m.name, fn: () => navigate('/studio?ch=' + m.id) });
    if (isMod()) items.push({ icon: 'admin', label: 'Moderation', fn: () => navigate('/admin') });
    items.push('-', { icon: (document.documentElement.dataset.theme || 'system') === 'dark' ? 'sun' : 'moon', label: 'Toggle theme', fn: toggleTheme }, { icon: 'settings', label: 'Settings', fn: () => navigate('/settings') }, { icon: 'help', label: 'Help', fn: () => navigate('/help') }, '-',
      { icon: 'logout', label: 'Sign out', fn: async () => { await post('/api/auth/logout'); subsCache = null; await loadMe(); navigate('/'); toast('Signed out'); } });
    menu(anchor, items, { head: h('div', { class: 'row' }, avatar(state.channel && state.channel.avatar, state.channel ? state.channel.name : state.user.email), h('div', h('b', state.channel ? state.channel.name : 'No channel yet'), h('div', { class: 'small muted' }, state.user.email))) });
  }
  async function notifPanel(anchor) {
    closeMenus();
    const m = h('div', { class: 'menu notif-panel' }, h('div', { class: 'row between', style: { padding: '8px 12px' } }, h('b', 'Notifications'), h('button', { class: 'btn xs', onclick: async () => { await post('/api/notifications/read', {}); state.unread = 0; renderTopbar(); load(); } }, 'Mark all read')), h('div', { class: 'sep' }), h('div', { class: 'spinner' }));
    document.body.append(m); openMenu = m;
    const r = anchor.getBoundingClientRect(); m.style.top = r.bottom + 4 + 'px'; m.style.right = Math.max(8, window.innerWidth - r.right) + 'px'; m.style.left = 'auto';
    setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target)) { closeMenus(); document.removeEventListener('click', off); } }), 0);
    async function load() {
      const d = await get('/api/notifications?limit=20');
      const list = h('div');
      if (!d.items.length) list.append(h('div', { class: 'empty' }, 'No notifications yet'));
      d.items.forEach(n => list.append(notifRow(n, () => load())));
      list.append(h('a', { class: 'item', href: href('/notifications'), style: { justifyContent: 'center' }, onclick: closeMenus }, 'See all'));
      m.replaceChildren(m.children[0], m.children[1], list);
    }
    load().catch(errToast);
  }
  function notifRow(n, onChange) {
    const t = { security: 'lock', moderation: 'admin', geotube_review: 'globe', upload: 'upload', comments: 'comment', replies: 'comment', subscriptions: 'subs', channel: 'users' }[n.type] || 'bell';
    return h('div', { class: 'notif' + (n.read ? '' : ' unread'), onclick: async () => {
      if (!n.read) { await post('/api/notifications/read', { ids: [n.id] }); state.unread = Math.max(0, state.unread - 1); renderTopbar(); }
      closeMenus(); if (n.link) navigate(n.link); else if (onChange) onChange();
    } }, icon(t), h('div', { class: 'grow' }, h('div', h('b', n.title)), n.body ? h('div', { class: 'small muted clamp2' }, n.body) : null, h('div', { class: 'small dim' }, ago(n.created_at))), n.read ? null : h('span', { class: 'dot' }));
  }

  /* ---------- shared video components ---------- */
  const watchUrl = (v, extra = '') => (v.platform === 'geotube' ? '/geotube' : '') + (v.is_short ? '/shorts?v=' : '/watch?v=') + v.id + extra;
  function vcard(v, { source = 'home', showChannel = true, onNotInterested = null, playlistId = null } = {}) {
    const url = watchUrl(v, source ? '&src=' + source : '') + (playlistId ? '&list=' + playlistId : '');
    const card = h('a', { class: 'vcard', href: url });
    const th = h('div', { class: 'thumb' + (v.is_short ? ' portrait' : '') }, v.thumb ? h('img', { src: fileUrl(v.thumb), alt: '', loading: 'lazy' }) : null, v.duration ? h('span', { class: 'dur' }, v.is_short ? 'SHORT' : fmtDur(v.duration)) : null,
      v.pct ? h('div', { class: 'bar' }, h('div', { style: { width: Math.round(v.pct * 100) + '%' } })) : null);
    card.append(th);
    const meta = h('div', { class: 'meta' }, showChannel ? h('a', { href: href('/@' + v.handle), onclick: e => e.stopPropagation() }, avatar(v.channel_avatar, v.channel_name)) : null,
      h('div', { class: 'grow' }, h('div', { class: 'title clamp2' }, v.title), showChannel ? h('div', { class: 'sub ellipsis' }, v.channel_name, v.is_verified ? icon('verified', 'verified') : null, badgeIcons(v.badges)) : null,
        h('div', { class: 'sub' }, fmtNum(v.views) + ' views', v.published_at ? ' · ' + ago(v.published_at) : '')));
    card.append(meta);
    card.append(h('button', { class: 'btn icon more', 'aria-label': 'More', onclick: e => { e.preventDefault(); e.stopPropagation(); videoMenu(e.currentTarget, v, { onNotInterested }); } }, icon('more')));
    return card;
  }
  function vrow(v, { compact = false, source = 'search', desc = false, extra = null, playlistId = null } = {}) {
    const url = watchUrl(v, '&src=' + source) + (playlistId ? '&list=' + playlistId : '');
    return h('a', { class: 'vrow' + (compact ? ' compact' : ''), href: url },
      h('div', { class: 'thumb' + (v.is_short ? ' portrait' : '') }, v.thumb ? h('img', { src: fileUrl(v.thumb), alt: '', loading: 'lazy' }) : null, v.duration ? h('span', { class: 'dur' }, fmtDur(v.duration)) : null, v.pct ? h('div', { class: 'bar' }, h('div', { style: { width: Math.round(v.pct * 100) + '%' } })) : null),
      h('div', { class: 'grow' }, h('div', { class: 'title clamp2' }, v.title), h('div', { class: 'small muted' }, fmtNum(v.views) + ' views · ' + ago(v.published_at)),
        h('div', { class: 'row small muted mt8' }, compact ? null : avatar(v.channel_avatar, v.channel_name, 'sm'), h('span', v.channel_name), v.is_verified ? icon('verified', 'verified') : null, badgeIcons(v.badges)),
        desc && v.description ? h('div', { class: 'desc clamp2' }, v.description) : null, extra),
      h('button', { class: 'btn icon', style: { alignSelf: 'flex-start' }, onclick: e => { e.preventDefault(); e.stopPropagation(); videoMenu(e.currentTarget, v); } }, icon('more')));
  }
  function videoMenu(anchor, v, { onNotInterested = null } = {}) {
    const items = [
      { icon: 'clock', label: 'Save to Watch later', fn: () => toggleWatchLater(v) },
      { icon: 'save', label: 'Save to playlist', fn: () => savePlaylistDialog(v) },
      { icon: 'share', label: 'Share', fn: () => shareDialog(location.origin + watchUrl(v), v.title) },
    ];
    if (onNotInterested) items.push({ icon: 'eyeoff', label: 'Not interested', fn: async () => { await post(`/api/videos/${v.id}/not-interested`); onNotInterested(); toast('Video hidden', { action: { label: 'Undo', fn: () => del(`/api/videos/${v.id}/not-interested`).then(() => render()) } }); } });
    items.push({ icon: 'flag', label: 'Report', fn: () => reportDialog('video', v.id, v.platform) });
    menu(anchor, items);
  }
  async function toggleWatchLater(v) {
    if (!requireLogin()) return;
    try {
      const lists = await get(`/api/playlists?video=${v.id}&platform=${v.platform}`);
      const wl = lists.find(p => p.watch_later);
      if (wl && wl.has_video) { await del(`/api/playlists/WL/items/${v.id}?platform=${v.platform}`); toast('Removed from Watch later'); }
      else { await post('/api/playlists/WL/items', { video_id: v.id, platform: v.platform }); toast('Saved to Watch later', { action: { label: 'View', fn: () => navigate('/playlist?list=WL') } }); }
    } catch (e) { errToast(e); }
  }
  async function savePlaylistDialog(v) {
    if (!requireLogin()) return;
    const lists = await get(`/api/playlists?video=${v.id}&platform=${v.platform}`);
    const body = h('div');
    const row = p => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p.has_video, onchange: async e => {
      try { if (e.target.checked) await post(`/api/playlists/${p.id}/items`, { video_id: v.id, platform: v.platform }); else await del(`/api/playlists/${p.id}/items/${v.id}?platform=${v.platform}`); toast(e.target.checked ? 'Added to ' + p.title : 'Removed from ' + p.title); } catch (err) { errToast(err); e.target.checked = !e.target.checked; }
    } }), h('div', h('b', p.title), h('span', p.watch_later ? 'Private' : p.visibility)));
    lists.forEach(p => body.append(row(p)));
    const newTitle = h('input', { class: 'input', placeholder: 'New playlist name' });
    const vis = h('select', { class: 'select' }, h('option', { value: 'private' }, 'Private'), h('option', { value: 'unlisted' }, 'Unlisted'), h('option', { value: 'public' }, 'Public'));
    body.append(h('div', { class: 'row mt16' }, newTitle, vis, h('button', { class: 'btn primary', onclick: async () => {
      if (!newTitle.value.trim()) return; try { const p = await post('/api/playlists', { title: newTitle.value.trim(), visibility: vis.value }); await post(`/api/playlists/${p.id}/items`, { video_id: v.id, platform: v.platform }); body.insertBefore(row({ ...p, has_video: true }), body.lastChild); newTitle.value = ''; toast('Playlist created'); } catch (e) { errToast(e); }
    } }, 'Create')));
    modal({ title: 'Save to...', body });
  }
  function shareDialog(url, title, { time = null } = {}) {
    const input = h('input', { class: 'input', value: url, readonly: true, onclick: e => e.target.select() });
    let withTime = false;
    const timeRow = time ? h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: e => { withTime = e.target.checked; input.value = url + (withTime ? (url.includes('?') ? '&' : '?') + 't=' + Math.floor(time()) : ''); } }), h('div', h('b', 'Start at ' + fmtDur(time())))) : null;
    const copy = () => { navigator.clipboard.writeText(input.value).then(() => toast('Link copied')); };
    const embed = `<iframe width="560" height="315" src="${url.replace('/watch?v=', '/watch?embed=1&v=')}" allowfullscreen></iframe>`;
    modal({ title: 'Share', body: h('div', h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: copy }, 'Copy')), timeRow,
      h('div', { class: 'row wrap mt16' }, h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', href: 'mailto:?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(url) }, icon('mail'), 'Email'),
        h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(title + ' ' + url) }, 'WhatsApp'),
        h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', href: 'https://x.com/intent/post?text=' + encodeURIComponent(title) + '&url=' + encodeURIComponent(url) }, 'X'),
        navigator.share ? h('button', { class: 'btn sm', onclick: () => navigator.share({ title, url: input.value }).catch(() => {}) }, 'More...') : null),
      h('details', { class: 'mt16' }, h('summary', { class: 'muted small' }, 'Embed code'), h('textarea', { class: 'input mt8', readonly: true, onclick: e => e.target.select() }, embed))) });
  }
  function reportDialog(targetType, targetId, platform) {
        const reasons = [['spam', 'Spam or misleading'], ['sexual', 'Sexual content'], ['violent', 'Violent or repulsive'], ['hateful', 'Hateful or abusive'], ['harassment', 'Harassment or bullying'], ['harmful', 'Harmful or dangerous acts'], ['misinformation', 'Misinformation'], ['child_safety', 'Child safety'], ['legal', 'Legal issue'], ['off_topic', platform === 'geotube' ? 'Not mapping / Countryballs content' : 'Off topic'], ['other', 'Something else']];
    const sel = h('select', { class: 'select' }, reasons.map(([v, l]) => h('option', { value: v }, l)));
    const details = h('textarea', { class: 'input', placeholder: 'Anything else moderators should know? (optional)' });
    modal({ title: 'Report ' + targetType, body: h('div', h('div', { class: 'field' }, h('label', 'Reason'), sel), h('div', { class: 'field' }, h('label', 'Details'), details), h('p', { class: 'small muted' }, state.user ? 'Reports are reviewed by moderators. Abusing the report system can lead to account restrictions.' : 'You are reporting anonymously. Reports are reviewed by moderators.')),
      foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => { try { await post('/api/reports', { target_type: targetType, target_id: String(targetId), platform, reason: sel.value, details: details.value }); closeModal(); toast('Thanks, your report was sent'); } catch (e) { errToast(e); } } }, 'Send report')] });
  }
  async function subscribeButton(ch, { onChange = null, videoId = null } = {}) {
    const wrap = h('span', { class: 'row' });
    const draw = () => {
      wrap.innerHTML = '';
      const me = ch.me || {};
      if (state.channel && state.channel.id === ch.id) { wrap.append(h('a', { class: 'btn outline', href: href('/studio/customize') }, 'Customise channel')); return; }
      if (me.subscribed) {
        wrap.append(h('button', { class: 'btn', onclick: e => menu(e.currentTarget, [
          { icon: 'bell', label: 'All notifications', right: me.sub_notify === 'all' ? '✓' : '', fn: () => setSub('all') },
          { icon: 'bell', label: 'Personalised', right: me.sub_notify === 'personalized' ? '✓' : '', fn: () => setSub('personalized') },
          { icon: 'mute', label: 'None', right: me.sub_notify === 'none' ? '✓' : '', fn: () => setSub('none') }, '-',
          { icon: 'close', label: 'Unsubscribe', fn: async () => { try { const r = await del(`/api/channels/${ch.id}/subscribe?platform=${state.platform}`); ch.me = { ...me, subscribed: false }; ch.subscribers = r.subscribers; draw(); invalidateSubs(); onChange && onChange(r); } catch (e) { errToast(e); } } },
        ]) }, icon(me.sub_notify === 'none' ? 'mute' : 'bell'), 'Subscribed', icon('chevd')));
      } else wrap.append(h('button', { class: 'btn primary', onclick: () => setSub('personalized') }, 'Subscribe'));
    };
    const setSub = async mode => {
      if (!requireLogin('Sign in to subscribe')) return;
      try { const r = await post(`/api/channels/${ch.id}/subscribe`, { notify: mode, platform: state.platform, video_id: videoId }); ch.me = { ...(ch.me || {}), subscribed: true, sub_notify: mode }; ch.subscribers = r.subscribers; draw(); invalidateSubs(); onChange && onChange(r); toast(mode === 'none' ? 'Notifications off' : 'Subscribed'); } catch (e) { errToast(e); }
    };
    draw();
    return wrap;
  }
  function chipsRow(items, active, onPick) {
    const row = h('div', { class: 'chips', role: 'tablist' });
    for (const it of items) row.append(h('button', { class: 'chip' + (it.value === active ? ' active' : ''), onclick: () => onPick(it.value) }, it.label));
    return row;
  }
  async function categories(platform = state.platform) {
    if (!state.cats[platform]) state.cats[platform] = await get('/api/categories?platform=' + platform);
    return state.cats[platform];
  }
  function pager(loadMore) {
    const btn = h('button', { class: 'btn outline', style: { margin: '24px auto', display: 'flex' }, onclick: async () => { btn.disabled = true; const more = await loadMore(); if (!more) btn.remove(); btn.disabled = false; } }, 'Show more');
    return btn;
  }
  function tabs(items, active, onPick) {
    const t = h('div', { class: 'tabs', role: 'tablist' });
    items.forEach(it => t.append(h('button', { class: 'tab' + (it.value === active ? ' active' : ''), role: 'tab', onclick: () => onPick(it.value) }, it.label, it.count ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, it.count) : null)));
    return t;
  }

  /* ---------- charts (inline SVG, single hue, hover tooltip) ---------- */
  function lineChart(series, { height = 220, keys = ['v'], labels = null, fmt = fmtNum, xkey = 'day', xfmt = d => d.slice(5) } = {}) {
    const W = 800, H = height, padL = 44, padR = 12, padT = 12, padB = 28;
    const wrap = h('div', { class: 'chart' });
    if (!series.length) { wrap.append(h('div', { class: 'empty' }, 'No data yet')); return wrap; }
    const max = Math.max(1, ...series.flatMap(d => keys.map(k => Number(d[k]) || 0)));
    const nice = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / nice) * nice;
    const x = i => padL + (series.length === 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (series.length - 1));
    const y = v => padT + (H - padT - padB) * (1 - v / top);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = top * i / 4; g += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-text" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`; }
    const step = Math.max(1, Math.ceil(series.length / 8));
    series.forEach((d, i) => { if (i % step === 0 || i === series.length - 1) g += `<text class="axis-text" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(xfmt(d[xkey]))}</text>`; });
    keys.forEach((k, ki) => {
      const pts = series.map((d, i) => `${x(i)},${y(Number(d[k]) || 0)}`).join(' ');
      if (ki === 0 && keys.length === 1) g += `<polygon class="area" points="${x(0)},${y(0)} ${pts} ${x(series.length - 1)},${y(0)}"/>`;
      g += `<polyline class="line${ki ? ' s2' : ''}" points="${pts}"/>`;
    });
    const svgEl = h('div', { html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}">${g}<line class="crosshair" x1="0" x2="0" y1="${padT}" y2="${H - padB}" style="display:none"/>${keys.map((k, ki) => `<circle class="dot${ki ? ' s2' : ''}" r="4" style="display:none"/>`).join('')}</svg>` }).firstChild;
    const tip = h('div', { class: 'tip', style: { display: 'none' } });
    if (labels && keys.length > 1) wrap.append(h('div', { class: 'legend' }, keys.map((k, i) => h('span', h('i', { class: i ? 's2' : '' }), labels[i]))));
    wrap.append(svgEl, tip);
    const cross = $('.crosshair', svgEl), dots = $$('.dot', svgEl);
    svgEl.addEventListener('mousemove', e => {
      const r = svgEl.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(series.length - 1, Math.round((px - padL) / ((W - padL - padR) / Math.max(1, series.length - 1)))));
      const d = series[i];
      cross.style.display = ''; cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
      dots.forEach((dot, ki) => { dot.style.display = ''; dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(Number(d[keys[ki]]) || 0)); });
      tip.style.display = ''; tip.style.left = (x(i) / W * r.width) + 'px'; tip.style.top = (y(Number(d[keys[0]]) || 0) / H * r.height) + 'px';
      tip.innerHTML = `<b>${esc(d[xkey])}</b>` + keys.map((k, ki) => `<div>${labels ? esc(labels[ki]) + ': ' : ''}${esc(fmt(Number(d[k]) || 0))}</div>`).join('');
    });
    svgEl.addEventListener('mouseleave', () => { cross.style.display = 'none'; dots.forEach(d => (d.style.display = 'none')); tip.style.display = 'none'; });
    return wrap;
  }
  function hbars(rows, { fmt = fmtNum, label = r => r.k, total = null } = {}) {
    const wrap = h('div', { class: 'hbars' });
    if (!rows.length) { wrap.append(h('div', { class: 'muted small' }, 'No data yet')); return wrap; }
    const max = Math.max(1, ...rows.map(r => Number(r.n) || 0));
    const sum = total || rows.reduce((a, r) => a + (Number(r.n) || 0), 0);
    rows.forEach(r => {
      const n = Number(r.n) || 0;
      const pct = sum ? ' · ' + Math.round(100 * n / sum) + '%' : '';
      wrap.append(h('div', { class: 'hb', title: label(r) + ': ' + fmtFull(n) },
        h('span', { class: 'ellipsis' }, label(r)),
        h('div', { class: 'track' }, h('div', { style: { width: (100 * n / max) + '%' } })),
        h('span', { class: 'n' }, fmt(n) + pct)));
    });
    return wrap;
  }
  /* ---------- pictures and GIFs in comments and posts ---------- */
  // Renders a stored attachment ({ kind, source, url, preview }) as an image.
  function mediaNode(a, cls = 'c-media') {
    if (!a || !a.url) return null;
    const img = h('img', { class: cls, src: a.url, alt: a.kind === 'gif' ? 'GIF' : 'Picture', loading: 'lazy' });
    return a.source === 'giphy' ? h('div', { class: 'media-wrap' }, img, h('span', { class: 'media-credit' }, 'via GIPHY')) : img;
  }
  // GIF dialog: a GIPHY search tab and, during the Halloween event, a "My GIFs" tab where you make
  // GIFs from videos yourself (unlocked after watching enough videos; usable only by your account).
  // Resolves with the chosen attachment or null. `video` is the video the composer belongs to, if any.
  function gifPicker({ video = null } = {}) {
    return new Promise(resolve => {
      let picked = false;
      const choose = a => { picked = true; closeModal(); resolve(a); };
      const ev = state.event || {};
      const showMine = !!state.user && (ev.active || (ev.gifs && ev.gifs.length));

      /* GIPHY tab */
      const q = h('input', { class: 'input', placeholder: 'Search GIFs (e.g. meme, happy, no)', autocomplete: 'off' });
      const grid = h('div', { class: 'gif-grid' });
      const status = h('div', { class: 'small muted mt8' });
      let timer = null, offset = 0, term = '', more = false, loaded = false;
      const load = async (reset) => {
        if (reset) { grid.innerHTML = ''; offset = 0; }
        status.textContent = 'Loading…';
        try {
          const d = await get(`/api/gifs/search?q=${encodeURIComponent(term)}&offset=${offset}`);
          offset = d.offset; more = d.items.length >= 24; loaded = true;
          d.items.forEach(g => grid.append(h('button', { class: 'gif-cell', title: g.title, onclick: () => choose({ source: 'giphy', url: g.url, preview: g.preview, width: g.width, height: g.height, title: g.title, kind: 'gif' }) }, h('img', { src: g.preview, alt: g.title, loading: 'lazy' }))));
          status.textContent = grid.children.length ? (term ? '' : 'Trending now') : 'No GIFs found.';
        } catch (e) { status.textContent = e.message; }
      };
      q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { term = q.value.trim(); load(true); }, 300); });
      const giphyPane = h('div', q, status, grid, h('div', { class: 'row mt8', style: { justifyContent: 'space-between' } }, h('span', { class: 'small dim' }, 'Powered by GIPHY'), h('button', { class: 'btn sm', onclick: () => { if (more) load(false); } }, 'More')));

      /* My GIFs tab (Halloween) */
      const minePane = h('div', { style: { display: 'none' } });
      const renderMine = async () => {
        minePane.innerHTML = '';
        let p = state.event;
        try { p = await get('/api/event/halloween'); state.event = p; } catch (e) { minePane.append(h('p', { class: 'muted' }, e.message)); return; }
        if (!p.active) {
          minePane.append(h('p', { class: 'muted' }, 'The Halloween event is over. GIFs you made are still yours to use.'));
          if (!p.gifs.length) return;
        } else if (!p.unlocked) {
          const pct = Math.min(100, Math.round(100 * p.watched / p.goal));
          minePane.append(h('div', { class: 'hw-lock' }, h('div', { class: 'hw-pumpkin' }, '🎃'), h('h3', 'Halloween event: make your own GIFs'),
            h('p', { class: 'muted' }, `Watch ${p.goal} videos or Shorts and the GIF maker unlocks by itself. GIFs you make can only be used by this account.`),
            h('div', { class: 'hw-bar' }, h('div', { class: 'hw-fill', style: { width: pct + '%' } })), h('div', { class: 'small' }, `${Math.min(p.watched, p.goal)} / ${p.goal} watched`)));
          return;
        } else {
          // Maker
          const sources = [];
          if (video) sources.push({ id: video.id, platform: video.platform, title: video.title, current: true });
          try { (await get('/api/history')).items.forEach(v => { if (!sources.find(s => s.id === v.id)) sources.push({ id: v.id, platform: v.platform, title: v.title }); }); } catch {}
          const sel = h('select', { class: 'select' }, sources.length ? sources.slice(0, 20).map(s => h('option', { value: s.id + '|' + s.platform }, (s.current ? 'This video: ' : '') + s.title)) : h('option', { value: '' }, 'Watch a video first'));
          const player = $('.watch video');
          const startIn = h('input', { class: 'input', type: 'number', min: 0, step: 0.5, value: player && video ? Math.max(0, Math.floor(player.currentTime * 2) / 2) : 0, style: { width: '110px' } });
          const lenSel = h('select', { class: 'select', style: { width: '90px' } }, [1, 2, 3, 4, 5, 6].map(n => h('option', { value: n, selected: n === 3 }, n + ' s')));
          const titleIn = h('input', { class: 'input', placeholder: 'Title (optional)', maxlength: 80 });
          const makeBtn = h('button', { class: 'btn primary sm', type: 'button' }, '🎃 Make GIF');
          const msg = h('span', { class: 'small muted' });
          makeBtn.onclick = async () => {
            const [vid, platform] = sel.value.split('|'); if (!vid) return;
            makeBtn.disabled = true; msg.textContent = 'Making your GIF… this takes a few seconds.';
            try {
              const g = await post('/api/event/halloween/gifs', { video_id: vid, platform, start: Number(startIn.value) || 0, duration: Number(lenSel.value) || 3, title: titleIn.value });
              state.event.gifs = [g, ...(state.event.gifs || [])];
              mine.prepend(cell(g)); msg.textContent = 'Done! Click it to use it.'; titleIn.value = '';
            } catch (e) { msg.textContent = e.message; }
            makeBtn.disabled = false;
          };
          minePane.append(h('div', { class: 'hw-maker' }, h('h3', '🎃 Make a GIF from a video'),
            h('div', { class: 'field' }, h('label', 'Video'), sel),
            h('div', { class: 'row wrap', style: { alignItems: 'flex-end' } }, h('div', { class: 'field' }, h('label', 'Start (seconds)'), startIn), h('div', { class: 'field' }, h('label', 'Length'), lenSel), h('div', { class: 'field grow' }, h('label', 'Title'), titleIn)),
            h('div', { class: 'row wrap' }, makeBtn, msg)));
        }
        const mine = h('div', { class: 'gif-grid' });
        const cell = g => {
          const c = h('div', { class: 'gif-cell mine' }, h('button', { class: 'pick', title: g.title, type: 'button', onclick: () => choose({ source: 'mygif', id: g.id, url: g.url, preview: g.preview, title: g.title, kind: 'gif' }) }, h('img', { src: g.url, alt: g.title, loading: 'lazy' })),
            h('button', { class: 'rm', type: 'button', title: 'Delete', onclick: async () => { if (!await confirm('Delete this GIF?')) return; try { await del('/api/event/halloween/gifs/' + g.id); c.remove(); state.event.gifs = (state.event.gifs || []).filter(x => x.id !== g.id); } catch (e) { errToast(e); } } }, icon('close')));
          return c;
        };
        (p.gifs || []).forEach(g => mine.append(cell(g)));
        const empty = h('p', { class: 'muted', style: { display: p.gifs.length ? 'none' : '' } }, 'No GIFs yet. Make one above.');
        new MutationObserver(() => { empty.style.display = mine.children.length ? 'none' : ''; }).observe(mine, { childList: true });
        minePane.append(h('h3', { class: 'mt16' }, 'My GIFs'), h('p', { class: 'small muted' }, 'Only you can use these. Click one to add it. You can also turn any GIF into a video or Short in ', h('a', { class: 'hash', href: href('/studio/upload'), onclick: () => closeModal() }, 'Studio → Upload'), '.'), empty, mine);
      };

      const tabG = h('button', { class: 'tab active', type: 'button' }, 'Search GIPHY');
      const tabM = h('button', { class: 'tab', type: 'button' }, '🎃 My GIFs');
      const show = which => { tabG.classList.toggle('active', which === 'g'); tabM.classList.toggle('active', which === 'm'); giphyPane.style.display = which === 'g' ? '' : 'none'; minePane.style.display = which === 'm' ? '' : 'none'; if (which === 'g' && !loaded) load(true); if (which === 'm') renderMine(); };
      tabG.onclick = () => show('g'); tabM.onclick = () => show('m');
      const body = h('div', showMine ? h('div', { class: 'tabs' }, tabG, tabM) : null, giphyPane, minePane);
      modal({ title: 'Add a GIF', body, wide: true, onClose: () => { if (!picked) resolve(null); } });
      show(showMine && state.event && state.event.unlocked && video ? 'm' : 'g');
    });
  }
  // Picture / GIF controls for a composer. Returns { node, get(), clear() } where get() is the attachment list to send.
  function attachmentPicker({ max = 1, kind = 'comment', video = null } = {}) {
    const items = [];
    const previews = h('div', { class: 'attach-list' });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: max > 1, style: { display: 'none' } });
    const draw = () => {
      previews.innerHTML = '';
      items.forEach((a, i) => previews.append(h('div', { class: 'attach-preview' }, h('img', { src: a.preview || a.url, alt: '' }), h('button', { class: 'rm', type: 'button', 'aria-label': 'Remove', onclick: () => { items.splice(i, 1); draw(); } }, icon('close')))));
      gifB.disabled = picB.disabled = items.length >= max;
    };
    const add = a => { if (items.length >= max) return; items.push(a); draw(); };
    file.addEventListener('change', async () => {
      for (const f of [...file.files].slice(0, max - items.length)) {
        if (f.size > 5 * 1048576) { toast(f.name + ' is larger than 5 MB', { bad: true }); continue; }
        try { const r = await upload(`/api/uploads/image?kind=${kind}`, f); add({ source: 'upload', file: r.file, url: r.url, preview: r.url, kind: r.kind }); }
        catch (e) { errToast(e); }
      }
      file.value = '';
    });
    const gifB = h('button', { class: 'btn sm', type: 'button', title: 'Add a GIF from GIPHY', onclick: async () => { const g = await gifPicker({ video }); if (g) add(g); } }, h('b', 'GIF'));
    const picB = h('button', { class: 'btn sm', type: 'button', title: max > 1 ? 'Add pictures or GIFs' : 'Add a picture or GIF', onclick: () => file.click() }, icon('upload'), max > 1 ? 'Photo / GIF' : 'Photo');
    const node = h('div', previews, h('div', { class: 'row attach-bar' }, gifB, picB, file));
    return { node, buttons: [gifB, picB], get: () => items.map(a => (a.source === 'giphy' ? { source: 'giphy', url: a.url, preview: a.preview, width: a.width, height: a.height, title: a.title } : a.source === 'mygif' ? { source: 'mygif', id: a.id } : { source: 'upload', file: a.file })), clear: () => { items.length = 0; draw(); }, count: () => items.length };
  }

  // Special badges next to a name: small pictures with a tooltip (see public/img/badges/).
  const BADGE_INFO = { owner: 'VidTube Owner · the owner of VidTube', moderator: 'VidTube Moderator · community staff' };
  function badgeIcons(list) {
    if (!list || !list.length) return null;
    return list.filter(b => BADGE_INFO[b]).map(b => h('img', { class: 'badge badge-' + b, src: `/img/badges/${b}.png`, alt: BADGE_INFO[b].split(' · ')[0], title: BADGE_INFO[b] }));
  }
  // Asks the browser to install VidTube as an app. Returns 'accepted', 'dismissed' or null (no prompt available).
  async function installApp() {
    const p = state.installPrompt;
    if (!p) return null;
    p.prompt();
    const r = await p.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (r.outcome === 'accepted') state.installPrompt = null;
    return r.outcome;
  }
  /* ---------- house ads ---------- */
  // Fetches the ads for a page. The last banner shown is remembered so the next page gets another one.
  async function fetchAds(place) {
    let last = ''; try { last = sessionStorage.getItem('vt_last_ad') || ''; } catch {}
    const d = await get(`/api/ads?place=${place}&exclude=${encodeURIComponent(last)}`);
    if (d.banner) { try { sessionStorage.setItem('vt_last_ad', d.banner.id); } catch {} }
    return d;
  }
  const adClick = a => post(`/api/ads/${a.id}/click`).catch(() => {});
  function adCard(a, cls = '') {
    return h('a', { class: 'ad-card ' + cls, href: a.url, target: '_blank', rel: 'noopener nofollow sponsored', onclick: () => adClick(a) },
      h('img', { src: a.avatar, alt: '' }), h('div', { class: 'grow' }, h('div', { class: 'small dim' }, 'Ad · ' + (a.platform || 'YouTube') + (a.platform === 'TikTok' ? ' account' : ' channel')), h('b', a.name), h('div', { class: 'small muted' }, a.tagline), a.subscribers ? h('div', { class: 'small dim' }, a.subscribers) : null),
      h('span', { class: 'btn sm primary' }, 'Watch on ' + (a.platform || 'YouTube')));
  }
  // A banner ad slot: returns a node that fills itself (or stays empty when ads are off).
  function adBanner(place = 'feed', cls = '') {
    const slot = h('div', { class: 'ad-slot' });
    fetchAds(place).then(d => { if (d.banner) slot.append(adCard(d.banner, cls)); }).catch(() => {});
    return slot;
  }
  // Pre-roll: covers the player with one channel for `seconds`, then calls onDone (which starts the video).
  function prerollAd(pw, a, seconds, onDone) {
    let left = seconds;
    const count = h('b', String(left));
    const ov = h('div', { class: 'overlay-msg ad-overlay' },
      h('div', { class: 'small dim' }, 'Ad · the video starts in ', count, ' s'),
      h('img', { src: a.avatar, alt: '' }), h('h3', a.name), h('p', a.tagline),
      h('a', { class: 'btn primary', href: a.url, target: '_blank', rel: 'noopener nofollow sponsored', onclick: () => adClick(a) }, 'Visit ' + a.handle + ' on ' + (a.platform || 'YouTube')));
    pw.append(ov);
    const iv = setInterval(() => { left--; count.textContent = String(Math.max(0, left)); if (left <= 0) { clearInterval(iv); ov.remove(); onDone(); } }, 1000);
    return () => { clearInterval(iv); ov.remove(); };
  }
  function statTile(label, value, { delta = null, sub = null, onclick = null, active = false } = {}) {
    const t = h('div', { class: 'stat' + (onclick ? ' clickable' : '') + (active ? ' active' : ''), onclick }, h('div', { class: 'l' }, label), h('div', { class: 'v' }, value), sub ? h('div', { class: 'd muted' }, sub) : null);
    if (delta !== null && delta !== undefined && isFinite(delta)) t.append(h('div', { class: 'd ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '') }, (delta > 0 ? '▲ ' : delta < 0 ? '▼ ' : '') + Math.abs(Math.round(delta)) + '% vs previous period'));
    return t;
  }

  /* ---------- start ---------- */
  async function start() {
    const nojs = document.getElementById('nojs'); if (nojs) nojs.remove();
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    if (localStorage.getItem('vt_mini') === '1') document.body.classList.add('mini');
    applyTheme();
    state.autoplay = localStorage.getItem('vt_autoplay') !== '0';
    // Installable app: the browser offers "Install VidTube"; we keep the prompt for the Download page / sidebar.
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    state.installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt = e; renderSidebar(); emit('install'); });
    window.addEventListener('appinstalled', () => { state.installPrompt = null; state.installed = true; renderSidebar(); emit('install'); toast('VidTube is installed on this computer'); });
    try { await loadMe(); } catch (e) { renderTopbar(); renderSidebar(); }
    await render();
    if (state.user && state.prefs && !state.prefs.onboarded && VT.onboarding) VT.onboarding();
  }

  return { state, h, $, $$, icon, I, api, get, post, patch, put, del, upload, eventViewCounted, gifPicker, badgeIcons, installApp, fetchAds, adBanner, adCard, prerollAd, fmtNum, fmtFull, fmtDur, fmtHours, ago, fmtDate, fmtDateTime, esc, fileUrl, platformName,
    loadMe, setMe, isMod, isAdmin, requireLogin, on, emit, route, href, navigate, render, menu, closeMenus, modal, closeModal, confirm, prompt, toast, errToast,
    avatar, vcard, vrow, videoMenu, watchUrl, toggleWatchLater, savePlaylistDialog, shareDialog, reportDialog, subscribeButton, chipsRow, categories, pager, tabs,
    lineChart, hbars, statTile, notifRow, mediaNode, gifPicker, attachmentPicker, invalidateSubs, renderSidebar, renderTopbar, toggleTheme, start };
})();
document.addEventListener("DOMContentLoaded", () => VT.start());
