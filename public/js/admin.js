/* Moderation & administration pages. */
'use strict';
(() => {
  const { h, $, $$, icon, get, post, patch, put, del, fmtNum, fmtFull, fmtDur, ago, fmtDate, fmtDateTime, fileUrl, platformName, state, href, navigate, route, modal, closeModal, confirm, prompt, toast, errToast,
    avatar, tabs, chipsRow, pager, lineChart, hbars, statTile, menu, isAdmin, isMod } = VT;

  async function shell(ctx, active, content, pageTitle = '') {
    if (!isMod()) return h('div', { class: 'empty' }, h('h3', 'Moderators only'), h('p', 'You need a moderator or administrator account to open this area.'));
    document.title = (pageTitle ? pageTitle + ' - ' : '') + 'Moderation';
    const items = [['dashboard', 'Overview', '/admin', 'chart'], ['queue', 'Review queue', '/admin/queue', 'globe'], ['reports', 'Reports', '/admin/reports', 'flag'], ['appeals', 'Appeals', '/admin/appeals', 'inbox'], ['claims', 'Copyright claims', '/admin/claims', 'scissors'], ['videos', 'Find video', '/admin/videos', 'search'],
      ['users', 'Users', '/admin/users', 'users'], ['channels', 'Channels', '/admin/channels', 'studio']];
    if (isAdmin()) items.push(['categories', 'Categories', '/admin/categories', 'list'], ['settings', 'Platform settings', '/admin/settings', 'settings'], ['youtube', 'YouTube import', '/admin/youtube', 'download'], ['announcements', 'Announcements', '/admin/announcements', 'bell'], ['jobs', 'Processing jobs', '/admin/jobs', 'clock'], ['outbox', 'Mail outbox', '/admin/outbox', 'mail'], ['audit', 'Audit log', '/admin/audit', 'lock']);
    const nav = h('div', { class: 'snav' }, h('div', { class: 'chan' }, icon('admin'), h('div', h('b', isAdmin() ? 'Administrator' : 'Moderator')), h('div', { class: 'small muted' }, state.user.email)), items.map(([k, l, p, ic]) => h('a', { class: 'nav-item' + (k === active ? ' active' : ''), href: href(p) }, icon(ic), h('span', l))));
    const body = h('div', { class: 'grow' });
    body.append(await content());
    return h('div', { class: 'studio' }, nav, body);
  }
  const ptag = p => h('span', { class: 'tag ' + (p === 'geotube' ? 'geo' : 'vid') }, platformName(p));
  const wlink = (p, id) => (p === 'geotube' ? '/geotube' : '') + '/watch?v=' + id;

  route('/admin', ctx => shell(ctx, 'dashboard', async () => {
    const s = await get('/api/admin/stats');
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Overview'));
    if (!s.ffmpeg) wrap.append(h('div', { class: 'notice bad' }, h('b', 'FFmpeg is not installed on the server. '), 'Only MP4 and WebM uploads can play; no transcoding or thumbnails.'));
    wrap.append(h('div', { class: 'stats' }, statTile('Review queue', s.queue, { onclick: () => navigate('/admin/queue') }), statTile('Sexual-content flags', s.safety_flags, { onclick: () => navigate('/admin/queue?filter=safety'), active: s.safety_flags > 0 }), statTile('Flagged channels', s.flagged_channels, { onclick: () => navigate('/admin/channels?filter=flagged') }), statTile('Open reports', s.reports, { onclick: () => navigate('/admin/reports') }), statTile('Open appeals', s.appeals, { onclick: () => navigate('/admin/appeals') }), statTile('Copyright claims', s.claims, { onclick: () => navigate('/admin/claims') }), statTile('Monetisation applications', s.monetization, { onclick: () => navigate('/admin/channels?filter=monetization') })));
    wrap.append(h('div', { class: 'stats' }, statTile('Users', fmtFull(s.users), { sub: '+' + s.signups_7d + ' this week' }), statTile('Channels', fmtFull(s.channels)), statTile('Videos', fmtFull(s.videos), { sub: '+' + s.uploads_7d + ' this week' }), statTile('Views · 24 h', fmtNum(s.views_24h)), statTile('Failed jobs · 7 d', s.failed_jobs, { onclick: () => navigate('/admin/jobs') })));
    wrap.append(h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Views per day by platform'), lineChart(s.daily, { keys: ['vidtube', 'geotube'], labels: ['VidTube', 'GeoTube'] })));
    return wrap;
  }));

  /* ---------- GeoTube queue ---------- */
  function queueCard(item, { onDone = null, detail = false } = {}) {
    const node = h('div', { class: 'card mb16' });
    const check = item.check || { flags: [], positive: [], negative: [] };
    const note = h('textarea', { class: 'input', placeholder: 'Note to the creator (required when rejecting or restricting)', style: { minHeight: '60px' } });
    const act = async action => { try { await post(`/api/admin/queue/${item.video_id}/${item.platform}`, { action, note: note.value }); toast({ approve: 'Approved', reject: 'Rejected', restrict: 'Restricted' }[action]); if (onDone) onDone(); else navigate('/admin/queue'); } catch (e) { errToast(e); } };
    node.append(h('div', { class: 'queue-item' },
      h('div', detail && item.qualities.length ? h('div', { class: 'player-wrap' }, h('video', { controls: true, src: item.qualities[0].url, poster: fileUrl(item.thumb) || '' })) : h('a', { href: href('/admin/queue/' + item.video_id + '/' + item.platform) }, h('div', { class: 'thumb' }, item.thumb ? h('img', { src: fileUrl(item.thumb), alt: '' }) : null, item.duration ? h('span', { class: 'dur' }, fmtDur(item.duration)) : null)), item.asset_status !== 'ready' ? h('div', { class: 'tag info mt8' }, 'Media ' + item.asset_status) : null),
      h('div', h('div', { class: 'row wrap' }, ptag(item.platform), h('span', { class: 'tag' }, item.category || 'no category'), item.human_reviewed ? h('span', { class: 'tag warn' }, 'Previously reviewed') : null, h('span', { class: 'dim small' }, 'submitted ' + ago(item.updated_at))),
        h('h3', { class: 'mt8' }, detail ? item.title : h('a', { href: href('/admin/queue/' + item.video_id + '/' + item.platform) }, item.title)),
        h('div', { class: 'small muted' }, h('a', { class: 'hash', href: href('/@' + item.handle) }, (item.geo_separate && item.geo_name) || item.channel_name), ` · channel since ${fmtDate(item.channel_created)} · ${item.approved_before} approved, ${item.rejected_before} rejected on GeoTube before`),
        h('div', { class: 'mt8 small', style: { whiteSpace: 'pre-wrap', maxHeight: detail ? 'none' : '80px', overflow: 'hidden' } }, item.description || h('i', { class: 'dim' }, 'No description')),
        item.tags.length ? h('div', { class: 'row wrap mt8' }, item.tags.map(t => h('span', { class: 'tag' }, t))) : null,
        h('div', { class: 'mt8' }, check.flags.length ? check.flags.map(f => h('div', { class: 'flag' + (String(f.code).startsWith('sexual_content') ? ' bad' : '') }, icon('flag'), h('span', f.message))) : h('div', { class: 'flag ok' }, icon('check'), h('span', 'Automated check passed' + (check.mode === 'review_all' ? ' (manual review of everything is on)' : '')))),
        check.safety && check.safety.hits && check.safety.hits.length ? h('div', { class: 'small' }, h('b', 'Where: '), Object.entries(check.safety.fields || {}).map(([f, t]) => f + ' (' + t.join(', ') + ')').join(' · '), item.channel_flagged > 1 ? h('span', { class: 'tag bad', style: { marginLeft: '8px' } }, item.channel_flagged + ' flagged videos on this channel') : null, h('a', { class: 'hash', style: { marginLeft: '8px' }, href: href('/admin/channels?filter=flagged&q=' + encodeURIComponent(item.handle)) }, 'Check channel')) : null,
        check.positive && check.positive.length ? h('div', { class: 'small dim' }, 'Topic terms: ' + check.positive.join(', ')) : null, check.negative && check.negative.length ? h('div', { class: 'small dim' }, 'Unrelated terms: ' + check.negative.join(', ')) : null),
      h('div', { class: 'col', style: { minWidth: '220px' } }, note, h('button', { class: 'btn primary', onclick: () => act('approve') }, icon('check'), 'Approve'), h('button', { class: 'btn', onclick: () => act('restrict') }, 'Restrict'), h('button', { class: 'btn danger', onclick: () => act('reject') }, 'Reject'), h('a', { class: 'btn ghost sm', href: wlink(item.platform, item.video_id), target: '_blank' }, 'Open watch page'))));
    return node;
  }
  route('/admin/queue', ctx => shell(ctx, 'queue', async () => {
    const status = ctx.query.status || 'pending';
    const filter = ctx.query.filter || 'all';
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Review queue'), h('p', { class: 'muted small mb8' }, 'GeoTube topic checks and the sexual-content detector hold videos here. Nothing in this queue is visible to viewers until you decide.'));
    wrap.append(tabs([{ value: 'pending', label: 'Waiting' }, { value: 'history', label: 'Reviewed' }], status, s => navigate('/admin/queue?status=' + s + '&filter=' + filter)));
    wrap.append(chipsRow([{ value: 'all', label: 'Everything' }, { value: 'safety', label: 'Sexual-content flags' }], filter, f => navigate('/admin/queue?status=' + status + '&filter=' + f)));
    let page = 0; const list = h('div');
    const load = async () => { const d = await get(`/api/admin/queue?status=${status}&filter=${filter}&page=${page++}`); d.items.forEach(it => list.append(status === 'pending' ? queueCard(it, { onDone: () => VT.render() }) : h('div', { class: 'card mb8 row' }, h('div', { class: 'thumb', style: { width: '100px', flex: 'none' } }, it.thumb ? h('img', { src: fileUrl(it.thumb), alt: '' }) : null), h('div', { class: 'grow' }, h('a', { href: href('/admin/queue/' + it.video_id + '/' + it.platform) }, h('b', it.title)), h('div', { class: 'small muted' }, it.channel_name + ' · ' + ago(it.updated_at) + (it.review_note ? ' · ' + it.review_note : ''))), h('span', { class: 'tag ' + ({ approved: 'good', rejected: 'bad', restricted: 'warn', removed: 'bad' }[it.status] || '') }, it.status)))); if (page === 1 && !d.items.length) list.append(h('div', { class: 'empty' }, h('h3', 'Queue is empty'), h('p', 'Nothing waiting for review.'))); return d.more; };
    const more = await load(); wrap.append(list); if (more) wrap.append(pager(load));
    return wrap;
  }, 'Queue'));
  route('/admin/queue/:id/:platform', ctx => shell(ctx, 'queue', async () => {
    const it = await get(`/api/admin/queue/${ctx.params.id}/${ctx.params.platform}`);
    const wrap = h('div', h('div', { class: 'row mb16' }, h('a', { class: 'btn icon', href: href('/admin/queue') }, icon('back')), h('h1', 'Review submission')));
    wrap.append(queueCard(it, { detail: true }));
    if (it.status !== 'pending') wrap.append(h('div', { class: 'notice' }, 'Current status: ', h('b', it.status), it.review_note ? ' · ' + it.review_note : ''));
    if (it.decisions.length) wrap.append(h('div', { class: 'card mb16' }, h('h3', { class: 'mb8' }, 'Decision history'), it.decisions.map(d => h('div', { class: 'small mb8' }, h('b', d.action), ' · ' + fmtDateTime(d.created_at) + (d.reason ? ' · ' + d.reason : '')))));
    if (it.reports.length) wrap.append(h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Reports on this video'), it.reports.map(r => h('div', { class: 'small mb8' }, h('span', { class: 'tag' }, r.reason), ' ' + (r.details || '') + ' · ' + r.status))));
    return wrap;
  }, 'Review'));

  /* ---------- reports ---------- */
  route('/admin/reports', ctx => shell(ctx, 'reports', async () => {
    const status = ctx.query.status || 'open';
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Reports'));
    wrap.append(tabs([{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'dismissed', label: 'Dismissed' }], status, s => navigate('/admin/reports?status=' + s)));
    let page = 0; const list = h('div');
    const load = async () => {
      const d = await get(`/api/admin/reports?status=${status}&page=${page++}`);
      d.items.forEach(r => {
        const node = h('div', { class: 'card mb8' });
        const t = r.target || {};
        const resolution = h('input', { class: 'input', placeholder: 'Resolution note (optional)' });
        const measure = h('select', { class: 'select' }, [['none', 'No action'], ...(r.target_type === 'video' ? [['remove_video', 'Remove video'], ['restrict_video', 'Restrict video']] : r.target_type === 'comment' ? [['remove_comment', 'Remove comment'], ['suspend_user', 'Suspend user']] : []), ['suspend_channel', 'Suspend channel']].map(([v, l]) => h('option', { value: v }, l)));
        const act = async action => { try { await post('/api/admin/reports/' + r.id, { action, apply: measure.value, resolution: resolution.value }); toast('Report ' + action + 'd'); node.remove(); } catch (e) { errToast(e); } };
        node.append(h('div', { class: 'row wrap' }, h('span', { class: 'tag bad' }, r.reason.replace('_', ' ')), h('span', { class: 'tag' }, r.target_type), r.platform ? ptag(r.platform) : null, r.open_count > 1 ? h('span', { class: 'tag warn' }, r.open_count + ' open reports on this target') : null, h('span', { class: 'dim small' }, (r.reporter_email || 'anonymous') + ' · ' + ago(r.created_at))),
          h('div', { class: 'mt8' }, t.missing ? h('i', { class: 'dim' }, 'Target no longer exists') : h('a', { class: 'hash', href: t.link, target: '_blank' }, h('b', t.title || t.body || t.name || t.handle)), t.status ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, t.status) : null, t.suspended ? h('span', { class: 'tag bad', style: { marginLeft: '6px' } }, 'suspended') : null, t.handle && r.target_type !== 'channel' ? h('span', { class: 'dim small' }, ' · @' + t.handle) : null, t.email ? h('span', { class: 'dim small' }, ' · ' + t.email) : null),
          r.details ? h('div', { class: 'small muted mt8', style: { whiteSpace: 'pre-wrap' } }, r.details) : null,
          status === 'open' ? h('div', { class: 'row wrap mt8' }, measure, resolution, h('button', { class: 'btn primary', onclick: () => act('resolve') }, 'Resolve'), h('button', { class: 'btn', onclick: () => act('dismiss') }, 'Dismiss')) : h('div', { class: 'small dim mt8' }, (r.resolution || '') + ' · ' + fmtDateTime(r.resolved_at)));
        list.append(node);
      });
      if (page === 1 && !d.items.length) list.append(h('div', { class: 'empty' }, 'No ' + status + ' reports'));
      return d.more;
    };
    const more = await load(); wrap.append(list); if (more) wrap.append(pager(load));
    return wrap;
  }, 'Reports'));

  /* ---------- appeals + claims ---------- */
  route('/admin/appeals', ctx => shell(ctx, 'appeals', async () => {
    const status = ctx.query.status || 'open';
    const items = await get('/api/admin/appeals?status=' + status);
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Appeals'), tabs([{ value: 'open', label: 'Open' }, { value: 'granted', label: 'Granted' }, { value: 'denied', label: 'Denied' }], status, s => navigate('/admin/appeals?status=' + s)));
    items.forEach(a => {
      const node = h('div', { class: 'card mb8' }); const resp = h('input', { class: 'input', placeholder: 'Response to the creator' });
      const act = async action => { try { await post('/api/admin/appeals/' + a.id, { action, response: resp.value }); toast('Appeal ' + (action === 'grant' ? 'granted' : 'denied')); node.remove(); } catch (e) { errToast(e); } };
      node.append(h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('div', { class: 'thumb', style: { width: '140px', flex: 'none' } }, a.thumb ? h('img', { src: fileUrl(a.thumb), alt: '' }) : null), h('div', { class: 'grow' }, h('div', { class: 'row wrap' }, ptag(a.platform), h('span', { class: 'tag bad' }, a.pub_status || 'unknown'), h('span', { class: 'dim small' }, '@' + a.handle + ' · ' + ago(a.created_at))), h('a', { class: 'hash', href: wlink(a.platform, a.video_id), target: '_blank' }, h('b', a.title || a.video_id)), a.review_note ? h('div', { class: 'small muted' }, 'Original note: ' + a.review_note) : null, h('div', { class: 'mt8', style: { whiteSpace: 'pre-wrap' } }, a.text),
        status === 'open' ? h('div', { class: 'row wrap mt8' }, resp, h('button', { class: 'btn primary', onclick: () => act('grant') }, 'Grant (approve video)'), h('button', { class: 'btn', onclick: () => act('deny') }, 'Deny')) : h('div', { class: 'small dim mt8' }, (a.response || '') + ' · ' + fmtDateTime(a.resolved_at)))));
      wrap.append(node);
    });
    if (!items.length) wrap.append(h('div', { class: 'empty' }, 'No ' + status + ' appeals'));
    return wrap;
  }, 'Appeals'));
  route('/admin/claims', ctx => shell(ctx, 'claims', async () => {
    const status = ctx.query.status || 'open';
    const items = await get('/api/admin/claims?status=' + status);
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Copyright claims'), tabs([{ value: 'open', label: 'Open' }, { value: 'upheld', label: 'Upheld' }, { value: 'rejected', label: 'Rejected' }], status, s => navigate('/admin/claims?status=' + s)));
    items.forEach(c => {
      const node = h('div', { class: 'card mb8' }); const resp = h('input', { class: 'input', placeholder: 'Response' });
      const act = async action => { if (action === 'uphold' && !(await confirm('Uphold claim', 'The video is removed from every platform.', { danger: true, ok: 'Remove video' }))) return; try { await post('/api/admin/claims/' + c.id, { action, response: resp.value }); toast('Claim ' + action + 'ed'); node.remove(); } catch (e) { errToast(e); } };
      node.append(h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('div', { class: 'thumb', style: { width: '140px', flex: 'none' } }, c.thumb ? h('img', { src: fileUrl(c.thumb), alt: '' }) : null), h('div', { class: 'grow' }, h('div', { class: 'small dim' }, c.claimant_email + ' claims against @' + c.channel_handle + ' · ' + ago(c.created_at)), h('a', { class: 'hash', href: wlink('vidtube', c.video_id), target: '_blank' }, h('b', c.title || c.video_id)), h('div', { class: 'mt8' }, h('b', 'Work: '), c.work), h('div', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, c.details),
        status === 'open' ? h('div', { class: 'row wrap mt8' }, resp, h('button', { class: 'btn danger', onclick: () => act('uphold') }, 'Uphold & remove'), h('button', { class: 'btn', onclick: () => act('reject') }, 'Reject claim')) : h('div', { class: 'small dim mt8' }, (c.response || '') + ' · ' + fmtDateTime(c.resolved_at)))));
      wrap.append(node);
    });
    if (!items.length) wrap.append(h('div', { class: 'empty' }, 'No ' + status + ' claims'));
    return wrap;
  }, 'Claims'));

  /* ---------- find video ---------- */
  route('/admin/videos', ctx => shell(ctx, 'videos', async () => {
    const q = ctx.query.q || '';
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Find a video'), h('input', { class: 'input mb16', style: { maxWidth: '420px' }, placeholder: 'Title, video ID or channel handle', value: q, onkeydown: e => { if (e.key === 'Enter') navigate('/admin/videos?q=' + encodeURIComponent(e.target.value)); } }));
    if (!q) return wrap;
    const d = await get('/api/admin/videos?q=' + encodeURIComponent(q));
    d.items.forEach(it => {
      const node = h('div', { class: 'card mb8 row', style: { alignItems: 'flex-start' } });
      const act = async action => { const note = action === 'remove' || action === 'restrict' ? await prompt('Note to the creator', { label: 'Why?' }) : ''; if (note === null) return; try { await post(`/api/admin/videos/${it.video_id}/${it.platform}`, { action, note }); toast('Done'); VT.render(); } catch (e) { errToast(e); } };
      node.append(h('div', { class: 'thumb', style: { width: '120px', flex: 'none' } }, it.thumb ? h('img', { src: fileUrl(it.thumb), alt: '' }) : null), h('div', { class: 'grow' }, h('div', { class: 'row wrap' }, ptag(it.platform), h('span', { class: 'tag' }, it.visibility), h('span', { class: 'tag ' + ({ approved: 'good', pending: 'warn', rejected: 'bad', removed: 'bad', restricted: 'warn' }[it.status]) }, it.status)), h('a', { class: 'hash', href: wlink(it.platform, it.video_id), target: '_blank' }, h('b', it.title)), h('div', { class: 'small muted' }, '@' + it.handle + ' · ' + it.video_id + ' · ' + ago(it.updated_at))),
        h('div', { class: 'col' }, it.status !== 'approved' ? h('button', { class: 'btn sm primary', onclick: () => act(it.status === 'removed' ? 'restore' : 'approve') }, it.status === 'removed' ? 'Restore' : 'Approve') : null, it.status !== 'restricted' ? h('button', { class: 'btn sm', onclick: () => act('restrict') }, 'Restrict') : null, it.status !== 'removed' ? h('button', { class: 'btn sm danger', onclick: () => act('remove') }, 'Remove') : null));
      wrap.append(node);
    });
    if (!d.items.length) wrap.append(h('div', { class: 'empty' }, 'No videos found'));
    return wrap;
  }, 'Find video'));

  /* ---------- users + channels ---------- */
  route('/admin/users', ctx => shell(ctx, 'users', async () => {
    const q = ctx.query.q || '';
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Users'), h('input', { class: 'input mb16', style: { maxWidth: '420px' }, placeholder: 'Search email, handle or name', value: q, onkeydown: e => { if (e.key === 'Enter') navigate('/admin/users?q=' + encodeURIComponent(e.target.value)); } }));
    let page = 0; const tbody = h('tbody');
    const load = async () => {
      const d = await get(`/api/admin/users?q=${encodeURIComponent(q)}&page=${page++}`);
      d.items.forEach(u => tbody.append(h('tr', h('td', h('b', u.email), u.is_demo ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, 'demo') : null, h('div', { class: 'small muted' }, 'joined ' + fmtDate(u.created_at) + (u.email_verified ? '' : ' · unverified'))), h('td', u.handle ? h('a', { class: 'hash', href: href('/@' + u.handle) }, '@' + u.handle) : h('span', { class: 'dim' }, 'no channel')), h('td', { class: 'num' }, u.videos || 0), h('td', { class: 'num' }, u.comments || 0),
        h('td', isAdmin() ? h('select', { class: 'select', style: { width: 'auto', height: '32px' }, onchange: async e => { try { await patch('/api/admin/users/' + u.id, { role: e.target.value }); toast('Role updated'); } catch (err) { errToast(err); VT.render(); } } }, ['user', 'creator', 'moderator', 'admin'].map(r => h('option', { value: r, selected: u.role === r }, r))) : u.role),
        h('td', h('span', { class: 'tag ' + (u.status === 'active' ? 'good' : 'bad') }, u.status), isAdmin() ? h('div', { class: 'row mt8', style: { gap: '6px' } }, ['owner', 'moderator'].map(b => h('button', { class: 'btn xs' + ((u.badges || []).includes(b) ? ' active' : ''), title: b === 'owner' ? 'VidTube Owner badge (only one account can have it)' : 'VidTube Moderator badge', onclick: async e => { const on = !(u.badges || []).includes(b); try { const r = await put('/api/admin/users/' + u.id + '/badges', { [b]: on }); u.badges = r.badges; e.currentTarget.classList.toggle('active', on); toast(on ? 'Badge given' : 'Badge removed'); } catch (err) { errToast(err); } } }, h('img', { class: 'badge', src: `/img/badges/${b}.png`, alt: '' }), b === 'owner' ? 'Owner' : 'Moderator'))) : VT.badgeIcons(u.badges)),
        h('td', isAdmin() && u.id !== state.user.id ? h('button', { class: 'btn xs ' + (u.status === 'active' ? 'danger' : ''), onclick: async () => { const on = u.status === 'active'; const note = on ? await prompt('Suspend user', { label: 'Reason sent to the user' }) : ''; if (note === null) return; try { await patch('/api/admin/users/' + u.id, { status: on ? 'suspended' : 'active', note }); toast(on ? 'User suspended' : 'User reinstated'); VT.render(); } catch (e) { errToast(e); } } }, u.status === 'active' ? 'Suspend' : 'Reinstate') : null))));
      if (page === 1 && !d.items.length) tbody.append(h('tr', h('td', { colspan: 7 }, h('div', { class: 'empty' }, 'No users found'))));
      return d.more;
    };
    const more = await load();
    wrap.append(h('div', { class: 'card pad0' }, h('table', { class: 'table' }, h('thead', h('tr', h('th', 'User'), h('th', 'Channel'), h('th', { class: 'num' }, 'Videos'), h('th', { class: 'num' }, 'Comments'), h('th', 'Role'), h('th', 'Status'), h('th'))), tbody)));
    if (more) wrap.append(pager(load));
    return wrap;
  }, 'Users'));
  route('/admin/channels', ctx => shell(ctx, 'channels', async () => {
    const q = ctx.query.q || '', filter = ctx.query.filter || 'all';
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Channels'), h('div', { class: 'row wrap mb16' }, h('input', { class: 'input', style: { maxWidth: '320px' }, placeholder: 'Search', value: q, onkeydown: e => { if (e.key === 'Enter') navigate(`/admin/channels?filter=${filter}&q=` + encodeURIComponent(e.target.value)); } }), chipsRow([{ value: 'all', label: 'All' }, { value: 'verified', label: 'Verified' }, { value: 'suspended', label: 'Suspended' }, { value: 'monetization', label: 'Monetisation applications' }, { value: 'partners', label: 'Partners' }, { value: 'flagged', label: 'Flagged for sexual content' }], filter, f => navigate(`/admin/channels?filter=${f}&q=${encodeURIComponent(q)}`))));
    let page = 0; const tbody = h('tbody');
    const upd = async (c, body, msg) => { try { await patch('/api/admin/channels/' + c.id, body); toast(msg || 'Updated'); VT.render(); } catch (e) { errToast(e); } };
    const load = async () => {
      const d = await get(`/api/admin/channels?q=${encodeURIComponent(q)}&filter=${filter}&page=${page++}`);
      d.items.forEach(c => tbody.append(h('tr', h('td', h('div', { class: 'row' }, avatar(c.avatar, c.name), h('div', h('a', { class: 'hash', href: href('/@' + c.handle) }, h('b', c.name)), c.is_verified ? icon('verified', 'verified') : null, h('div', { class: 'small muted' }, '@' + c.handle + ' · ' + c.email)))), h('td', { class: 'num' }, fmtNum(c.subscribers)), h('td', { class: 'num' }, c.videos), h('td', h('span', { class: 'tag ' + (c.monetization === 'approved' ? 'good' : c.monetization === 'applied' ? 'warn' : '') }, c.monetization || 'not applied')),
        h('td', c.suspended ? h('span', { class: 'tag bad' }, 'suspended') : h('span', { class: 'tag good' }, 'active'), c.flagged ? h('a', { class: 'tag bad', style: { marginLeft: '6px' }, href: href('/admin/queue?filter=safety') }, c.flagged + ' flagged') : null),
        h('td', h('button', { class: 'btn icon', onclick: e => menu(e.currentTarget, [
          { icon: 'verified', label: c.is_verified ? 'Remove verification' : 'Verify channel', fn: () => upd(c, { is_verified: !c.is_verified }) },
          { icon: 'lock', label: c.suspended ? 'Reinstate channel' : 'Suspend channel', danger: !c.suspended, fn: async () => { const note = c.suspended ? '' : await prompt('Suspend channel', { label: 'Reason sent to the owner' }); if (note === null) return; upd(c, { suspended: !c.suspended, note }); } },
          isAdmin() && c.monetization === 'applied' ? '-' : null, isAdmin() && c.monetization === 'applied' ? { icon: 'money', label: 'Approve monetisation', fn: () => upd(c, { monetization: 'approved' }) } : null, isAdmin() && c.monetization === 'applied' ? { icon: 'close', label: 'Reject monetisation', fn: async () => { const note = await prompt('Reject application', { label: 'Reason' }); if (note !== null) upd(c, { monetization: 'rejected', note }); } } : null,
          isAdmin() && c.monetization === 'approved' ? { icon: 'close', label: 'Remove from partner programme', fn: () => upd(c, { monetization: 'not_applied' }) } : null,
        ]) }, icon('more'))))));
      if (page === 1 && !d.items.length) tbody.append(h('tr', h('td', { colspan: 6 }, h('div', { class: 'empty' }, 'No channels found'))));
      return d.more;
    };
    const more = await load();
    wrap.append(h('div', { class: 'card pad0' }, h('table', { class: 'table' }, h('thead', h('tr', h('th', 'Channel'), h('th', { class: 'num' }, 'Subs'), h('th', { class: 'num' }, 'Videos'), h('th', 'Monetisation'), h('th', 'Status'), h('th'))), tbody)));
    if (more) wrap.append(pager(load));
    return wrap;
  }, 'Channels'));

  /* ---------- categories ---------- */
  route('/admin/categories', ctx => shell(ctx, 'categories', async () => {
    const cats = await get('/api/admin/categories');
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Categories'));
    for (const platform of ['vidtube', 'geotube']) {
      const name = h('input', { class: 'input', placeholder: 'New category name' }), slug = h('input', { class: 'input', placeholder: 'slug (optional)' });
      wrap.append(h('div', { class: 'card mb16' }, h('h3', { class: 'mb8' }, platformName(platform)), h('table', { class: 'table' }, h('thead', h('tr', h('th', 'Name'), h('th', 'Slug'), h('th', 'Sort'), h('th', 'Active'), h('th'))), h('tbody', cats.filter(c => c.platform === platform).map(c => h('tr',
        h('td', h('input', { class: 'input', value: c.name, style: { height: '32px' }, onchange: e => patch('/api/admin/categories/' + c.id, { name: e.target.value }).then(() => { toast('Saved'); state.cats = {}; }).catch(errToast) })), h('td', { class: 'dim' }, c.slug), h('td', h('input', { class: 'input', type: 'number', value: c.sort, style: { width: '70px', height: '32px' }, onchange: e => patch('/api/admin/categories/' + c.id, { sort: Number(e.target.value) }).then(() => { toast('Saved'); state.cats = {}; }).catch(errToast) })),
        h('td', h('button', { class: 'toggle' + (c.active ? ' on' : ''), onclick: e => patch('/api/admin/categories/' + c.id, { active: !e.currentTarget.classList.contains('on') }).then(() => { e.target.classList.toggle('on'); state.cats = {}; }).catch(errToast) })),
        h('td', h('button', { class: 'btn xs ghost', onclick: async () => { if (await confirm('Delete category', c.name + ' will be deleted.', { danger: true, ok: 'Delete' })) { try { await del('/api/admin/categories/' + c.id); state.cats = {}; VT.render(); } catch (e) { errToast(e); } } } }, icon('trash'))))))),
        h('div', { class: 'row mt8' }, name, slug, h('button', { class: 'btn primary', onclick: async () => { try { await post('/api/admin/categories', { platform, name: name.value, slug: slug.value }); state.cats = {}; VT.render(); } catch (e) { errToast(e); } } }, 'Add'))));
    }
    return wrap;
  }, 'Categories'));

  /* ---------- settings ---------- */
  route('/admin/settings', ctx => shell(ctx, 'settings', async () => {
    const s = await get('/api/admin/settings');
    const g = s.geotube;
    const mode = h('select', { class: 'select' }, h('option', { value: 'review_flagged', selected: g.mode === 'review_flagged' }, 'Publish clean submissions immediately, review flagged ones'), h('option', { value: 'review_all', selected: g.mode === 'review_all' }, 'Review every GeoTube submission manually'));
    const first = h('input', { type: 'checkbox', checked: g.reviewFirstUpload });
    const pos = h('textarea', { class: 'input', style: { minHeight: '120px' } }, g.positive.join('\n')), neg = h('textarea', { class: 'input', style: { minHeight: '120px' } }, g.negative.join('\n'));
    const maxMb = h('input', { class: 'input', type: 'number', value: s.uploads.maxVideoMB, min: 10, max: 10000 });
    const mon = h('input', { type: 'checkbox', checked: s.monetization.enabled });
    const sf = s.safety;
    const ads = await get('/api/admin/ads');
    const adOn = h('input', { type: 'checkbox', checked: !!ads.enabled }), adPre = h('input', { type: 'checkbox', checked: !!ads.preroll });
    const adChance = h('input', { class: 'input', type: 'number', min: 0, max: 100, value: ads.prerollChance, style: { width: '90px' } });
    const adMin = h('input', { class: 'input', type: 'number', min: 1, max: 60, value: ads.prerollMin, style: { width: '80px' } }), adMax = h('input', { class: 'input', type: 'number', min: 1, max: 60, value: ads.prerollMax, style: { width: '80px' } });
    const adChecks = ads.channels.map(c => ({ c, box: h('input', { type: 'checkbox', checked: c.enabled !== false }) }));
    const saveAds = async () => { try { await put('/api/admin/settings/ads', { enabled: adOn.checked, preroll: adPre.checked, prerollChance: Number(adChance.value), prerollMin: Number(adMin.value), prerollMax: Number(adMax.value), enabledChannels: adChecks.filter(x => x.box.checked).map(x => x.c.id) }); toast('Ad settings saved'); } catch (e) { errToast(e); } };
    const hw = s.halloween || { enabled: true, goal: 10, alwaysOn: false };
    const hwOn = h('input', { type: 'checkbox', checked: !!hw.enabled }), hwAlways = h('input', { type: 'checkbox', checked: !!hw.alwaysOn }), hwGoal = h('input', { class: 'input', type: 'number', value: hw.goal, min: 1, max: 1000, style: { width: '120px' } });
    const saveHw = async () => { try { await put('/api/admin/settings/halloween', { enabled: hwOn.checked, alwaysOn: hwAlways.checked, goal: Number(hwGoal.value) }); toast('Halloween settings saved · reload to see the logo change'); } catch (e) { errToast(e); } };
    const safeOn = h('input', { type: 'checkbox', checked: !!sf.enabled });
    const safeTerms = h('textarea', { class: 'input', style: { minHeight: '160px' } }, sf.terms.join('\n'));
    const saveSafety = async () => { try { const r = await put('/api/admin/settings/safety', { enabled: safeOn.checked, terms: safeTerms.value.split('\n').map(x => x.trim()).filter(Boolean) }); toast('Detector settings saved' + (r.held ? ' · ' + r.held + ' video(s) held for review' : '')); } catch (e) { errToast(e); } };
    const saveG = async () => { try { await put('/api/admin/settings/geotube', { mode: mode.value, reviewFirstUpload: first.checked, positive: pos.value.split('\n').map(x => x.trim()).filter(Boolean), negative: neg.value.split('\n').map(x => x.trim()).filter(Boolean) }); toast('GeoTube settings saved'); } catch (e) { errToast(e); } };
    return h('div', h('h1', { class: 'mb16' }, 'Platform settings'),
      h('div', { class: 'card mb16 settings' }, h('h3', { class: 'mb8' }, 'GeoTube eligibility'), h('div', { class: 'field' }, h('label', 'Review mode'), mode), h('label', { class: 'check' }, first, h('div', h('b', 'Always review the first GeoTube upload of a channel'))),
        h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '16px' } }, h('div', { class: 'field grow' }, h('label', 'On-topic terms (one per line)'), pos, h('div', { class: 'hint' }, 'At least one must appear in the title, description or tags.')), h('div', { class: 'field grow' }, h('label', 'Off-topic terms'), neg, h('div', { class: 'hint' }, 'Flagged when these outweigh the on-topic terms.'))), h('button', { class: 'btn primary', onclick: saveG }, 'Save')),
      h('div', { class: 'card mb16 settings' }, h('h3', { class: 'mb8' }, 'Sexual-content detector'),
        h('p', { class: 'small muted' }, 'Titles, descriptions, tags and channel texts are checked against this list. One match is enough: the video is held and a moderator or administrator must approve it before anyone can watch it. The detector reads text only, not the video itself.'),
        h('label', { class: 'check' }, safeOn, h('div', h('b', 'Detector on'), h('span', 'When off, nothing is held automatically.'))),
        h('div', { class: 'field' }, h('label', 'Terms (one per line)'), safeTerms),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: saveSafety }, 'Save and rescan'), h('button', { class: 'btn', onclick: async () => { try { const r = await post('/api/admin/safety/scan', {}); toast(r.held ? r.held + ' video(s) held for review' : 'Nothing new to hold'); } catch (e) { errToast(e); } } }, 'Rescan all videos now'))),
      h('div', { class: 'card mb16 settings' }, h('h3', { class: 'mb8' }, 'Ads for friendly YouTube / TikTok channels'),
        h('p', { class: 'small muted' }, 'One banner per page, a different channel every time (refresh, or going from a video to the home page). In videos, never in Shorts, there is sometimes a pre-roll of a few seconds before the video starts.'),
        h('label', { class: 'check' }, adOn, h('div', h('b', 'Ads on'))),
        h('label', { class: 'check' }, adPre, h('div', h('b', 'Pre-roll in videos'))),
        h('div', { class: 'row wrap', style: { alignItems: 'flex-end' } }, h('div', { class: 'field' }, h('label', 'Chance per video (%)'), adChance), h('div', { class: 'field' }, h('label', 'Shortest (s)'), adMin), h('div', { class: 'field' }, h('label', 'Longest (s)'), adMax)),
        h('table', { class: 'table mt8' }, h('thead', h('tr', h('th', 'Channel'), h('th', 'Shown'), h('th', 'Clicked'), h('th', 'On'))), h('tbody', adChecks.map(({ c, box }) => h('tr', h('td', h('div', { class: 'row' }, h('img', { src: c.avatar, alt: '', style: { width: '28px', height: '28px', borderRadius: '50%' } }), h('div', h('a', { class: 'hash', href: c.url, target: '_blank', rel: 'noopener' }, h('b', c.name)), h('div', { class: 'small muted' }, c.handle + ' · ' + c.tagline)))), h('td', { class: 'num' }, fmtNum(c.impressions || 0)), h('td', { class: 'num' }, fmtNum(c.clicks || 0)), h('td', box))))),
        h('button', { class: 'btn primary mt8', onclick: saveAds }, 'Save')),
      h('div', { class: 'card mb16 settings' }, h('h3', { class: 'mb8' }, '🎃 Halloween event'),
        h('p', { class: 'small muted' }, 'Runs from 1 October to 1 November: pumpkin logo, and viewers who start enough videos or Shorts unlock a GIF maker (a piece of any video becomes a GIF, made with FFmpeg). Those GIFs appear under "My GIFs" in the GIF picker and can only be used by the account that made them.'),
        h('label', { class: 'check' }, hwOn, h('div', h('b', 'Event on'))),
        h('label', { class: 'check' }, hwAlways, h('div', h('b', 'Ignore the dates'), h('span', 'Run the event all year (handy for testing).'))),
        h('div', { class: 'field' }, h('label', 'Videos to watch before the GIF maker unlocks'), hwGoal),
        h('button', { class: 'btn primary', onclick: saveHw }, 'Save')),
      h('div', { class: 'card mb16 settings' }, h('h3', { class: 'mb8' }, 'Uploads'), h('div', { class: 'field' }, h('label', 'Maximum video size (MB)'), maxMb), h('button', { class: 'btn primary', onclick: () => put('/api/admin/settings/uploads', { maxVideoMB: Number(maxMb.value) }).then(() => toast('Saved')).catch(errToast) }, 'Save')),
      h('div', { class: 'card settings' }, h('h3', { class: 'mb8' }, 'Monetisation'), h('label', { class: 'check' }, mon, h('div', h('b', 'Open the partner programme'), h('span', 'Creators with 100 subscribers and 50 watch hours can apply from Studio.'))), h('button', { class: 'btn primary', onclick: () => put('/api/admin/settings/monetization', { enabled: mon.checked }).then(() => toast('Saved')).catch(errToast) }, 'Save')));
  }, 'Settings'));

  /* ---------- YouTube auto-import ---------- */
  route('/admin/youtube', ctx => shell(ctx, 'youtube', async () => {
    const d = await get('/api/admin/youtube');
    const s = d.settings;
    const on = h('input', { type: 'checkbox', checked: !!s.enabled });
    const every = h('input', { class: 'input', type: 'number', min: 1, max: 1440, value: s.intervalMinutes, style: { width: '110px' } });
    const maxH = h('select', { class: 'select' }, [720, 1080, 1280, 1920, 2160].map(v => h('option', { value: v, selected: s.maxHeight === v }, v + ' px')));
    const save = async () => { try { await put('/api/admin/settings/youtube', { enabled: on.checked, intervalMinutes: Number(every.value), maxHeight: Number(maxH.value) }); toast('Saved'); } catch (e) { errToast(e); } };
    const handleIn = h('input', { class: 'input', placeholder: '@handle or channel link' }), targetIn = h('input', { class: 'input', placeholder: 'auto' });
    const add = async () => { try { await post('/api/admin/youtube/sources', { handle: handleIn.value, target: targetIn.value || 'auto' }); toast('Channel followed'); VT.render(); } catch (e) { errToast(e); } };
    const stTag = st => h('span', { class: 'tag ' + ({ done: 'good', failed: 'bad', downloading: 'info', queued: 'info' }[st] || '') }, st === 'seen' ? 'not imported' : st);
    const act = (url, msg) => async () => { try { const r = await post(url, {}); toast(typeof msg === 'function' ? msg(r) : msg); VT.render(); } catch (e) { errToast(e); } };
    const sourceRow = src => h('tr',
      h('td', h('a', { class: 'hash', href: 'https://www.youtube.com/@' + src.handle, target: '_blank', rel: 'noopener' }, h('b', src.title || src.handle)), h('div', { class: 'small muted' }, '@' + src.handle)),
      h('td', src.target_channel ? h('a', { class: 'hash', href: href('/@' + src.target_channel.handle) }, src.target_channel.name) : h('span', { class: 'muted small' }, src.target === 'auto' ? 'its own channel (made at the first import)' : '@' + src.target)),
      h('td', { class: 'small' }, src.counts.done + ' imported', src.counts.waiting ? h('div', { class: 'info' }, src.counts.waiting + ' waiting') : null, src.counts.failed ? h('div', { class: 'bad' }, src.counts.failed + ' failed') : null),
      h('td', { class: 'small' }, src.last_checked_at ? ago(src.last_checked_at) : 'never', src.last_error ? h('div', { class: 'bad' }, src.last_error) : null),
      h('td', h('button', { class: 'toggle' + (src.enabled ? ' on' : ''), 'aria-label': 'On', onclick: async e => { const btn = e.currentTarget; try { await patch('/api/admin/youtube/sources/' + encodeURIComponent(src.handle), { enabled: !btn.classList.contains('on') }); btn.classList.toggle('on'); } catch (err) { errToast(err); } } })),
      h('td', h('div', { class: 'row wrap' },
        src.counts.seen ? h('button', { class: 'btn xs', onclick: async () => { if (!await confirm('Import older videos?', 'The ' + src.counts.seen + ' videos in the feed that were already on YouTube before this channel was followed will be downloaded and put on VidTube one by one.', { ok: 'Import' })) return; act('/api/admin/youtube/sources/' + encodeURIComponent(src.handle) + '/import-all', r => r.queued + ' video(s) queued')(); } }, 'Import ' + src.counts.seen + ' older') : null,
        h('button', { class: 'btn xs', onclick: async () => { const t = await prompt('VidTube channel for @' + src.handle, { label: 'Handle of the VidTube channel, or "auto" for its own channel', value: src.target }); if (t === null) return; try { await patch('/api/admin/youtube/sources/' + encodeURIComponent(src.handle), { target: t }); toast('Saved'); VT.render(); } catch (e) { errToast(e); } } }, 'Target'),
        h('button', { class: 'btn xs danger', onclick: async () => { if (!await confirm('Stop following @' + src.handle + '?', 'Videos that were already imported stay on VidTube.', { danger: true, ok: 'Remove' })) return; try { await del('/api/admin/youtube/sources/' + encodeURIComponent(src.handle)); VT.render(); } catch (e) { errToast(e); } } }, 'Remove'))));
    const importRow = i => h('tr',
      h('td', h('a', { class: 'hash', href: 'https://www.youtube.com/watch?v=' + i.yt_id, target: '_blank', rel: 'noopener' }, i.title || i.yt_id), i.error ? h('div', { class: 'bad small' }, i.error) : null),
      h('td', { class: 'small' }, i.channel_title || '@' + i.handle),
      h('td', { class: 'small' }, i.published_at ? ago(i.published_at) : ''),
      h('td', stTag(i.status), i.status === 'done' && i.video_id ? h('a', { class: 'btn xs ghost', href: '/watch?v=' + i.video_id }, 'Open') : null),
      h('td', ['seen', 'failed'].includes(i.status) ? h('button', { class: 'btn xs', onclick: act('/api/admin/youtube/imports/' + i.yt_id + '/import', 'Queued') }, i.status === 'failed' ? 'Retry' : 'Import') : null));
    return h('div', h('h1', { class: 'mb16' }, 'YouTube import'),
      h('p', { class: 'muted small mb8' }, 'Every followed YouTube channel is checked through its public feed. A new video or Short is downloaded with yt-dlp and put on VidTube by itself, a few minutes after it appears on YouTube. Videos that were already on YouTube before a channel was followed are only listed; press "Import" to fetch those too.'),
      !d.ffmpeg ? h('div', { class: 'notice bad' }, h('b', 'FFmpeg is not installed. '), 'Nothing can be imported until it is.') : null,
      !d.ytdlp.path ? h('div', { class: 'notice bad' }, h('b', 'yt-dlp was not found. '), 'Press "Install yt-dlp" below; the server downloads it from GitHub.') : null,
      h('div', { class: 'card mb16 settings' },
        h('div', { class: 'row wrap', style: { justifyContent: 'space-between' } }, h('h3', 'Settings'), h('div', { class: 'row small muted' }, 'yt-dlp ' + (d.ytdlp.version || 'missing'), h('button', { class: 'btn xs', onclick: act('/api/admin/youtube/update', r => (r.path ? 'yt-dlp ' + r.version + ' is ready' : 'yt-dlp could not be installed')) }, d.ytdlp.path ? 'Update yt-dlp' : 'Install yt-dlp'))),
        h('label', { class: 'check' }, on, h('div', h('b', 'Automatic import on'), h('span', 'When off, the feeds are not checked and the queue waits.'))),
        h('div', { class: 'row wrap', style: { alignItems: 'flex-end' } }, h('div', { class: 'field' }, h('label', 'Check YouTube every (minutes)'), every), h('div', { class: 'field' }, h('label', 'Download at most (longest side)'), maxH)),
        h('button', { class: 'btn primary', onclick: save }, 'Save')),
      h('div', { class: 'card mb16' },
        h('div', { class: 'row wrap', style: { justifyContent: 'space-between' } }, h('h3', 'Followed YouTube channels'), h('button', { class: 'btn sm', onclick: act('/api/admin/youtube/check', r => (r.queued ? r.queued + ' new video(s) queued' : 'Nothing new on YouTube')) }, icon('clock'), 'Check now')),
        d.busy ? h('div', { class: 'small info mt8' }, 'Downloading ' + d.busy + ' now…') : null,
        h('table', { class: 'table mt8' }, h('thead', h('tr', h('th', 'YouTube channel'), h('th', 'On VidTube as'), h('th', 'Videos'), h('th', 'Last check'), h('th', 'On'), h('th'))), h('tbody', d.sources.length ? d.sources.map(sourceRow) : h('tr', h('td', { colspan: 6, class: 'muted' }, 'No channels followed yet.')))),
        h('div', { class: 'row wrap mt8', style: { alignItems: 'flex-end' } }, h('div', { class: 'field grow' }, h('label', 'Follow a YouTube channel'), handleIn), h('div', { class: 'field' }, h('label', 'VidTube channel (handle), or auto'), targetIn), h('button', { class: 'btn primary', onclick: add }, 'Follow'))),
      h('div', { class: 'card pad0' }, h('table', { class: 'table' }, h('thead', h('tr', h('th', 'Video'), h('th', 'YouTube channel'), h('th', 'On YouTube'), h('th', 'Status'), h('th'))), h('tbody', d.imports.length ? d.imports.map(importRow) : h('tr', h('td', { colspan: 5, class: 'muted' }, 'No videos seen yet.'))))));
  }, 'YouTube import'));

  /* ---------- announcements, jobs, audit ---------- */
  route('/admin/announcements', ctx => shell(ctx, 'announcements', async () => {
    const items = await get('/api/admin/announcements');
    const title = h('input', { class: 'input', placeholder: 'Title' }), body = h('textarea', { class: 'input', placeholder: 'Message shown on the home page and Studio dashboard' });
    return h('div', h('h1', { class: 'mb16' }, 'Announcements'), h('div', { class: 'card mb16' }, h('div', { class: 'field' }, h('label', 'Title'), title), h('div', { class: 'field' }, h('label', 'Body'), body), h('button', { class: 'btn primary', onclick: async () => { try { await post('/api/admin/announcements', { title: title.value, body: body.value }); VT.render(); } catch (e) { errToast(e); } } }, 'Publish')),
      items.map(a => h('div', { class: 'card mb8 row' }, h('div', { class: 'grow' }, h('b', a.title), h('div', { class: 'small muted' }, a.body), h('div', { class: 'small dim' }, fmtDateTime(a.created_at))), h('button', { class: 'toggle' + (a.active ? ' on' : ''), onclick: e => patch('/api/admin/announcements/' + a.id, { active: !e.currentTarget.classList.contains('on') }).then(() => e.target.classList.toggle('on')).catch(errToast) }))));
  }, 'Announcements'));
  route('/admin/jobs', ctx => shell(ctx, 'jobs', async () => {
    const jobs = await get('/api/admin/jobs');
    return h('div', h('h1', { class: 'mb16' }, 'Processing jobs'), h('div', { class: 'card pad0' }, h('table', { class: 'table' }, h('thead', h('tr', h('th', 'File'), h('th', 'Status'), h('th', 'Created'), h('th', 'Error'), h('th'))), h('tbody', jobs.map(j => h('tr', h('td', j.original_name || j.asset_id), h('td', h('span', { class: 'tag ' + ({ done: 'good', failed: 'bad', running: 'info', queued: '' }[j.status]) }, j.status)), h('td', ago(j.created_at)), h('td', { class: 'small muted' }, j.error || ''), h('td', j.status === 'failed' ? h('button', { class: 'btn xs', onclick: () => post(`/api/admin/jobs/${j.id}/retry`).then(() => { toast('Re-queued'); VT.render(); }).catch(errToast) }, 'Retry') : null)))))));
  }, 'Jobs'));
  route('/admin/outbox', ctx => shell(ctx, 'outbox', async () => {
    const d = await get('/api/admin/outbox');
    return h('div', h('h1', { class: 'mb16' }, 'Mail outbox'), h('div', { class: 'notice ' + (d.smtp ? 'good' : 'warn') }, d.smtp ? 'SMTP is configured: these messages were sent by email.' : 'No SMTP configured (config.json): messages are only stored here and not sent.'),
      h('div', { class: 'card pad0' }, h('table', { class: 'table' }, h('thead', h('tr', h('th', 'When'), h('th', 'To'), h('th', 'Subject'), h('th', 'Message'))), h('tbody', d.items.map(m => h('tr', h('td', { class: 'small' }, fmtDateTime(m.created_at)), h('td', m.to_email), h('td', m.subject), h('td', { class: 'small muted', style: { whiteSpace: 'pre-wrap' } }, m.body)))))));
  }, 'Mail outbox'));
  route('/admin/audit', ctx => shell(ctx, 'audit', async () => {
    let page = 0; const tbody = h('tbody');
    const load = async () => { const d = await get('/api/admin/audit?page=' + page++); d.items.forEach(a => tbody.append(h('tr', h('td', { class: 'small' }, fmtDateTime(a.created_at)), h('td', a.actor || 'system'), h('td', h('code', a.action)), h('td', { class: 'small' }, (a.target_type || '') + ' ' + (a.target_id || '')), h('td', { class: 'small muted' }, a.details ? JSON.stringify(a.details) : '')))); return d.more; };
    const more = await load();
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Audit log'), h('div', { class: 'card pad0' }, h('table', { class: 'table' }, h('thead', h('tr', h('th', 'When'), h('th', 'Who'), h('th', 'Action'), h('th', 'Target'), h('th', 'Details'))), tbody)));
    if (more) wrap.append(pager(load));
    return wrap;
  }, 'Audit log'));
})();
