/* Viewer pages: home, shorts, watch, search, channels, library, settings, auth. */
'use strict';
(() => {
  const { h, $, $$, icon, get, post, patch, del, fmtNum, fmtFull, fmtDur, ago, fmtDate, fmtDateTime, esc, fileUrl, platformName, state, href, navigate, route, modal, closeModal, confirm, prompt, toast, errToast,
    avatar, vcard, vrow, videoMenu, watchUrl, toggleWatchLater, savePlaylistDialog, shareDialog, reportDialog, subscribeButton, chipsRow, categories, pager, tabs, requireLogin, menu } = VT;

  const title = t => h('h1', { class: 'mb16' }, t);
  const section = (t, ...kids) => h('section', { class: 'shelf' }, h('h2', t), ...kids);

  /* ---------- home / trending / subscriptions ---------- */
  // Halloween event banner: progress towards the GIF maker, or how to use it once unlocked.
  function halloweenBanner() {
    const ev = state.event;
    const pct = Math.min(100, Math.round(100 * ev.watched / ev.goal));
    const text = !state.user ? h('span', h('a', { href: href('/login'), class: 'hash' }, 'Sign in'), ` and watch ${ev.goal} videos or Shorts to unlock your own GIF maker.`)
      : ev.unlocked ? h('span', 'Your GIF maker is unlocked! Press ', h('b', 'GIF'), ' under any comment (or in a post) and open the ', h('b', 'My GIFs'), ' tab to turn a piece of a video into a GIF. Only your account can use them.')
      : h('span', `Watch ${ev.goal} videos or Shorts and you unlock your own GIF maker. `, h('b', `${Math.min(ev.watched, ev.goal)} / ${ev.goal}`));
    return h('div', { class: 'notice hw-banner' }, h('div', { class: 'row', style: { gap: '12px', alignItems: 'flex-start' } }, h('div', { class: 'hw-pumpkin' }, '🎃'), h('div', { class: 'grow' }, h('b', 'Halloween event'), h('div', { class: 'small' }, text), state.user && !ev.unlocked ? h('div', { class: 'hw-bar mt8' }, h('div', { class: 'hw-fill', style: { width: pct + '%' } })) : null)));
  }
  async function feedPage(ctx, tab) {
    const geo = ctx.platform === 'geotube';
    const cats = await categories(ctx.platform);
    const cat = ctx.query.cat || 'all';
    const wrap = h('div');
    const chipItems = [{ value: 'all', label: 'All' }];
    if (geo) chipItems.push({ value: 'mapping', label: 'Mapping' }, { value: 'countryballs', label: 'Countryballs' });
    cats.forEach(c => { if (!(geo && (c.slug === 'mapping' || c.slug === 'countryballs'))) chipItems.push({ value: c.slug, label: c.name }); });
    wrap.append(chipsRow(chipItems, cat, v => navigate(tab === 'home' ? (v === 'all' ? '/' : '/?cat=' + v) : `/${tab}${v === 'all' ? '' : '?cat=' + v}`)));
    if (tab === 'home' && geo && !state.user) wrap.append(h('div', { class: 'notice accent' }, h('b', 'Welcome to GeoTube. '), 'The corner of VidTube for mapping, alternate history and Countryballs. Every upload here is checked to keep the feed on topic.'));
    if (tab === 'home' && state.event && state.event.active) wrap.append(halloweenBanner());
    wrap.append(VT.adBanner('feed'));
    const grid = h('div', { class: 'grid' });
    let page = 0;
    const load = async () => {
      const d = await get(`/api/feed?platform=${ctx.platform}&tab=${tab}&cat=${cat}&page=${page}`);
      if (page === 0 && d.shorts && d.shorts.length) {
        const sh = h('div', { class: 'grid shorts-grid' }, d.shorts.map(v => vcard(v, { source: 'home' })));
        wrap.append(section([icon('shorts'), ' Shorts'], sh));
      }
      d.items.forEach(v => grid.append(vcard(v, { source: tab === 'home' ? 'home' : tab, onNotInterested: () => VT.render() })));
      if (page === 0 && !d.items.length) grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, h('h3', tab === 'subscriptions' ? 'No videos from your subscriptions yet' : 'Nothing here yet'), h('p', tab === 'subscriptions' ? 'Subscribe to channels to see their latest uploads here.' : geo ? 'Be the first to upload a mapping or Countryballs video.' : 'Be the first to upload a video.')));
      page++;
      return d.more;
    };
    const more = await load();
    wrap.append(section(tab === 'home' ? (geo ? 'Recommended on GeoTube' : 'Recommended') : tab === 'trending' ? 'Trending this week' : 'Latest from your subscriptions', grid));
    if (more) wrap.append(pager(load));
    return wrap;
  }
  route('/', ctx => feedPage(ctx, 'home'));
  route('/trending', ctx => feedPage(ctx, 'trending'));
  route('/subscriptions', async ctx => {
    if (!state.user) return h('div', { class: 'empty' }, h('h3', 'Keep up with your favourite channels'), h('p', 'Sign in to see new videos from the channels you subscribe to.'), h('a', { class: 'btn primary', href: href('/login') }, 'Sign in'));
    const wrap = h('div');
    const subs = await get('/api/subscriptions?platform=' + ctx.platform);
    if (subs.length) wrap.append(h('div', { class: 'chips' }, subs.map(s => h('a', { class: 'chip row', href: href('/@' + s.handle) }, avatar(s.avatar, s.name, 'sm'), s.name))));
    wrap.append(await feedPage(ctx, 'subscriptions'));
    return wrap;
  });

  /* ---------- download / install the app ---------- */
  route('/download', ctx => {
    document.title = 'Get the VidTube app';
    const isEdge = /Edg\//.test(navigator.userAgent), isChrome = /Chrome\//.test(navigator.userAgent) && !isEdge;
    const status = h('p', { class: 'muted' });
    const btn = h('button', { class: 'btn primary', onclick: async () => {
      const r = await VT.installApp();
      if (r === null) status.textContent = 'Your browser did not offer the install prompt here. Use the menu steps below instead.';
      else if (r === 'accepted') status.textContent = 'Installing… VidTube will appear on your desktop and in the Start menu.';
      else status.textContent = 'Install cancelled. You can try again any time.';
    } }, icon('download'), ' Install VidTube on this computer');
    const draw = () => {
      if (state.installed) { btn.style.display = 'none'; status.textContent = 'VidTube is already installed on this computer. You are using the app right now.'; }
      else if (state.installPrompt) { btn.style.display = ''; status.textContent = 'Click the button: VidTube opens in its own window, with a shortcut on your desktop and in the Start menu.'; }
      else { btn.style.display = ''; status.textContent = isChrome || isEdge ? 'If the button does nothing, use the steps below.' : 'Your browser may not support installing apps. Chrome or Edge do.'; }
    };
    draw(); VT.on('install', draw);
    const steps = isEdge
      ? ['Open the ⋯ menu at the top right of Edge.', 'Choose Apps → Install this site as an app.', 'Confirm with Install.']
      : ['Click the install icon at the right end of the address bar (a small monitor with an arrow), or open the ⋮ menu.', 'Choose Cast, save and share → Install page as app… (older Chrome: Install VidTube…).', 'Confirm with Install.'];
    return h('div', { class: 'card', style: { maxWidth: '720px' } },
      h('div', { class: 'row', style: { gap: '16px', alignItems: 'center' } }, h('img', { src: '/img/icon-192.png', alt: '', style: { width: '72px', height: '72px', borderRadius: '18px' } }), h('div', h('h1', 'Get the VidTube app'), h('p', { class: 'muted' }, 'Install VidTube on your computer: it gets its own window and icon, opens from the desktop or Start menu, and stays exactly in sync with the website because it is the same VidTube.'))),
      h('div', { class: 'mt16' }, btn), status,
      h('h3', { class: 'mt16' }, 'Install by hand'), h('ol', { style: { lineHeight: '1.8' } }, steps.map(s => h('li', s))),
      h('h3', { class: 'mt16' }, 'Good to know'), h('ul', { style: { lineHeight: '1.8' } },
        h('li', 'The app needs the VidTube server to be running (start.cmd in the VidTube folder). If it is not, the app shows a message and a "Try again" button.'),
        h('li', 'Uninstall it like any app: Windows Settings → Apps, or right-click the icon in the Start menu.'),
        h('li', 'Everything you do in the app (watching, uploading, comments) is the same account and data as on the website.')));
  });

  /* ---------- shorts ---------- */
  route('/shorts', async ctx => {
    document.body.classList.add('mini');
    ctx.cleanup = () => { if (localStorage.getItem('vt_mini') !== '1') document.body.classList.remove('mini'); };
    const feed = h('div', { class: 'shorts-feed' });
    let items = [];
    if (ctx.query.v) { try { const v = await get(`/api/videos/${ctx.query.v}?platform=${ctx.platform}`); items.push({ ...v, channel_name: v.channel.name, channel_avatar: v.channel.avatar, handle: v.channel.handle, duration: v.asset.duration, is_short: true, _full: v }); } catch (e) { errToast(e); } }
    const d = await get(`/api/feed?platform=${ctx.platform}&tab=shorts&limit=30`);
    d.items.forEach(v => { if (!items.find(x => x.id === v.id)) items.push(v); });
    if (!items.length) return h('div', { class: 'empty' }, h('h3', 'No Shorts yet'), h('p', 'Vertical videos under 60 seconds appear here.'));
    let muted = localStorage.getItem('vt_shorts_muted') === '1';
    const nodes = items.map(v => shortNode(v));
    feed.append(...nodes);
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        const vid = $('video', en.target);
        if (!vid) return;
        if (en.isIntersecting && en.intersectionRatio > 0.6) {
          // Every time a Short comes on screen it starts from the beginning and counts as a view.
          const id = en.target.dataset.id;
          vid.muted = muted;
          if (!vid.src) loadShort(en.target); else { try { vid.currentTime = 0; } catch {} vid.play().catch(() => {}); }
          const v = items.find(x => x.id === id);
          if (v) post(`/api/videos/${v.id}/view`, { platform: v.platform, source: 'shorts', start: true }).then(r => { if (r && r.counted) VT.eventViewCounted(); }).catch(() => {});
          history.replaceState({}, '', href('/shorts?v=' + id));
        } else { vid.pause(); try { vid.currentTime = 0; } catch {} }
      });
    }, { root: feed, threshold: [0.6] });
    nodes.forEach(n => io.observe(n));
    ctx.cleanup = (() => { const c = ctx.cleanup; return () => { io.disconnect(); c(); }; })();
    function shortNode(v) {
      const vid = h('video', { loop: true, playsinline: true, preload: 'none', onclick: () => (vid.paused ? vid.play() : vid.pause()) });
      const likeBtn = h('button', { class: 'btn icon', onclick: async () => { if (!requireLogin('Sign in to like')) return; try { const r = await post(`/api/videos/${v.id}/react`, { platform: v.platform, value: likeBtn.classList.contains('active') ? 0 : 1 }); likeBtn.classList.toggle('active', r.value === 1); $('span', likeBtn.parentNode).textContent = fmtNum(r.likes); } catch (e) { errToast(e); } } }, icon('like'));
      const muteBtn = h('button', { class: 'btn icon mute', onclick: () => { muted = !muted; localStorage.setItem('vt_shorts_muted', muted ? '1' : '0'); $$('.short video').forEach(x => (x.muted = muted)); muteBtn.innerHTML = ''; muteBtn.append(icon(muted ? 'mute' : 'sound')); } }, icon(muted ? 'mute' : 'sound'));
      return h('div', { class: 'short', dataset: { id: v.id } },
        h('div', { class: 'frame' }, vid, muteBtn, h('div', { class: 'info' }, h('div', { class: 'row' }, h('a', { href: href('/@' + v.handle) }, avatar(v.channel_avatar, v.channel_name, 'sm')), h('a', { href: href('/@' + v.handle) }, h('b', v.channel_name))), h('div', { class: 'clamp2 mt8' }, v.title))),
        h('div', { class: 'side' }, h('div', likeBtn, h('span', fmtNum(v.likes))),
          h('div', h('button', { class: 'btn icon', onclick: () => navigate('/watch?v=' + v.id + '&src=shorts') }, icon('comment')), h('span', fmtNum(v.comment_count || 0))),
          h('div', h('button', { class: 'btn icon', onclick: () => shareDialog(location.origin + watchUrl({ ...v, is_short: true }), v.title) }, icon('share')), h('span', 'Share')),
          h('div', h('button', { class: 'btn icon', onclick: e => videoMenu(e.currentTarget, v) }, icon('more')))));
    }
    async function loadShort(node) {
      const v = items.find(x => x.id === node.dataset.id);
      try {
        const full = v._full || await get(`/api/videos/${v.id}?platform=${v.platform}`);
        const vid = $('video', node); vid.src = full.asset.qualities[0].url; vid.poster = fileUrl(full.thumb) || ''; vid.muted = muted; vid.play().catch(() => {});
        if (full.me && full.me.reaction === 1) $('.side .btn', node).classList.add('active');
      } catch (e) { errToast(e); }
    }
    return feed;
  });

  /* ---------- watch ---------- */
  route('/watch', async ctx => {
    const id = ctx.query.v;
    if (!id) return h('div', { class: 'empty' }, 'No video selected');
    const embed = ctx.query.embed === '1';
    if (embed) { document.body.classList.add('embed'); ctx.cleanup = () => document.body.classList.remove('embed'); }
    const v = await get(`/api/videos/${id}?platform=${ctx.platform}`);
    document.title = `${v.title} - ${platformName(ctx.platform)}`;
    const ads = ctx.query.embed === '1' ? null : await VT.fetchAds('watch').catch(() => null);
    const playlistId = ctx.query.list || null;
    let playlist = null;
    if (playlistId) { try { playlist = await get(`/api/playlists/${playlistId}`); } catch {} }
    const wrap = h('div', { class: 'watch' + (localStorage.getItem('vt_theater') === '1' ? ' theater' : '') });
    const left = h('div'), right = h('div');
    wrap.append(left, right);

    /* player */
    const video = h('video', { controls: true, playsinline: true, preload: 'auto', autoplay: true, poster: fileUrl(v.thumb) || '' });
    const pw = h('div', { class: 'player-wrap' }, video);
    const q = v.asset.qualities;
    let qi = 0;
    const setQuality = i => { const t = video.currentTime, playing = !video.paused; qi = i; video.src = q[i].url; video.currentTime = t; if (playing) video.play().catch(() => {}); };
    if (v.asset.status !== 'ready') pw.append(h('div', { class: 'overlay-msg' }, h('h3', v.asset.status === 'failed' ? 'Processing failed' : 'This video is still processing'), h('p', v.asset.status === 'failed' ? (v.asset.error || 'The file could not be processed.') : 'Check back in a few minutes.')));
    else if (!q.length) pw.append(h('div', { class: 'overlay-msg' }, 'No playable file'));
    else video.src = q[0].url;
    if (v.captions) video.append(h('track', { kind: 'subtitles', src: fileUrl(v.captions), srclang: 'en', label: 'Captions', default: localStorage.getItem('vt_cc') === '1' }));
    if (v.watermark) pw.append(h('img', { class: 'wm', src: fileUrl(v.watermark), alt: '' }));
    if (v.status === 'restricted' && !sessionStorage.getItem('vt_restricted_' + v.id)) {
      const ov = h('div', { class: 'overlay-msg' }, h('h3', 'This video may not be suitable for everyone'), h('p', 'A moderator restricted it. It is not recommended and does not appear in search.'), h('button', { class: 'btn primary', onclick: () => { ov.remove(); sessionStorage.setItem('vt_restricted_' + v.id, '1'); video.play().catch(() => {}); } }, 'Watch anyway'));
      pw.append(ov);
    }
    // Pre-roll ad (sometimes, never in Shorts): the player is covered for 5-10 s, then the video starts.
    let stopPreroll = null;
    if (ads && ads.preroll && !$('.overlay-msg', pw)) {
      const startAfterAd = () => { stopPreroll = null; video.play().catch(() => {}); };
      stopPreroll = VT.prerollAd(pw, ads.preroll, ads.seconds, startAfterAd);
      video.addEventListener('play', () => { if (stopPreroll) video.pause(); });
    }
    // Autoplay: start as soon as the video can play. If the browser refuses (no interaction yet),
    // the first click or key press starts it.
    if (!$('.overlay-msg', pw)) {
      const tryPlay = () => video.play().catch(() => {
        const kick = () => { video.play().catch(() => {}); document.removeEventListener('pointerdown', kick); document.removeEventListener('keydown', kick); };
        document.addEventListener('pointerdown', kick, { once: true });
        document.addEventListener('keydown', kick, { once: true });
      });
      if (video.readyState >= 3) tryPlay(); else video.addEventListener('canplay', tryPlay, { once: true });
    }
    const startAt = Number(ctx.query.t) || (v.me && v.me.resume > 5 && v.me.resume < v.asset.duration - 10 ? v.me.resume : 0);
    if (startAt) video.addEventListener('loadedmetadata', () => { video.currentTime = startAt; }, { once: true });
    video.playbackRate = Number(localStorage.getItem('vt_speed')) || 1;
    // View + watch-time beacons. The view is registered the moment the video starts playing;
    // later beacons only add watch time and the resume position.
    let watched = 0, lastTick = 0, viewSent = false, timer = null;
    const beacon = (final = false) => {
      const delta = Math.round(watched); watched = 0;
      if (!viewSent && final) return;
      const start = !viewSent;
      viewSent = true;
      const dur = video.duration || v.asset.duration || 1;
      const body = JSON.stringify({ platform: v.platform, position: video.currentTime, delta, decile: Math.min(9, Math.floor(10 * video.currentTime / dur)), source: ctx.query.src || (document.referrer ? 'external' : 'direct'), start });
      if (final && navigator.sendBeacon) navigator.sendBeacon(`/api/videos/${v.id}/view`, new Blob([body], { type: 'application/json' }));
      else fetch(`/api/videos/${v.id}/view`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
        .then(r => r.ok ? r.json() : null)
        .then(r => { const el = r && r.counted && $('.view-count', wrap); if (el) { v.views = r.views; el.textContent = fmtFull(r.views) + ' views'; } if (r && r.counted) VT.eventViewCounted(); })
        .catch(() => {});
    };
    video.addEventListener('timeupdate', () => { const t = video.currentTime; if (lastTick && t > lastTick && t - lastTick < 2) watched += t - lastTick; lastTick = t; });
    video.addEventListener('play', () => { if (!viewSent) beacon(); clearInterval(timer); timer = setInterval(beacon, 10000); });
    video.addEventListener('ended', () => { viewSent = false; }); // playing it again is a new view
    video.addEventListener('pause', () => { clearInterval(timer); beacon(); });
    const onLeave = () => beacon(true);
    window.addEventListener('pagehide', onLeave);
    ctx.cleanup = (() => { const c = ctx.cleanup; return () => { if (stopPreroll) stopPreroll(); clearInterval(timer); beacon(true); window.removeEventListener('pagehide', onLeave); document.removeEventListener('keydown', keys); video.pause(); video.removeAttribute('src'); c && c(); }; })();
    // Autoplay next.
    const nextVideo = () => {
      if (playlist) { const i = playlist.items.findIndex(x => x.id === v.id); return playlist.items[i + 1] || null; }
      return state.autoplay ? (v.related[0] || null) : null;
    };
    video.addEventListener('ended', () => {
      const n = nextVideo(); if (!n || embed) return;
      let s = 5;
      const cnt = h('b', s);
      const ov = h('div', { class: 'next-up' }, h('div', { class: 'muted' }, 'Up next'), h('h3', n.title), h('div', 'Playing in ', cnt, ' seconds'), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { clearInterval(iv); ov.remove(); } }, 'Cancel'), h('button', { class: 'btn primary', onclick: go }, 'Play now')));
      function go() { clearInterval(iv); navigate(watchUrl(n, '&src=suggested') + (playlist ? '&list=' + playlist.id : '')); }
      const iv = setInterval(() => { if (--s <= 0) go(); cnt.textContent = s; }, 1000);
      pw.append(ov);
    });
    // Keyboard shortcuts.
    const keys = e => {
      if (/input|textarea|select/i.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const map = { ' ': () => (video.paused ? video.play() : video.pause()), k: () => (video.paused ? video.play() : video.pause()), j: () => (video.currentTime -= 10), l: () => (video.currentTime += 10),
        arrowleft: () => (video.currentTime -= 5), arrowright: () => (video.currentTime += 5), f: () => (document.fullscreenElement ? document.exitFullscreen() : pw.requestFullscreen()), m: () => (video.muted = !video.muted),
        t: toggleTheater, c: () => { const tr = video.textTracks[0]; if (tr) { tr.mode = tr.mode === 'showing' ? 'hidden' : 'showing'; localStorage.setItem('vt_cc', tr.mode === 'showing' ? '1' : '0'); } },
        '>': () => setSpeed(Math.min(2, video.playbackRate + 0.25)), '<': () => setSpeed(Math.max(0.25, video.playbackRate - 0.25)) };
      if (/^[0-9]$/.test(k)) { video.currentTime = video.duration * Number(k) / 10; e.preventDefault(); return; }
      if (map[k]) { map[k](); e.preventDefault(); }
    };
    document.addEventListener('keydown', keys);
    const setSpeed = s => { video.playbackRate = s; localStorage.setItem('vt_speed', s); speedBtn.lastChild.textContent = s + '×'; };
    function toggleTheater() { wrap.classList.toggle('theater'); localStorage.setItem('vt_theater', wrap.classList.contains('theater') ? '1' : '0'); }
    const speedBtn = h('button', { class: 'btn xs', onclick: e => menu(e.currentTarget, [0.5, 0.75, 1, 1.25, 1.5, 2].map(s => ({ label: s + '×', right: video.playbackRate === s ? '✓' : '', fn: () => setSpeed(s) })), { align: 'left' }) }, icon('clock'), h('span', video.playbackRate + '×'));
    const qualBtn = h('button', { class: 'btn xs', onclick: e => menu(e.currentTarget, q.map((x, i) => ({ label: x.label, right: i === qi ? '✓' : '', fn: () => { setQuality(i); qualBtn.lastChild.textContent = x.label; } })), { align: 'left' }) }, icon('settings'), h('span', q[0] ? q[0].label : '-'));
    const autoBtn = h('label', { class: 'row', style: { marginLeft: 'auto' } }, 'Autoplay ', h('button', { class: 'toggle' + (state.autoplay ? ' on' : ''), onclick: e => { state.autoplay = !state.autoplay; localStorage.setItem('vt_autoplay', state.autoplay ? '1' : '0'); e.currentTarget.classList.toggle('on', state.autoplay); } }));
    left.append(pw, h('div', { class: 'player-bar' }, qualBtn, speedBtn, h('button', { class: 'btn xs', onclick: toggleTheater }, 'Theater (t)'), v.captions ? h('span', { class: 'dim' }, 'Captions: press c') : null, autoBtn));
    if (embed) { left.append(h('h2', { class: 'mt8' }, h('a', { href: location.origin + watchUrl(v), target: '_blank' }, v.title))); return wrap; }

    /* title + actions */
    left.append(h('h1', v.title));
    if (v.me && v.me.manager && v.status !== 'approved') left.append(h('div', { class: 'notice ' + (v.status === 'pending' ? 'warn' : 'bad') }, h('b', { html: { pending: 'Awaiting GeoTube review. ', rejected: 'Not accepted on GeoTube. ', removed: 'Removed by a moderator. ', restricted: 'Restricted by a moderator. ' }[v.status] }), v.review_note || 'Only you can see this video until it is approved.', ' ', h('a', { href: href('/studio/video/' + v.id) }, 'Open in Studio')));
    if (v.me && v.me.manager && ['private', 'unlisted', 'draft', 'scheduled'].includes(v.visibility)) left.append(h('div', { class: 'notice' }, h('b', v.visibility === 'unlisted' ? 'Unlisted: ' : v.visibility + ': '), 'this video does not appear in feeds or search.'));
    const ch = v.channel;
    const subCount = h('span', { class: 'small muted' }, fmtNum(ch.subscribers) + ' subscribers');
    const likeBtn = h('button', { class: 'btn' + (v.me && v.me.reaction === 1 ? ' active' : ''), title: 'I like this', onclick: () => react(1) }, icon('like'), h('span', fmtNum(v.likes)));
    const dislikeBtn = h('button', { class: 'btn' + (v.me && v.me.reaction === -1 ? ' active' : ''), title: 'I dislike this', onclick: () => react(-1) }, icon('dislike'));
    async function react(val) {
      if (!requireLogin('Sign in to rate videos')) return;
      const cur = likeBtn.classList.contains('active') ? 1 : dislikeBtn.classList.contains('active') ? -1 : 0;
      try { const r = await post(`/api/videos/${v.id}/react`, { platform: v.platform, value: cur === val ? 0 : val }); likeBtn.classList.toggle('active', r.value === 1); dislikeBtn.classList.toggle('active', r.value === -1); likeBtn.lastChild.textContent = fmtNum(r.likes); } catch (e) { errToast(e); }
    }
    const moreBtn = h('button', { class: 'btn icon', onclick: e => menu(e.currentTarget, [
      { icon: 'clock', label: 'Save to Watch later', fn: () => toggleWatchLater(v) },
      v.allow_download || (v.me && v.me.manager) ? { icon: 'download', label: 'Download', fn: () => { window.open(`/api/videos/${v.id}/download?platform=${v.platform}`); } } : null,
      v.also_on ? { icon: 'globe', label: 'Watch on ' + platformName(v.also_on), fn: () => navigate((v.also_on === 'geotube' ? '/geotube' : '/vidtube') + '/watch?v=' + v.id) } : null,
      '-', { icon: 'flag', label: 'Report', fn: () => reportDialog('video', v.id, v.platform) },
      state.user ? { icon: 'scissors', label: 'Submit a copyright claim', fn: () => claimDialog(v.id) } : null,
      v.me && v.me.manager ? '-' : null, v.me && v.me.manager ? { icon: 'edit', label: 'Edit in Studio', fn: () => navigate('/studio/video/' + v.id) } : null,
    ]) }, icon('more'));
    left.append(h('div', { class: 'watch-actions mt8' },
      h('div', { class: 'row' }, h('a', { href: href('/@' + ch.handle) }, avatar(ch.avatar, ch.name, 'lg')), h('div', h('a', { href: href('/@' + ch.handle) }, h('b', ch.name), ch.is_verified ? icon('verified', 'verified') : null, VT.badgeIcons(ch.badges)), h('div', subCount)), await subscribeButton(ch, { videoId: v.id, onChange: r => (subCount.textContent = fmtNum(r.subscribers) + ' subscribers') })),
      h('div', { class: 'row wrap' }, h('div', { class: 'group' }, likeBtn, h('span', { class: 'sep' }), dislikeBtn), h('button', { class: 'btn', onclick: () => shareDialog(location.origin + watchUrl(v), v.title, { time: () => video.currentTime }) }, icon('share'), 'Share'),
        h('button', { class: 'btn', onclick: () => savePlaylistDialog(v) }, icon('save'), 'Save'), moreBtn)));
    /* description with chapters & timestamps */
    const descBox = h('div', { class: 'desc-box collapsed' });
    const meta = h('div', h('b', { class: 'view-count' }, fmtFull(v.views) + ' views'), ' · ', h('b', v.published_at ? fmtDate(v.published_at) : 'Not published'), v.category_name ? [' · ', h('a', { href: href('/?cat=' + v.category), class: 'hash' }, v.category_name)] : null, v.sponsored ? h('span', { class: 'tag warn', style: { marginLeft: '8px' } }, 'Includes paid promotion') : null, v.made_for_kids ? h('span', { class: 'tag', style: { marginLeft: '8px' } }, 'Made for kids') : null);
    const chapters = [];
    const descHtml = esc(v.description || 'No description.').replace(/(^|\s)((?:\d{1,2}:)?\d{1,2}:\d{2})(?=\s|$)/g, (m, pre, ts) => `${pre}<span class="tsl" data-t="${ts}">${ts}</span>`).replace(/(^|\s)#([\w-]+)/g, (m, pre, tag) => `${pre}<a class="hash" href="${href('/results?q=' + encodeURIComponent('#' + tag))}">#${tag}</a>`).replace(/(https?:\/\/[^\s<]+)/g, u => `<a class="hash" href="${u}" target="_blank" rel="noopener nofollow">${u}</a>`);
    (v.description || '').split('\n').forEach(line => { const m = /^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+[-–]?\s*(.+)$/.exec(line.trim()); if (m) chapters.push({ t: parseTs(m[1]), label: m[2] }); });
    descBox.append(meta, h('div', { class: 'mt8', html: descHtml }), v.tags.length ? h('div', { class: 'row wrap mt8' }, v.tags.map(t => h('a', { class: 'tag', href: href('/results?q=' + encodeURIComponent(t)) }, t))) : null);
    descBox.addEventListener('click', e => { const ts = e.target.closest('.tsl'); if (ts) { video.currentTime = parseTs(ts.dataset.t); video.play(); e.stopPropagation(); return; } if (e.target.closest('a')) return; descBox.classList.toggle('collapsed'); });
    left.append(descBox);
    if (chapters.length) {
      const row = h('div', { class: 'chapters' }, chapters.map(c => h('button', { class: 'ch', onclick: () => { video.currentTime = c.t; video.play(); } }, fmtDur(c.t) + ' ' + c.label)));
      left.append(row);
      video.addEventListener('timeupdate', () => { let idx = -1; chapters.forEach((c, i) => { if (video.currentTime >= c.t) idx = i; }); $$('.ch', row).forEach((b, i) => b.classList.toggle('active', i === idx)); });
    }
    /* comments */
    left.append(await commentsSection(v, ctx.query.c));
    /* right column: playlist + related */
    if (playlist) {
      const idx = playlist.items.findIndex(x => x.id === v.id);
      right.append(h('div', { class: 'playlist-panel' }, h('div', { class: 'ph' }, h('b', playlist.title), h('div', { class: 'small muted' }, `${playlist.owner.name} · ${idx + 1} / ${playlist.items.length}`)),
        h('div', { class: 'items' }, playlist.items.map((it, i) => h('a', { class: 'pi' + (it.id === v.id ? ' active' : ''), href: watchUrl(it, '&src=playlist&list=' + playlist.id) }, h('span', { class: 'dim small', style: { width: '18px' } }, i + 1), h('div', { class: 'thumb' }, it.thumb ? h('img', { src: fileUrl(it.thumb), alt: '' }) : null), h('div', { class: 'grow' }, h('div', { class: 'clamp2 small' }, h('b', it.title)), h('div', { class: 'small muted' }, it.channel_name)))))));
    }
    if (ads && ads.banner) right.append(h('div', { class: 'ad-slot' }, VT.adCard(ads.banner, 'side')));
    right.append(h('div', { class: 'col' }, v.related.map(r => vrow(r, { compact: true, source: 'suggested' }))));
    return wrap;
  });
  const parseTs = s => s.split(':').reduce((a, x) => a * 60 + Number(x), 0);
  function claimDialog(videoId) {
    const work = h('input', { class: 'input', placeholder: 'Title or link of your original work' });
    const details = h('textarea', { class: 'input', placeholder: 'Describe what was copied and where it appears in the video (timestamps help).' });
    modal({ title: 'Copyright claim', body: h('div', h('p', { class: 'small muted' }, 'Only submit a claim for work you own. False claims can lead to account restrictions.'), h('div', { class: 'field' }, h('label', 'Your original work'), work), h('div', { class: 'field' }, h('label', 'Details'), details)),
      foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => { try { await post('/api/claims', { video_id: videoId, work: work.value, details: details.value }); closeModal(); toast('Claim submitted. A moderator will review it.'); } catch (e) { errToast(e); } } }, 'Submit claim')] });
  }

  // Picture / GIF grid under a community post.
  function postMedia(p) {
    const list = (p.attachments || []).filter(a => a && a.url);
    return list.length ? h('div', { class: 'post-media n' + Math.min(list.length, 4) }, list.map(a => VT.mediaNode(a, 'post-img'))) : null;
  }
  async function commentsSection(v, highlightId) {
    const wrap = h('div', { class: 'comments' });
    if (!v.allow_comments) { wrap.append(h('p', { class: 'muted' }, 'Comments are turned off for this video.')); return wrap; }
    let sort = 'top', page = 0;
    const head = h('div', { class: 'row' }, h('h2', `${fmtFull(v.comment_count)} comments`), h('button', { class: 'btn xs', onclick: e => menu(e.currentTarget, [{ label: 'Top comments', fn: () => { sort = 'top'; reload(); } }, { label: 'Newest first', fn: () => { sort = 'new'; reload(); } }], { align: 'left' }) }, icon('list'), 'Sort by'));
    const list = h('div');
    wrap.append(head, composer(null, c => { list.prepend(commentNode(c)); if (c.status === 'held') toast('Your comment is waiting for the creator to approve it'); }), list);
    const morePager = pager(async () => { page++; return await load(); });
    async function load() {
      const d = await get(`/api/videos/${v.id}/comments?platform=${v.platform}&sort=${sort}&page=${page}`);
      d.items.forEach(c => list.append(commentNode(c)));
      if (page === 0 && !d.items.length) list.append(h('p', { class: 'muted' }, 'No comments yet. Start the conversation.'));
      return d.more;
    }
    async function reload() { list.innerHTML = ''; page = 0; morePager.remove(); if (await load()) wrap.append(morePager); }
    if (await load()) wrap.append(morePager);
    if (highlightId) setTimeout(() => { const n = $(`[data-cid="${highlightId}"]`, list); if (n) { n.scrollIntoView({ block: 'center' }); n.style.background = 'var(--accent-soft)'; } }, 100);
    function composer(parentId, onDone, initial = '') {
      if (!state.user) return h('p', { class: 'muted small' }, h('a', { href: href('/login'), class: 'hash' }, 'Sign in'), ' to add a comment.');
      const ta = h('textarea', { class: 'input', placeholder: parentId ? 'Add a reply...' : 'Add a comment...', rows: 1, style: { minHeight: '40px' } });
      ta.value = initial;
      const attach = VT.attachmentPicker({ max: 1, kind: 'comment', video: { id: v.id, platform: v.platform, title: v.title } });
      const btn = h('button', { class: 'btn primary sm', onclick: async () => { const body = ta.value.trim(); const a = attach.get()[0] || null; if (!body && !a) return; btn.disabled = true; try { const c = await post(`/api/videos/${v.id}/comments`, { platform: v.platform, body, parent_id: parentId, attachment: a }); ta.value = ''; attach.clear(); onDone(c); } catch (e) { errToast(e); } btn.disabled = false; } }, parentId ? 'Reply' : 'Comment');
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) btn.click(); });
      return h('div', { class: 'comment' }, avatar(state.channel && state.channel.avatar, state.channel ? state.channel.name : state.user.email, parentId ? 'sm' : ''), h('div', { class: 'grow' }, ta, attach.node, h('div', { class: 'row mt8', style: { justifyContent: 'flex-end' } }, btn)));
    }
    function commentNode(c) {
      const node = h('div', { class: 'comment' + (c.status !== 'visible' ? ' held' : ''), dataset: { cid: c.id } });
      const body = h('div', { class: 'body' }, c.body);
      const mediaBox = h('div', VT.mediaNode(c.attachment));
      const likeB = h('button', { class: 'btn' + (c.liked ? ' active' : ''), onclick: async () => { if (!requireLogin()) return; try { const r = await post(`/api/comments/${c.id}/like`); likeB.classList.toggle('active', r.liked); likeB.lastChild.textContent = r.likes || ''; } catch (e) { errToast(e); } } }, icon('like'), h('span', c.likes || ''));
      const repliesBox = h('div', { class: 'replies' });
      let repliesOpen = false;
      const replyToggle = c.reply_count ? h('button', { class: 'btn', onclick: async () => { repliesOpen = !repliesOpen; repliesBox.innerHTML = ''; if (repliesOpen) { const d = await get(`/api/videos/${v.id}/comments?platform=${v.platform}&parent=${c.id}&limit=60`); d.items.forEach(r => repliesBox.append(commentNode(r))); } replyToggle.lastChild.textContent = (repliesOpen ? 'Hide' : 'Show') + ` ${c.reply_count} replies`; } }, icon('chevd'), h('span', `${c.reply_count} replies`)) : null;
      const replyBtn = state.user && !c.parent_id ? h('button', { class: 'btn', onclick: () => { if ($('.composer', node)) return; const cmp = composer(c.id, r => { cmp.remove(); repliesBox.append(commentNode(r)); if (r.status === 'held') toast('Your reply is waiting for approval'); }); cmp.classList.add('composer'); node.querySelector('.c-actions').after(cmp); } }, 'Reply') : null;
      const manager = v.me && v.me.manager;
      const moreB = h('button', { class: 'btn icon', style: { width: '28px', height: '28px' }, onclick: e => menu(e.currentTarget, [
        c.mine ? { icon: 'edit', label: 'Edit', fn: async () => { const t = await prompt('Edit comment', { value: c.body, multiline: true }); if (t === null || (!t.trim() && !c.attachment)) return; try { await patch(`/api/comments/${c.id}`, { body: t }); body.textContent = t.trim(); } catch (e) { errToast(e); } } } : null,
        c.mine && c.attachment ? { icon: 'close', label: c.attachment.kind === 'gif' ? 'Remove GIF' : 'Remove picture', fn: async () => { if (!c.body.trim()) { toast('Add some text first, or delete the whole comment', { bad: true }); return; } try { await patch(`/api/comments/${c.id}`, { body: c.body, attachment: null }); c.attachment = null; mediaBox.innerHTML = ''; } catch (e) { errToast(e); } } } : null,
        c.mine || manager ? { icon: 'trash', label: c.mine ? 'Delete' : 'Remove', danger: true, fn: async () => { if (!(await confirm('Delete comment', 'This cannot be undone.', { danger: true, ok: 'Delete' }))) return; try { await del(`/api/comments/${c.id}`); node.remove(); } catch (e) { errToast(e); } } } : null,
        manager && !c.parent_id ? { icon: 'pin', label: c.pinned ? 'Unpin' : 'Pin', fn: () => studioAction(c.pinned ? 'unpin' : 'pin') } : null,
        manager ? { icon: 'heart', label: c.hearted ? 'Remove heart' : 'Heart', fn: () => studioAction(c.hearted ? 'unheart' : 'heart') } : null,
        manager && c.status === 'held' ? { icon: 'check', label: 'Approve', fn: () => studioAction('approve') } : null,
        manager && !c.mine ? { icon: 'eyeoff', label: 'Hide user from channel', danger: true, fn: () => studioAction('hide_user') } : null,
        !c.mine ? { icon: 'flag', label: 'Report', fn: () => reportDialog('comment', c.id, v.platform) } : null,
      ]) }, icon('more'));
      async function studioAction(a) { try { await post(`/api/studio/comments/${c.id}/${a}`); toast('Done'); if (a === 'approve') { node.classList.remove('held'); $('.tag', node) && $('.tag', node).remove(); } if (a === 'hide_user') node.remove(); if (a === 'pin') node.prepend(h('div', { class: 'pinned' }, icon('pin'), ' Pinned by ' + v.channel.name)); } catch (e) { errToast(e); } }
      node.append(avatar(c.author.avatar, c.author.name, c.parent_id ? 'sm' : ''), h('div', { class: 'grow' },
        c.pinned ? h('div', { class: 'pinned' }, 'Pinned by ' + v.channel.name) : null,
        h('div', { class: 'row small' }, c.author.handle ? h('a', { href: href('/@' + c.author.handle), class: c.author.is_owner ? 'tag accent' : '' }, h('b', c.author.name)) : h('b', c.author.name), VT.badgeIcons(c.author.badges), h('span', { class: 'dim' }, ago(c.created_at) + (c.edited_at ? ' (edited)' : '')),
          c.status === 'held' ? h('span', { class: 'tag warn' }, 'Held for review') : c.status === 'hidden' ? h('span', { class: 'tag' }, 'Only visible to you') : null),
        body, mediaBox,
        h('div', { class: 'c-actions' }, likeB, h('button', { class: 'btn', title: 'Dislike' }, icon('dislike')), replyBtn, c.hearted ? h('span', { class: 'row', title: 'Hearted by the creator' }, avatar(v.channel.avatar, v.channel.name, 'sm'), icon('heart', 'heart')) : null, moreB),
        replyToggle, repliesBox));
      return node;
    }
    return wrap;
  }

  /* ---------- search results ---------- */
  route('/results', async ctx => {
    const q = ctx.query.q || '';
    document.title = `${q} - ${platformName(ctx.platform)}`;
    const f = { type: ctx.query.type || 'all', date: ctx.query.date || 'any', duration: ctx.query.duration || 'any', sort: ctx.query.sort || 'relevance' };
    const wrap = h('div');
    const setF = (k, v) => { const p = new URLSearchParams({ q, ...f, [k]: v }); navigate('/results?' + p); };
    const filterRow = h('div', { class: 'row wrap mb16' },
      sel('Type', 'type', [['all', 'All'], ['video', 'Videos'], ['short', 'Shorts'], ['channel', 'Channels'], ['playlist', 'Playlists']]),
      sel('Upload date', 'date', [['any', 'Any time'], ['hour', 'Last hour'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year']]),
      sel('Duration', 'duration', [['any', 'Any'], ['short', 'Under 4 minutes'], ['medium', '4-20 minutes'], ['long', 'Over 20 minutes']]),
      sel('Sort by', 'sort', [['relevance', 'Relevance'], ['date', 'Upload date'], ['views', 'View count'], ['rating', 'Rating']]));
    function sel(label, key, opts) { return h('label', { class: 'row small muted' }, label, h('select', { class: 'select', style: { width: 'auto', height: '32px' }, onchange: e => setF(key, e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l)))); }
    wrap.append(filterRow);
    let page = 0;
    const list = h('div', { class: 'col', style: { gap: '16px' } });
    const load = async () => {
      const d = await get(`/api/search?platform=${ctx.platform}&q=${encodeURIComponent(q)}&type=${f.type}&date=${f.date}&duration=${f.duration}&sort=${f.sort}&page=${page}`);
      if (page === 0) {
        d.channels.forEach(c => list.append(h('a', { class: 'chan-card', href: href('/@' + c.handle) }, avatar(c.avatar, c.name, 'xl'), h('div', { class: 'grow' }, h('h3', c.name, c.is_verified ? icon('verified', 'verified') : null, VT.badgeIcons(c.badges)), h('div', { class: 'small muted' }, `@${c.handle} · ${fmtNum(c.subscribers)} subscribers · ${c.video_count} videos`), h('div', { class: 'small muted clamp2' }, c.description)))));
        d.playlists.forEach(p => list.append(h('a', { class: 'vrow', href: href('/playlist?list=' + p.id) }, h('div', { class: 'thumb' }, p.thumb ? h('img', { src: fileUrl(p.thumb), alt: '' }) : null, h('div', { class: 'pl' }, icon('playlist'), p.count + ' videos')), h('div', h('div', { class: 'title' }, p.title), h('div', { class: 'small muted' }, 'Playlist · ' + p.owner)))));
        if (!d.videos.length && !d.channels.length && !d.playlists.length) list.append(h('div', { class: 'empty' }, h('h3', 'No results for "' + q + '"'), h('p', 'Try different keywords or remove search filters.')));
      }
      d.videos.forEach(v => list.append(vrow(v, { desc: true, source: 'search' })));
      page++;
      return d.more;
    };
    const more = await load();
    wrap.append(list); if (more) wrap.append(pager(load));
    return wrap;
  });

  /* ---------- channel page ---------- */
  async function channelPage(ctx, handle) {
    const ch = await get(`/api/channels/${encodeURIComponent(handle)}?platform=${ctx.platform}`);
    document.title = `${ch.name} - ${platformName(ctx.platform)}`;
    const tab = ctx.query.tab || 'home';
    const wrap = h('div');
    if (ch.banner) wrap.append(h('div', { class: 'banner' }, h('img', { src: fileUrl(ch.banner), alt: '' })));
    if (ch.suspended) wrap.append(h('div', { class: 'notice bad mt16' }, 'This channel is suspended. Only you and moderators can see it.'));
    const subCount = h('span', fmtNum(ch.subscribers) + ' subscribers');
    wrap.append(h('div', { class: 'chan-head' }, avatar(ch.avatar, ch.name, 'xl'), h('div', { class: 'grow' }, h('h1', ch.name, ch.is_verified ? icon('verified', 'verified') : null, VT.badgeIcons(ch.badges)), h('div', { class: 'stats' }, '@' + ch.handle, ' · ', subCount, ' · ', ch.video_count + ' videos'),
      h('div', { class: 'small muted clamp2 mt8', style: { cursor: 'pointer' }, onclick: () => navigate(`/@${ch.handle}?tab=about`) }, ch.description || ''), ch.links.length ? h('div', { class: 'row wrap small mt8' }, ch.links.slice(0, 3).map(l => h('a', { class: 'hash', href: l.url, target: '_blank', rel: 'noopener' }, icon('link'), ' ' + (l.title || l.url)))) : null,
      h('div', { class: 'row mt8' }, await subscribeButton(ch, { onChange: r => (subCount.textContent = fmtNum(r.subscribers) + ' subscribers') }), ch.manager ? h('a', { class: 'btn outline', href: href('/studio') }, 'Studio') : null, !ch.manager ? h('button', { class: 'btn icon', onclick: e => menu(e.currentTarget, [{ icon: 'share', label: 'Share channel', fn: () => shareDialog(location.origin + href('/@' + ch.handle), ch.name) }, { icon: 'flag', label: 'Report channel', fn: () => reportDialog('channel', ch.id, ctx.platform) }]) }, icon('more')) : null))));
    const tabItems = [{ value: 'home', label: 'Home' }, { value: 'videos', label: 'Videos' }, { value: 'shorts', label: 'Shorts' }, { value: 'playlists', label: 'Playlists' }, { value: 'posts', label: 'Posts' }, { value: 'about', label: 'About' }];
    wrap.append(tabs(tabItems, tab, t => navigate(`/@${ch.handle}${t === 'home' ? '' : '?tab=' + t}`)));
    const body = h('div');
    wrap.append(body);
    if (tab === 'home') {
      const feat = ch.featured || ch.trailer;
      if (feat && (ch.sections.includes('featured') || ch.trailer)) body.append(h('div', { class: 'row mb16', style: { alignItems: 'flex-start', gap: '20px' } }, h('div', { class: 'player-wrap', style: { width: '480px', maxWidth: '100%', flex: 'none' } }, h('video', { controls: true, poster: fileUrl(feat.thumb) || '', src: `/media/${(await get(`/api/videos/${feat.id}?platform=${ctx.platform}`)).asset.id}/main.mp4` })), h('div', h('a', { href: watchUrl(feat, '&src=channel') }, h('h3', feat.title)), h('div', { class: 'small muted' }, fmtNum(feat.views) + ' views · ' + ago(feat.published_at)))));
      const shelves = { recent: ['Latest videos', ch.recent], popular: ['Popular videos', ch.popular], shorts: ['Shorts', ch.shorts] };
      for (const s of ch.sections) {
        if (shelves[s] && shelves[s][1].length) body.append(section(shelves[s][0], h('div', { class: 'grid' + (s === 'shorts' ? ' shorts-grid' : '') }, shelves[s][1].map(v => vcard(v, { showChannel: false, source: 'channel' })))));
        if (s === 'playlists' && ch.playlists.length) body.append(section('Playlists', playlistGrid(ch.playlists)));
        if (s === 'posts' && ch.posts.length) body.append(section('Posts', ch.posts.slice(0, 2).map(p => h('div', { class: 'post' }, h('div', { class: 'small muted' }, ago(p.created_at)), p.body, postMedia(p)))));
      }
      if (!ch.video_count) body.append(h('div', { class: 'empty' }, 'This channel has no videos on ' + platformName(ctx.platform) + ' yet.'));
    } else if (tab === 'videos' || tab === 'shorts') {
      let sort = ctx.query.sort || 'latest', page = 0;
      body.append(chipsRow([{ value: 'latest', label: 'Latest' }, { value: 'popular', label: 'Popular' }, { value: 'oldest', label: 'Oldest' }], sort, s => navigate(`/@${ch.handle}?tab=${tab}&sort=${s}`)));
      const grid = h('div', { class: 'grid' + (tab === 'shorts' ? ' shorts-grid' : '') });
      const load = async () => { const d = await get(`/api/channels/${encodeURIComponent(handle)}/videos?platform=${ctx.platform}&kind=${tab}&sort=${sort}&page=${page++}`); d.items.forEach(v => grid.append(vcard(v, { showChannel: false, source: 'channel' }))); if (page === 1 && !d.items.length) grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, 'No ' + tab + ' yet')); return d.more; };
      const more = await load(); body.append(grid); if (more) body.append(pager(load));
    } else if (tab === 'playlists') body.append(ch.playlists.length ? playlistGrid(ch.playlists) : h('div', { class: 'empty' }, 'No public playlists'));
    else if (tab === 'posts') body.append(ch.posts.length ? ch.posts.map(p => h('div', { class: 'post' }, h('div', { class: 'row small muted' }, avatar(ch.avatar, ch.name, 'sm'), h('b', ch.name), ago(p.created_at)), p.body ? h('div', { class: 'mt8' }, p.body) : null, postMedia(p))) : h('div', { class: 'empty' }, 'No posts yet'));
    else body.append(h('div', { class: 'card', style: { maxWidth: '720px' } }, h('h3', 'Description'), h('p', { style: { whiteSpace: 'pre-wrap' } }, ch.description || 'No description'), h('h3', { class: 'mt16' }, 'Details'), h('dl', { class: 'kv mt8' }, h('dt', 'Handle'), h('dd', '@' + ch.handle), h('dt', 'Location'), h('dd', ch.country || 'Not set'), h('dt', 'Joined'), h('dd', fmtDate(ch.created_at)), h('dt', 'Views'), h('dd', fmtFull(ch.total_views)), h('dt', 'Videos'), h('dd', ch.video_count)), ch.links.length ? [h('h3', { class: 'mt16' }, 'Links'), ch.links.map(l => h('div', h('a', { class: 'hash', href: l.url, target: '_blank', rel: 'noopener' }, l.title || l.url)))] : null));
    return wrap;
  }
  function playlistGrid(lists) { return h('div', { class: 'grid' }, lists.map(p => h('a', { class: 'vcard', href: href('/playlist?list=' + p.id) }, h('div', { class: 'thumb' }, p.thumb ? h('img', { src: fileUrl(p.thumb), alt: '' }) : null, h('div', { class: 'pl' }, icon('playlist'), p.count + ' videos')), h('div', { class: 'meta' }, h('div', h('div', { class: 'title' }, p.title), h('div', { class: 'sub' }, (p.visibility || 'public') + ' · updated ' + ago(p.updated_at))))))); }
  route('/@:handle', ctx => channelPage(ctx, ctx.params.handle));
  route('/channel/:handle', ctx => channelPage(ctx, ctx.params.handle));

  /* ---------- library, history, playlists, liked ---------- */
  const needUser = (what) => h('div', { class: 'empty' }, h('h3', 'Sign in to see your ' + what), h('a', { class: 'btn primary mt8', href: href('/login') }, 'Sign in'));
  route('/library', async ctx => {
    if (!state.user) return needUser('library');
    const d = await get('/api/library?platform=' + ctx.platform);
    const wrap = h('div', title('Library'));
    const shelf = (name, link, items, empty) => wrap.append(section(h('span', { class: 'row grow between' }, name, h('a', { class: 'btn xs outline', href: href(link) }, 'See all')), items.length ? h('div', { class: 'grid' }, items.slice(0, 8).map(v => vcard(v, { source: 'home' }))) : h('p', { class: 'muted' }, empty)));
    shelf('History', '/history', d.history, 'Videos you watch appear here.');
    shelf('Watch later', '/playlist?list=WL', d.watch_later.items, 'Save videos to watch later.');
    shelf('Liked videos', '/liked', d.liked, 'Videos you like appear here.');
    wrap.append(section(h('span', { class: 'row grow between' }, 'Playlists', h('a', { class: 'btn xs outline', href: href('/playlists') }, 'See all')), d.playlists.length ? playlistGrid(d.playlists) : h('p', { class: 'muted' }, 'No playlists yet.')));
    return wrap;
  });
  route('/history', async ctx => {
    if (!state.user) return needUser('history');
    const q = ctx.query.q || '';
    const wrap = h('div');
    const d = await get('/api/history?q=' + encodeURIComponent(q));
    const search = h('input', { class: 'input', placeholder: 'Search watch history', value: q, style: { maxWidth: '320px' }, onkeydown: e => { if (e.key === 'Enter') navigate('/history?q=' + encodeURIComponent(e.target.value)); } });
    const pauseBtn = h('button', { class: 'btn', onclick: async () => { await patch('/api/prefs', { history_paused: !d.paused }); d.paused = !d.paused; toast(d.paused ? 'Watch history paused' : 'Watch history resumed'); pauseBtn.textContent = d.paused ? 'Resume history' : 'Pause history'; } }, d.paused ? 'Resume history' : 'Pause history');
    wrap.append(h('div', { class: 'row wrap between mb16' }, h('h1', 'Watch history'), h('div', { class: 'row' }, search, pauseBtn, h('button', { class: 'btn outline', onclick: async () => { if (await confirm('Clear watch history', 'This removes all videos from your history.', { danger: true, ok: 'Clear' })) { await del('/api/history'); VT.render(); } } }, 'Clear all'),
      h('button', { class: 'btn outline', onclick: async () => { if (await confirm('Clear search history', 'This removes your saved searches.', { danger: true, ok: 'Clear' })) { await del('/api/search-history'); VT.render(); } } }, 'Clear searches'))));
    if (d.paused) wrap.append(h('div', { class: 'notice warn' }, 'Watch history is paused. New videos are not saved.'));
    const list = h('div', { class: 'col', style: { gap: '16px' } });
    const row = v => { const r = vrow(v, { source: 'home', extra: h('div', { class: 'small dim mt8' }, 'Watched ' + ago(v.watched_at)) }); r.append(h('button', { class: 'btn icon', title: 'Remove from history', onclick: async e => { e.preventDefault(); await del('/api/history/' + v.id); r.remove(); } }, icon('close'))); return r; };
    d.items.forEach(v => list.append(row(v)));
    if (!d.items.length) list.append(h('div', { class: 'empty' }, 'No watch history' + (q ? ' matching "' + q + '"' : '')));
    wrap.append(list);
    if (d.searches.length && !q) wrap.append(section('Recent searches', h('div', { class: 'row wrap' }, d.searches.slice(0, 15).map(s => h('a', { class: 'tag', href: (s.scope === 'geotube' ? '/geotube' : '') + '/results?q=' + encodeURIComponent(s.query) }, icon('search'), ' ' + s.query)))));
    return wrap;
  });
  route('/liked', async () => {
    if (!state.user) return needUser('liked videos');
    const wrap = h('div', title('Liked videos'));
    let page = 0; const grid = h('div', { class: 'grid' });
    const load = async () => { const d = await get('/api/liked?page=' + page++); d.items.forEach(v => grid.append(vcard(v, { source: 'home' }))); if (page === 1 && !d.items.length) grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, 'No liked videos yet')); return d.more; };
    const more = await load(); wrap.append(grid); if (more) wrap.append(pager(load));
    return wrap;
  });
  route('/playlists', async () => {
    if (!state.user) return needUser('playlists');
    const lists = await get('/api/playlists');
    const wrap = h('div', h('div', { class: 'row between mb16' }, h('h1', 'Playlists'), h('button', { class: 'btn primary', onclick: async () => { const t = await prompt('New playlist', { label: 'Name', ok: 'Create' }); if (t && t.trim()) { const p = await post('/api/playlists', { title: t.trim() }); navigate('/playlist?list=' + p.id); } } }, 'New playlist')));
    wrap.append(playlistGrid(lists.map(p => ({ ...p, title: p.watch_later ? 'Watch later' : p.title }))));
    return wrap;
  });
  route('/playlist', async ctx => {
    const id = ctx.query.list;
    if (!id) return h('div', { class: 'empty' }, 'No playlist selected');
    if (id === 'WL' && !state.user) return needUser('Watch later list');
    const p = await get('/api/playlists/' + id);
    document.title = p.title;
    const wrap = h('div', { class: 'watch', style: { gridTemplateColumns: '360px 1fr' } });
    const first = p.items[0];
    const head = h('div', { class: 'card', style: { position: 'sticky', top: 'calc(var(--topbar) + 20px)' } },
      first ? h('a', { href: watchUrl(first, '&src=playlist&list=' + p.id) }, h('div', { class: 'thumb mb16' }, first.thumb ? h('img', { src: fileUrl(first.thumb), alt: '' }) : null)) : h('div', { class: 'thumb mb16' }),
      h('h1', p.title), h('div', { class: 'small muted mt8' }, p.owner.handle ? h('a', { href: href('/@' + p.owner.handle) }, p.owner.name) : p.owner.name, ` · ${p.count} videos · ${p.visibility} · updated ${ago(p.updated_at)}`),
      p.description ? h('p', { class: 'mt8', style: { whiteSpace: 'pre-wrap' } }, p.description) : null,
      h('div', { class: 'row wrap mt16' }, first ? h('a', { class: 'btn primary', href: watchUrl(first, '&src=playlist&list=' + p.id) }, icon('play'), 'Play all') : null, p.visibility !== 'private' ? h('button', { class: 'btn', onclick: () => shareDialog(location.origin + href('/playlist?list=' + p.id), p.title) }, icon('share'), 'Share') : null,
        p.mine && !p.id.startsWith('WL') ? h('button', { class: 'btn icon', onclick: e => menu(e.currentTarget, [
          { icon: 'edit', label: 'Edit details', fn: () => editPlaylist(p) },
          { icon: 'trash', label: 'Delete playlist', danger: true, fn: async () => { if (await confirm('Delete playlist', `Delete "${p.title}"?`, { danger: true, ok: 'Delete' })) { await del('/api/playlists/' + p.id); navigate('/playlists'); } } }]) }, icon('more')) : null));
    const list = h('div', { class: 'col sortable', style: { gap: '12px' } });
    p.items.forEach((v, i) => {
      const r = vrow(v, { compact: false, source: 'playlist', playlistId: p.id });
      r.classList.add('item'); r.dataset.key = v.id + '@' + v.platform;
      r.prepend(h('span', { class: 'dim', style: { width: '24px', alignSelf: 'center' } }, i + 1));
      if (p.mine) {
        r.draggable = true;
        r.append(h('button', { class: 'btn icon', title: 'Remove', onclick: async e => { e.preventDefault(); await del(`/api/playlists/${p.id}/items/${v.id}?platform=${v.platform}`); r.remove(); } }, icon('close')));
        r.addEventListener('dragstart', e => { r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
        r.addEventListener('dragend', async () => { r.classList.remove('dragging'); $$('.item', list).forEach((x, i) => (x.firstChild.textContent = i + 1)); await patch(`/api/playlists/${p.id}/items`, { order: $$('.item', list).map(x => x.dataset.key) }); });
      }
      list.append(r);
    });
    list.addEventListener('dragover', e => { e.preventDefault(); const dragging = $('.dragging', list); if (!dragging) return; const after = $$('.item:not(.dragging)', list).find(x => e.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2); if (after) list.insertBefore(dragging, after); else list.append(dragging); });
    if (!p.items.length) list.append(h('div', { class: 'empty' }, 'This playlist is empty'));
    wrap.append(head, list);
    return wrap;
  });
  function editPlaylist(p) {
    const t = h('input', { class: 'input', value: p.title }), d = h('textarea', { class: 'input' }, p.description || ''), v = h('select', { class: 'select' }, ['private', 'unlisted', 'public'].map(x => h('option', { value: x, selected: p.visibility === x }, x)));
    modal({ title: 'Edit playlist', body: h('div', h('div', { class: 'field' }, h('label', 'Title'), t), h('div', { class: 'field' }, h('label', 'Description'), d), h('div', { class: 'field' }, h('label', 'Visibility'), v)),
      foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => { try { await patch('/api/playlists/' + p.id, { title: t.value, description: d.value, visibility: v.value }); closeModal(); VT.render(); } catch (e) { errToast(e); } } }, 'Save')] });
  }

  /* ---------- notifications page ---------- */
  route('/notifications', async () => {
    if (!state.user) return needUser('notifications');
    const wrap = h('div', h('div', { class: 'row between mb16' }, h('h1', 'Notifications'), h('button', { class: 'btn', onclick: async () => { await post('/api/notifications/read', {}); state.unread = 0; VT.renderTopbar(); VT.render(); } }, 'Mark all as read')));
    let page = 0; const list = h('div');
    const load = async () => { const d = await get('/api/notifications?page=' + page++ + '&limit=30'); d.items.forEach(n => { const r = VT.notifRow(n); r.append(h('button', { class: 'btn icon', onclick: async e => { e.stopPropagation(); await del('/api/notifications/' + n.id); r.remove(); } }, icon('close'))); list.append(r); }); if (page === 1 && !d.items.length) list.append(h('div', { class: 'empty' }, 'No notifications')); return d.more; };
    const more = await load(); wrap.append(list); if (more) wrap.append(pager(load));
    return wrap;
  });

  /* ---------- auth ---------- */
  function authCard(titleText, fields, submitLabel, onSubmit, foot) {
    const err = h('div', { class: 'err small mb8', style: { color: 'var(--bad)' } });
    const form = h('form', { onsubmit: async e => { e.preventDefault(); err.textContent = ''; const btn = $('button[type=submit]', form); btn.disabled = true; try { await onSubmit(Object.fromEntries(new FormData(form))); } catch (ex) { err.textContent = ex.message; } btn.disabled = false; } }, fields, err, h('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, submitLabel));
    return h('div', { class: 'auth' }, h('div', { class: 'card' }, h('h1', { class: 'mb16' }, titleText), form, foot ? h('div', { class: 'small muted mt16', style: { textAlign: 'center' } }, foot) : null));
  }
  const field = (label, name, type = 'text', extra = {}) => h('div', { class: 'field' }, h('label', { for: 'f_' + name }, label), h('input', { class: 'input', id: 'f_' + name, name, type, required: true, ...extra }));
  route('/login', ctx => {
    if (state.user) { navigate('/', { replace: true }); return null; }
    const next = ctx.query.next || '/';
    return authCard('Sign in', [field('Email', 'email', 'email', { autocomplete: 'email' }), field('Password', 'password', 'password', { autocomplete: 'current-password' }), h('div', { class: 'small mb16' }, h('a', { class: 'hash', href: href('/forgot-password') }, 'Forgot your password?'))], 'Sign in',
      async d => { const me = await post('/api/auth/login', d); VT.setMe(me); VT.invalidateSubs(); navigate(next.startsWith('/') ? next : '/'); toast('Welcome back'); }, [`New to ${platformName(ctx.platform)}? `, h('a', { class: 'hash', href: href('/register') }, 'Create an account')]);
  });
  route('/register', ctx => {
    if (state.user) { navigate('/', { replace: true }); return null; }
    return authCard('Create your account', [field('Email', 'email', 'email', { autocomplete: 'email' }), field('Password (8+ characters)', 'password', 'password', { minlength: 8, autocomplete: 'new-password' }), h('p', { class: 'small muted' }, 'By creating an account you agree to the ', h('a', { class: 'hash', href: href('/help#guidelines') }, 'community guidelines'), '.')], 'Create account',
      async d => { const me = await post('/api/auth/register', d); VT.setMe(me); navigate('/'); toast('Welcome to VidTube!'); if (VT.onboarding) VT.onboarding(); }, ['Already have an account? ', h('a', { class: 'hash', href: href('/login') }, 'Sign in')]);
  });
  route('/forgot-password', () => authCard('Reset your password', [h('p', { class: 'muted small' }, 'Enter your email address and we will send you a link to choose a new password.'), field('Email', 'email', 'email')], 'Send reset link',
    async d => { await post('/api/auth/forgot', d); toast('If an account exists for that address, a reset link was sent.'); navigate('/login'); }));
  route('/reset-password', ctx => authCard('Choose a new password', [field('New password', 'password', 'password', { minlength: 8 })], 'Save password',
    async d => { await post('/api/auth/reset', { token: ctx.query.token, password: d.password }); toast('Password changed. Sign in with your new password.'); navigate('/login'); }));
  /* ---------- onboarding ---------- */
  VT.onboarding = async () => {
    const cats = [...await categories('vidtube'), ...await categories('geotube')];
    const picked = new Set(state.prefs.interests || []);
    const chips = h('div', { class: 'interests' }, cats.map(c => h('button', { class: 'interest' + (picked.has(c.slug) ? ' on' : ''), onclick: e => { picked.has(c.slug) ? picked.delete(c.slug) : picked.add(c.slug); e.currentTarget.classList.toggle('on'); } }, c.name)));
    let theme = state.prefs.theme || 'system';
    const themeRow = h('div', { class: 'row' }, ['system', 'light', 'dark'].map(t => h('button', { class: 'chip' + (theme === t ? ' active' : ''), onclick: e => { theme = t; $$('.chip', themeRow).forEach(c => c.classList.remove('active')); e.currentTarget.classList.add('active'); state.prefs.theme = t; VT.setMe({ user: state.user, channel: state.channel, prefs: state.prefs, managed: state.managed, unread: state.unread }); } }, t[0].toUpperCase() + t.slice(1))));
    modal({ title: 'Welcome to VidTube', body: h('div', { class: 'onboard' }, h('p', 'Pick a few topics you like so your home feed starts off right. You can change this any time in Settings.'), chips, h('h3', { class: 'mt16 mb8' }, 'Appearance'), themeRow),
      foot: [h('button', { class: 'btn', onclick: finish }, 'Skip'), h('button', { class: 'btn primary', onclick: finish }, 'Done')], onClose: finish });
    async function finish() { closeModal(); try { const prefs = await patch('/api/prefs', { interests: [...picked], theme, onboarded: true }); state.prefs = prefs; } catch {} }
  };

  /* ---------- settings ---------- */
  route('/settings', async ctx => {
    if (!state.user) return needUser('settings');
    const tab = ctx.query.tab || 'account';
    const wrap = h('div', { class: 'settings' }, title('Settings'));
    wrap.append(tabs([{ value: 'account', label: 'Account' }, { value: 'channel', label: state.channel ? 'Channel' : 'Create channel' }, { value: 'preferences', label: 'Preferences' }, { value: 'notifications', label: 'Notifications' }, { value: 'privacy', label: 'Privacy & data' }], tab, t => navigate('/settings?tab=' + t)));
    const body = h('div'); wrap.append(body);
    const u = state.user, prefs = state.prefs;
    if (tab === 'account') {
      body.append(h('section', h('h2', 'Account'), h('dl', { class: 'kv' }, h('dt', 'Email'), h('dd', u.email), h('dt', 'Role'), h('dd', u.role), h('dt', 'Member since'), h('dd', fmtDate(u.created_at))),
        ));
      const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' }), nw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: 8 });
      body.append(h('section', h('h2', 'Change password'), h('div', { class: 'field' }, h('label', 'Current password'), cur), h('div', { class: 'field' }, h('label', 'New password'), nw), h('button', { class: 'btn primary', onclick: async () => { try { await post('/api/auth/change-password', { current: cur.value, password: nw.value }); cur.value = nw.value = ''; toast('Password changed'); } catch (e) { errToast(e); } } }, 'Update password')));
      const sessions = await get('/api/auth/sessions');
      body.append(h('section', h('h2', 'Devices'), h('table', { class: 'table' }, h('thead', h('tr', h('th', 'Device'), h('th', 'IP'), h('th', 'Signed in'))), h('tbody', sessions.map(s => h('tr', h('td', (s.ua || 'Unknown').slice(0, 60), s.current ? h('span', { class: 'tag good', style: { marginLeft: '6px' } }, 'This device') : null), h('td', s.ip), h('td', ago(s.created_at)))))),
        sessions.length > 1 ? h('button', { class: 'btn outline mt8', onclick: async () => { const r = await post('/api/auth/sessions/revoke-others'); toast(`Signed out ${r.revoked} other device(s)`); VT.render(); } }, 'Sign out other devices') : null));
      body.append(h('section', h('h2', 'Delete account'), h('p', { class: 'muted small' }, 'Deletes your account, channel, videos, comments and all data. This cannot be undone.'), h('button', { class: 'btn danger', onclick: async () => { const pw = await prompt('Delete account', { label: 'Enter your password to confirm' }); if (pw === null) return; try { await post('/api/account/delete', { password: pw }); await VT.loadMe(); navigate('/'); toast('Your account was deleted'); } catch (e) { errToast(e); } } }, 'Delete my account')));
    } else if (tab === 'channel') {
      if (state.channel) body.append(h('section', h('h2', 'Your channel'), h('div', { class: 'row' }, avatar(state.channel.avatar, state.channel.name, 'lg'), h('div', h('b', state.channel.name), h('div', { class: 'small muted' }, '@' + state.channel.handle))), h('div', { class: 'row mt16' }, h('a', { class: 'btn primary', href: href('/studio/customize') }, 'Customise in Studio'), h('a', { class: 'btn', href: href('/@' + state.channel.handle) }, 'View channel'))));
      else {
        const name = h('input', { class: 'input', placeholder: 'Channel name', maxlength: 50 }), handle = h('input', { class: 'input', placeholder: 'handle', maxlength: 30 }), hint = h('div', { class: 'hint' }, 'Letters, numbers, dots, dashes and underscores. 3-30 characters.');
        let t; handle.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { if (!handle.value) return; const r = await get('/api/handles/check?handle=' + encodeURIComponent(handle.value)); hint.textContent = r.available ? '@' + handle.value + ' is available' : r.reason; hint.style.color = r.available ? 'var(--good)' : 'var(--bad)'; }, 300); });
        name.addEventListener('input', () => { if (!handle.dataset.touched) handle.value = name.value.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 30); handle.dispatchEvent(new Event('input')); });
        handle.addEventListener('keydown', () => (handle.dataset.touched = '1'));
        body.append(h('section', h('h2', 'Create a channel'), h('p', { class: 'muted' }, 'A channel lets you upload videos, comment with a name and build an audience on both VidTube and GeoTube.'), h('div', { class: 'field' }, h('label', 'Channel name'), name), h('div', { class: 'field' }, h('label', 'Handle'), h('div', { class: 'row' }, h('span', { class: 'muted' }, '@'), handle), hint),
          h('button', { class: 'btn primary', onclick: async () => { try { const me = await post('/api/channels', { name: name.value, handle: handle.value }); VT.setMe(me); toast('Channel created!'); navigate('/studio'); } catch (e) { errToast(e); } } }, 'Create channel')));
      }
    } else if (tab === 'preferences') {
      const cats = [...await categories('vidtube'), ...await categories('geotube')];
      const picked = new Set(prefs.interests || []);
      body.append(h('section', h('h2', 'Appearance'), h('div', { class: 'row' }, ['system', 'light', 'dark'].map(t => h('button', { class: 'chip' + ((prefs.theme || 'system') === t ? ' active' : ''), onclick: async e => { const p = await patch('/api/prefs', { theme: t }); state.prefs = p; localStorage.setItem('vt_theme', t); VT.setMe({ user: state.user, channel: state.channel, prefs: p, managed: state.managed, unread: state.unread }); $$('.chip', e.currentTarget.parentNode).forEach(c => c.classList.remove('active')); e.currentTarget.classList.add('active'); } }, t[0].toUpperCase() + t.slice(1))))));
      body.append(h('section', h('h2', 'Interests'), h('p', { class: 'muted small' }, 'Used to personalise your home feed.'), h('div', { class: 'interests row wrap' }, cats.map(c => h('button', { class: 'interest' + (picked.has(c.slug) ? ' on' : ''), onclick: async e => { picked.has(c.slug) ? picked.delete(c.slug) : picked.add(c.slug); e.currentTarget.classList.toggle('on'); state.prefs = await patch('/api/prefs', { interests: [...picked] }); } }, c.name)))));
      body.append(h('section', h('h2', 'Playback'), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.autoplay, onchange: e => { state.autoplay = e.target.checked; localStorage.setItem('vt_autoplay', state.autoplay ? '1' : '0'); } }), h('div', h('b', 'Autoplay next video'))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: localStorage.getItem('vt_cc') === '1', onchange: e => localStorage.setItem('vt_cc', e.target.checked ? '1' : '0') }), h('div', h('b', 'Show captions by default when available')))));
    } else if (tab === 'notifications') {
      const types = [['subscriptions', 'New videos and posts from subscriptions'], ['comments', 'Comments on my videos'], ['replies', 'Replies to my comments and hearts'], ['upload', 'Upload processing updates'], ['channel', 'Channel milestones and partner updates']];
      const n = prefs.notif || {};
      body.append(h('section', h('h2', 'Email & in-app notifications'), types.map(([k, l]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: n[k] !== false, onchange: async e => { n[k] = e.target.checked; state.prefs = await patch('/api/prefs', { notif: n }); } }), h('div', h('b', l)))), h('p', { class: 'small muted mt8' }, 'Security and moderation notices are always delivered.')));
    } else {
      const p = prefs.privacy || {};
      body.append(h('section', h('h2', 'Privacy'), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !prefs.history_paused, onchange: async e => { state.prefs = await patch('/api/prefs', { history_paused: !e.target.checked }); } }), h('div', h('b', 'Save my watch history'), h('span', 'Used for resume positions and recommendations.'))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p.hide_subscriptions === true, onchange: async e => { p.hide_subscriptions = e.target.checked; state.prefs = await patch('/api/prefs', { privacy: p }); } }), h('div', h('b', 'Keep my subscriptions private')))));
      body.append(h('section', h('h2', 'Your data'), h('p', { class: 'muted small' }, 'Download a copy of everything stored about your account as JSON.'), h('a', { class: 'btn', href: '/api/account/export', download: 'vidtube-export.json' }, icon('download'), 'Export my data')));
    }
    return wrap;
  });

  /* ---------- help ---------- */
  route('/help', () => h('div', { class: 'help settings' }, title('Help & guidelines'),
    h('h2', 'Getting started'), h('p', 'Create an account, then create a channel from Settings to upload videos. Every upload can be published on VidTube, on GeoTube, or on both, each with its own title, description and category.'),
    h('h2', { id: 'geotube' }, 'What is GeoTube?'), h('p', 'GeoTube is the part of the platform reserved for mapping videos (alternate history, future maps, tutorials, timelapses), Countryballs (comics and animations) and closely related geography and history content. To keep the feed on topic, every GeoTube submission goes through an automated pre-check. Videos that pass are published immediately; everything else waits for a moderator. Rejected videos can be appealed from Studio.'),
    h('h2', { id: 'guidelines' }, 'Community guidelines'), h('ul', h('li', 'No spam, scams or misleading metadata.'), h('li', 'No harassment, hate speech or threats.'), h('li', 'No sexual content or content that endangers children.'), h('li', 'No graphic violence or dangerous challenges.'), h('li', 'Only upload content you own or have permission to use. Copyright owners can submit claims from any video page.'), h('li', 'On GeoTube: stay on topic. Off-topic uploads are rejected (not punished) unless they are repeated deliberately.')),
    h('h2', 'Keyboard shortcuts'), h('p', h('kbd', 'space'), '/', h('kbd', 'k'), ' play/pause · ', h('kbd', 'j'), '/', h('kbd', 'l'), ' skip 10 s · ', h('kbd', '←'), '/', h('kbd', '→'), ' skip 5 s · ', h('kbd', 'f'), ' fullscreen · ', h('kbd', 'm'), ' mute · ', h('kbd', 't'), ' theater · ', h('kbd', 'c'), ' captions · ', h('kbd', '0-9'), ' jump · ', h('kbd', '/'), ' search'),
    h('h2', { id: 'mail' }, 'No password-reset email?'), h('p', 'Check your spam folder and wait a minute. If the server has no email settings yet, the administrator finds the message under Moderation → Mail outbox.'),
    h('h2', { id: 'privacy' }, 'Privacy'), h('p', 'We store your email, password hash, channel data, videos, comments, watch history (unless paused) and basic analytics (device type and region from the browser language, never a precise location). You can export or delete everything from Settings.'),
    h('h2', 'Contact'), h('p', 'Use the report button on any video, comment or channel to alert moderators. Moderators reply through notifications.')));
})();
