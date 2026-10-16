/* Creator Studio: dashboard, content, upload, video editor, analytics, comments, customisation, monetisation. */
'use strict';
(() => {
  const { h, $, $$, icon, get, post, patch, put, del, upload, fmtNum, fmtFull, fmtDur, fmtHours, ago, fmtDate, fmtDateTime, fileUrl, platformName, state, href, navigate, route, modal, closeModal, confirm, prompt, toast, errToast,
    avatar, tabs, chipsRow, categories, pager, lineChart, hbars, statTile, menu } = VT;

  const chQ = () => (new URLSearchParams(location.search).get('ch') ? '&ch=' + new URLSearchParams(location.search).get('ch') : '');
  const chP = () => (chQ() ? '?' + chQ().slice(1) : '');
  const sget = (url) => get(url + (url.includes('?') ? chQ() : chP()));
  async function shell(ctx, active, content, { pageTitle = '' } = {}) {
    if (!state.user) return h('div', { class: 'empty' }, h('h3', 'Sign in to open Studio'), h('a', { class: 'btn primary', href: href('/login?next=/studio') }, 'Sign in'));
    if (!state.channel && !state.managed.length) return h('div', { class: 'empty' }, h('h3', 'Create a channel first'), h('p', 'You need a channel to upload videos.'), h('a', { class: 'btn primary', href: href('/settings?tab=channel') }, 'Create channel'));
    let ch;
    try { ch = await sget('/api/studio/channel'); } catch (e) { if (e.status === 409) return h('div', { class: 'empty' }, h('a', { class: 'btn primary', href: href('/settings?tab=channel') }, 'Create channel')); throw e; }
    document.title = (pageTitle ? pageTitle + ' - ' : '') + 'Studio';
    const items = [['dashboard', 'Dashboard', '/studio', 'chart'], ['content', 'Content', '/studio/content', 'library'], ['analytics', 'Analytics', '/studio/analytics', 'chart'], ['comments', 'Comments', '/studio/comments', 'comment'],
      ['customize', 'Customisation', '/studio/customize', 'paint'], ['posts', 'Posts', '/studio/posts', 'edit'], ['monetization', 'Monetisation', '/studio/monetization', 'money'], ['audio', 'Audio library', '/studio/audio', 'music'], ['settings', 'Settings', '/studio/settings', 'settings']];
    const nav = h('div', { class: 'snav' }, h('div', { class: 'chan' }, avatar(ch.avatar, ch.name, 'xl'), h('div', { class: 'mt8' }, h('b', ch.name)), h('div', { class: 'small muted' }, '@' + ch.handle), !ch.isOwner ? h('div', { class: 'tag info mt8' }, 'Managing') : null,
      state.managed.length ? h('button', { class: 'btn xs outline mt8', onclick: e => menu(e.currentTarget, [state.channel ? { label: state.channel.name, fn: () => navigate('/studio') } : null, ...state.managed.map(m => ({ label: m.name, fn: () => navigate('/studio?ch=' + m.id) }))], { align: 'left' }) }, 'Switch channel') : null),
      h('a', { class: 'btn primary', style: { width: '100%', marginBottom: '8px' }, href: href('/studio/upload' + chP()) }, icon('upload'), 'Upload'),
      items.map(([k, l, p, ic]) => h('a', { class: 'nav-item' + (k === active ? ' active' : ''), href: href(p + chP()) }, icon(ic), h('span', l))),
      h('div', { class: 'nav-sep' }), h('a', { class: 'nav-item', href: href('/@' + ch.handle) }, icon('users'), h('span', 'View channel')));
    const body = h('div', { class: 'grow' });
    body.append(await content(ch));
    return h('div', { class: 'studio' }, nav, body);
  }
  const platformTag = p => h('span', { class: 'tag ' + (p === 'geotube' ? 'geo' : 'vid') }, platformName(p));
  const statusTag = p => {
    if (p.status === 'pending') return h('span', { class: 'tag warn' }, 'In review');
    if (p.status === 'rejected') return h('span', { class: 'tag bad' }, 'Rejected');
    if (p.status === 'removed') return h('span', { class: 'tag bad' }, 'Removed');
    if (p.status === 'restricted') return h('span', { class: 'tag warn' }, 'Restricted');
    return h('span', { class: 'tag ' + (p.visibility === 'public' ? 'good' : '') }, { public: 'Public', unlisted: 'Unlisted', private: 'Private', draft: 'Draft', scheduled: 'Scheduled' }[p.visibility]);
  };
  const assetTag = a => (a.status === 'ready' ? null : h('span', { class: 'tag ' + (a.status === 'failed' ? 'bad' : 'info') }, a.status === 'failed' ? 'Processing failed' : 'Processing...'));

  /* ---------- dashboard ---------- */
  route('/studio', ctx => shell(ctx, 'dashboard', async ch => {
    const d = await sget('/api/studio/dashboard');
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Channel dashboard'));
    if (d.processing.length) wrap.append(h('div', { class: 'notice' }, `${d.processing.length} upload(s) ${d.processing.some(p => p.status === 'failed') ? 'need attention' : 'are processing'}. `, h('a', { href: href('/studio/content?filter=processing' + chQ()) }, 'View')));
    if (d.pending_review.length) wrap.append(h('div', { class: 'notice warn' }, h('b', `${d.pending_review.length} video(s) waiting for moderator review. `), 'A moderator will check them soon. You will be notified.'));
    d.announcements.forEach(a => wrap.append(h('div', { class: 'notice accent' }, h('b', a.title + ' '), a.body)));
    wrap.append(h('div', { class: 'stats' }, statTile('Subscribers', fmtFull(d.channel.subscribers)), statTile('Views · 28 days', fmtNum(d.last28.view)), statTile('Watch time (hours) · 28 days', fmtNum(d.last28.watch_hours)), statTile('Views · 48 hours', fmtNum(d.last48h.views)), statTile('Avg. watched', d.last28.avg_pct == null ? '-' : d.last28.avg_pct + '%')));
    const grid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' } });
    if (d.latest) grid.append(h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Latest video performance'), h('a', { href: href('/studio/analytics/' + d.latest.video_id + chP()) }, h('div', { class: 'thumb mb8' }, d.latest.thumb ? h('img', { src: fileUrl(d.latest.thumb), alt: '' }) : null)), h('b', d.latest.title), h('div', { class: 'small muted' }, 'Published ' + ago(d.latest.published_at)),
      h('dl', { class: 'kv mt8' }, h('dt', 'Views'), h('dd', fmtFull(d.latest.views), d.latest.typical_views ? h('span', { class: 'dim small' }, ` (typical: ${fmtNum(d.latest.typical_views)})`) : null), h('dt', 'Likes'), h('dd', fmtFull(d.latest.likes)), h('dt', 'Comments'), h('dd', fmtFull(d.latest.comment_count))),
      h('div', { class: 'row mt8' }, h('a', { class: 'btn sm', href: href('/studio/analytics/' + d.latest.video_id + chP()) }, 'Analytics'), h('a', { class: 'btn sm outline', href: href('/studio/comments' + chP()) }, 'Comments'))));
    else grid.append(h('div', { class: 'card' }, h('h3', 'No published videos yet'), h('p', { class: 'muted' }, 'Upload your first video to see how it performs here.'), h('a', { class: 'btn primary', href: href('/studio/upload' + chP()) }, 'Upload')));
    grid.append(h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Views · last 28 days'), lineChart(d.last28.series, { keys: ['view'], height: 180 })));
    grid.append(h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Recent comments'), d.held_comments ? h('div', { class: 'notice warn' }, `${d.held_comments} comment(s) held for review. `, h('a', { href: href('/studio/comments?filter=held' + chQ()) }, 'Review')) : null,
      d.recent_comments.length ? d.recent_comments.map(c => h('a', { class: 'comment', href: (c.platform === 'geotube' ? '/geotube' : '') + `/watch?v=${c.video_id}&c=${c.id}` }, avatar(c.avatar, c.author, 'sm'), h('div', { class: 'grow small' }, h('b', c.author), h('span', { class: 'dim' }, ' · ' + ago(c.created_at)), h('div', { class: 'clamp2' }, c.body), h('div', { class: 'dim ellipsis' }, 'on ' + c.title)))) : h('p', { class: 'muted' }, 'No comments yet.')));
    grid.append(h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Monetisation'), h('p', { class: 'muted small' }, { not_applied: 'Not applied yet.', applied: 'Application under review.', approved: 'You are a partner.', rejected: 'Application rejected. You can apply again later.' }[d.monetization.status]), h('a', { class: 'btn sm', href: href('/studio/monetization' + chP()) }, 'Open')));
    wrap.append(grid);
    return wrap;
  }));

  /* ---------- content list ---------- */
  route('/studio/content', ctx => shell(ctx, 'content', async ch => {
    const filter = ctx.query.filter || 'all', platform = ctx.query.platform || '', q = ctx.query.q || '';
    const wrap = h('div', h('div', { class: 'row between wrap mb16' }, h('h1', 'Channel content'), h('a', { class: 'btn primary', href: href('/studio/upload' + chP()) }, icon('upload'), 'Upload')));
    const go = (f, p, qq) => navigate(`/studio/content?filter=${f}&platform=${p}&q=${encodeURIComponent(qq)}${chQ()}`);
    wrap.append(h('div', { class: 'row wrap mb16' }, chipsRow([{ value: '', label: 'All platforms' }, { value: 'vidtube', label: 'VidTube' }, { value: 'geotube', label: 'GeoTube' }], platform, p => go(filter, p, q)),
      h('select', { class: 'select', style: { width: 'auto' }, onchange: e => go(e.target.value, platform, q) }, [['all', 'All'], ['public', 'Public'], ['unlisted', 'Unlisted'], ['private', 'Private'], ['scheduled', 'Scheduled'], ['drafts', 'Drafts'], ['pending', 'In review'], ['rejected', 'Rejected'], ['removed', 'Removed'], ['shorts', 'Shorts'], ['processing', 'Processing'], ['failed', 'Failed']].map(([v, l]) => h('option', { value: v, selected: filter === v }, l))),
      h('input', { class: 'input', style: { maxWidth: '260px' }, placeholder: 'Search titles', value: q, onkeydown: e => { if (e.key === 'Enter') go(filter, platform, e.target.value); } })));
    let page = 0;
    const tbody = h('tbody');
    const load = async () => {
      const d = await sget(`/api/studio/content?filter=${filter}&platform=${platform}&q=${encodeURIComponent(q)}&page=${page++}`);
      d.items.forEach(v => {
        const main = v.publications[0] || { title: '(untitled)' };
        tbody.append(h('tr', { class: 'content-row', style: { cursor: 'pointer' }, onclick: () => navigate('/studio/video/' + v.id + chP()) },
          h('td', h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('div', { class: 'thumb' + (v.is_short ? ' portrait' : ''), style: { width: v.is_short ? '68px' : '120px', flex: 'none' } }, v.thumb ? h('img', { src: fileUrl(v.thumb), alt: '' }) : null, v.asset.duration ? h('span', { class: 'dur' }, fmtDur(v.asset.duration)) : null), h('div', h('div', { class: 't clamp2' }, main.title), h('div', { class: 'small muted' }, fmtDate(v.created_at), v.is_short ? ' · Short' : ''), assetTag(v.asset)))),
          h('td', v.publications.map(p => h('div', { class: 'row mb8' }, platformTag(p.platform), statusTag(p)))),
          h('td', { class: 'num' }, v.publications.map(p => h('div', fmtNum(p.views)))), h('td', { class: 'num' }, v.publications.map(p => h('div', fmtNum(p.likes)))), h('td', { class: 'num' }, v.publications.map(p => h('div', fmtNum(p.comment_count)))),
          h('td', h('button', { class: 'btn icon', onclick: e => { e.stopPropagation(); menu(e.currentTarget, [{ icon: 'edit', label: 'Edit details', fn: () => navigate('/studio/video/' + v.id + chP()) }, { icon: 'chart', label: 'Analytics', fn: () => navigate('/studio/analytics/' + v.id + chP()) },
            ...v.publications.filter(p => p.visibility !== 'draft').map(p => ({ icon: 'play', label: 'View on ' + platformName(p.platform), fn: () => navigate((p.platform === 'geotube' ? '/geotube' : '/vidtube') + '/watch?v=' + v.id) })), '-',
            { icon: 'trash', label: 'Delete video', danger: true, fn: async () => { if (await confirm('Delete video', 'The video is removed from every platform permanently.', { danger: true, ok: 'Delete' })) { await del('/api/studio/videos/' + v.id); VT.render(); } } }]); } }, icon('more')))));
      });
      if (page === 1 && !d.items.length) tbody.append(h('tr', h('td', { colspan: 6 }, h('div', { class: 'empty' }, 'No videos match this filter'))));
      return d.more;
    };
    const more = await load();
    wrap.append(h('div', { class: 'card pad0' }, h('table', { class: 'table' }, h('thead', h('tr', h('th', 'Video'), h('th', 'Platforms'), h('th', { class: 'num' }, 'Views'), h('th', { class: 'num' }, 'Likes'), h('th', { class: 'num' }, 'Comments'), h('th'))), tbody)));
    if (more) wrap.append(pager(load));
    return wrap;
  }));

  /* ---------- upload ---------- */
  route('/studio/upload', ctx => shell(ctx, 'content', async ch => {
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Upload video'));
    const fileInput = h('input', { type: 'file', accept: 'video/*,.mkv,.avi,.mov,.webm,.mp4,.m4v', class: 'hidden', onchange: () => fileInput.files[0] && start(fileInput.files[0]) });
    const zone = h('div', { class: 'dropzone', onclick: () => fileInput.click(), ondragover: e => { e.preventDefault(); zone.classList.add('over'); }, ondragleave: () => zone.classList.remove('over'), ondrop: e => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) start(f); } },
      icon('upload'), h('h3', { class: 'mt8' }, 'Drag and drop a video file, or click to choose'), h('p', { class: 'muted small' }, 'MP4, MOV, WebM, MKV, AVI or M4V. Your video stays private until you publish it.'),
      h('p', { class: 'muted small' }, 'Publishing on ', h('b', platformName(ctx.platform)), ' by default; you can add the other platform in the editor.'));
    wrap.append(zone, fileInput, gifCard());
    // "Make a video from a GIF": pick a GIF (GIPHY, My GIFs, or upload one), choose length and Short/landscape.
    function gifCard() {
      const gifs = [];
      const list = h('div', { class: 'gif-list' });
      const modeRow = h('div', { class: 'field', style: { display: 'none' } });
      const modeSel = h('select', { class: 'select' }, h('option', { value: 'combine' }, 'One video: the GIFs play one after another'), h('option', { value: 'separate' }, 'A separate video per GIF'));
      modeRow.append(h('label', 'Several GIFs'), modeSel);
      const secsLabel = h('label', 'Length (seconds)');
      const draw = () => {
        list.innerHTML = '';
        gifs.forEach((g, i) => list.append(h('div', { class: 'gif-item' }, h('img', { src: g.url || g.preview, alt: '' }), h('div', { class: 'small muted clamp2' }, g.title || (g.source === 'upload' ? 'Uploaded GIF' : 'GIF')),
          h('div', { class: 'row' }, i > 0 ? h('button', { class: 'btn icon sm', type: 'button', title: 'Move up', onclick: () => { [gifs[i - 1], gifs[i]] = [gifs[i], gifs[i - 1]]; draw(); } }, '↑') : null, h('button', { class: 'btn icon sm', type: 'button', title: 'Remove', onclick: () => { gifs.splice(i, 1); draw(); } }, icon('close'))))));
        if (!gifs.length) list.append(h('span', { class: 'muted small' }, 'No GIF chosen yet. You can add several.'));
        modeRow.style.display = gifs.length > 1 ? '' : 'none';
        secsLabel.textContent = gifs.length > 1 && modeSel.value === 'combine' ? 'Length per GIF (seconds)' : 'Length (seconds)';
        limitSecs();
      };
      const limitSecs = () => { const total = shortSel.value === 'short' ? 60 : 180; const per = gifs.length > 1 && modeSel.value === 'combine' ? Math.max(1, Math.floor(total / gifs.length)) : total; secs.max = per; if (Number(secs.value) > per) secs.value = per; };
      const add = g => { if (gifs.length >= 10) return toast('At most 10 GIFs per video', { bad: true }); gifs.push(g); draw(); };
      const gifFile = h('input', { type: 'file', accept: 'image/gif', multiple: true, class: 'hidden', onchange: async () => {
        for (const f of [...gifFile.files]) {
          if (f.size > 5 * 1048576) { toast(f.name + ' is larger than 5 MB', { bad: true }); continue; }
          try { const r = await upload('/api/uploads/image?kind=post', f); if (r.kind !== 'gif') { toast(f.name + ' is not a GIF', { bad: true }); continue; } add({ source: 'upload', file: r.file, url: r.url, title: f.name }); }
          catch (e) { errToast(e); }
        }
        gifFile.value = '';
      } });
      const pickBtn = h('button', { class: 'btn', type: 'button', onclick: async () => { const g = await VT.gifPicker({}); if (g) add(g); } }, h('b', 'GIF'), ' Add from GIPHY / My GIFs');
      const upBtn = h('button', { class: 'btn', type: 'button', onclick: () => gifFile.click() }, icon('upload'), 'Upload GIF files');
      const shortSel = h('select', { class: 'select' }, h('option', { value: 'short' }, 'Short (vertical 9:16, max 60 s)'), h('option', { value: 'video' }, 'Normal video (max 180 s)'));
      const secs = h('input', { class: 'input', type: 'number', min: 1, max: 60, value: 10, style: { width: '110px' } });
      shortSel.onchange = limitSecs; modeSel.onchange = draw;
      const title = h('input', { class: 'input', placeholder: 'Title (optional)', maxlength: 100 });
      const msg = h('span', { class: 'small muted' });
      const toBody = g => g.source === 'giphy' ? { source: 'giphy', url: g.url, title: g.title } : g.source === 'mygif' ? { source: 'mygif', id: g.id } : { source: 'upload', file: g.file };
      const makeBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        if (!gifs.length) return toast('Choose a GIF first', { bad: true });
        const short = shortSel.value === 'short', seconds = Number(secs.value) || 10, q = chQ() ? '?' + chQ().slice(1) : '';
        makeBtn.disabled = true;
        try {
          if (gifs.length > 1 && modeSel.value === 'separate') {
            const ids = [];
            for (let i = 0; i < gifs.length; i++) {
              msg.textContent = `Making video ${i + 1} of ${gifs.length}…`;
              const r = await post('/api/studio/from-gif' + q, { gifs: [toBody(gifs[i])], short, seconds, title: title.value ? `${title.value} ${i + 1}` : '', platform: ctx.platform });
              ids.push(r.video_id);
            }
            toast(`${ids.length} videos created. Processing has started.`);
            navigate('/studio/content?filter=processing' + chQ());
          } else {
            msg.textContent = 'Making your video… this can take a little while.';
            const r = await post('/api/studio/from-gif' + q, { gifs: gifs.map(toBody), short, seconds, title: title.value, platform: ctx.platform });
            toast('Video created. Processing has started.');
            navigate('/studio/video/' + r.video_id + chP() + (chQ() ? '&' : '?') + 'new=1');
          }
        } catch (e) { msg.textContent = e.message; makeBtn.disabled = false; }
      } }, 'Create');
      draw();
      return h('div', { class: 'card mt16' }, h('h3', 'Make a video or Short from GIFs'),
        h('p', { class: 'muted small' }, 'Add one GIF or several at once. Each GIF is repeated until it fills its length; with several GIFs they play one after another in one video, or you get a separate video per GIF. A Short becomes a vertical video with the GIF in the middle. Afterwards it opens in the editor like any upload.'),
        h('div', { class: 'row wrap' }, pickBtn, upBtn, gifFile), list, modeRow,
        h('div', { class: 'row wrap', style: { alignItems: 'flex-end' } }, h('div', { class: 'field' }, h('label', 'Type'), shortSel), h('div', { class: 'field' }, secsLabel, secs), h('div', { class: 'field grow' }, h('label', 'Title'), title)),
        h('div', { class: 'row wrap' }, makeBtn, msg));
    }
    async function start(file) {
      const bar = h('div'), txt = h('div', { class: 'small muted mt8' }, 'Starting upload...');
      const cancel = h('button', { class: 'btn sm outline mt8', onclick: () => { if (prog.cancel) prog.cancel(); } }, 'Cancel');
      zone.replaceWith(h('div', { class: 'card' }, h('h3', file.name), h('div', { class: 'small muted mb8' }, (file.size / 1048576).toFixed(1) + ' MB'), h('div', { class: 'progress' }, bar), txt, cancel));
      const prog = (p, loaded) => { bar.style.width = Math.round(p * 100) + '%'; txt.textContent = `Uploading ${Math.round(p * 100)}% (${(loaded / 1048576).toFixed(1)} MB)`; };
      try {
        const r = await upload(`/api/studio/upload?filename=${encodeURIComponent(file.name)}&platform=${ctx.platform}${chQ()}`, file, prog);
        toast('Upload complete. Processing has started.');
        navigate('/studio/video/' + r.video_id + chP() + (chQ() ? '&' : '?') + 'new=1');
      } catch (e) { errToast(e); VT.render(); }
    }
    return wrap;
  }, { pageTitle: 'Upload' }));

  /* ---------- video editor ---------- */
  route('/studio/video/:id', ctx => shell(ctx, 'content', async ch => {
    let v = await get('/api/studio/videos/' + ctx.params.id);
    const wrap = h('div');
    const platforms = ['vidtube', 'geotube'];
    let activeP = v.publications.find(p => p.platform === ctx.platform) ? ctx.platform : (v.publications[0] || {}).platform || ctx.platform;
    const cats = { vidtube: await categories('vidtube'), geotube: await categories('geotube') };
    wrap.append(h('div', { class: 'row between wrap mb16' }, h('div', { class: 'row' }, h('a', { class: 'btn icon', href: href('/studio/content' + chP()) }, icon('back')), h('h1', 'Video details')),
      h('div', { class: 'row' }, h('a', { class: 'btn outline sm', href: href('/studio/analytics/' + v.id + chP()) }, icon('chart'), 'Analytics'), h('button', { class: 'btn icon', onclick: e => menu(e.currentTarget, [{ icon: 'trash', label: 'Delete video', danger: true, fn: async () => { if (await confirm('Delete video', 'The video is removed from every platform permanently.', { danger: true, ok: 'Delete' })) { await del('/api/studio/videos/' + v.id); navigate('/studio/content' + chP()); } } }]) }, icon('more')))));
    if (ctx.query.new) wrap.append(h('div', { class: 'notice good' }, h('b', 'Upload received. '), 'Fill in the details below. Processing continues in the background; you can publish right away and the video goes live as soon as it is ready.'));
    const grid = h('div', { class: 'edit-grid' });
    const left = h('div'), right = h('div');
    grid.append(left, right); wrap.append(grid);
    /* right column: preview, thumbnail, captions, options */
    const preview = h('div', { class: 'card mb16' });
    const drawPreview = () => {
      preview.innerHTML = '';
      const a = v.asset;
      if (a.status === 'ready' && a.qualities.length) preview.append(h('div', { class: 'player-wrap mb8' }, h('video', { controls: true, src: a.qualities[0].url, poster: fileUrl(v.thumb) || '' })));
      else preview.append(h('div', { class: 'thumb mb8', style: { display: 'flex', alignItems: 'center', justifyContent: 'center' } }, h('div', { style: { textAlign: 'center' } }, a.status === 'failed' ? [h('b', 'Processing failed'), h('div', { class: 'small' }, a.error)] : [h('div', { class: 'spinner', style: { margin: '0 auto 8px' } }), 'Processing...'])));
      preview.append(h('dl', { class: 'kv small' }, h('dt', 'File'), h('dd', { class: 'ellipsis' }, a.original_name || '-'), h('dt', 'Length'), h('dd', a.duration ? fmtDur(a.duration) : '-'), h('dt', 'Resolution'), h('dd', a.width ? `${a.width}×${a.height}` : '-'), h('dt', 'Link'), h('dd', h('a', { class: 'hash', href: location.origin + (activeP === 'geotube' ? '/geotube' : '') + '/watch?v=' + v.id, target: '_blank' }, location.host + '/watch?v=' + v.id))));
    };
    drawPreview();
    if (v.asset.status !== 'ready' && v.asset.status !== 'failed') { const iv = setInterval(async () => { try { const s = await get('/api/studio/upload/' + v.asset_id); if (s.status !== 'processing') { clearInterval(iv); v = await get('/api/studio/videos/' + v.id); drawPreview(); drawThumbs(); if (s.status === 'ready') toast('Processing finished'); } } catch { clearInterval(iv); } }, 5000); ctx.cleanup = () => clearInterval(iv); }
    const thumbBox = h('div');
    const drawThumbs = () => { thumbBox.innerHTML = ''; thumbBox.append(h('div', { class: 'thumb mb8' }, v.thumb ? h('img', { src: fileUrl(v.thumb), alt: '' }) : h('div', { class: 'empty small' }, 'Generated after processing'))); };
    drawThumbs();
    const thumbInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'hidden', onchange: async () => { const f = thumbInput.files[0]; if (!f) return; try { const r = await upload('/api/studio/images?kind=thumb', f); v = await patch('/api/studio/videos/' + v.id, { thumb: r.file }); drawThumbs(); toast('Thumbnail updated'); } catch (e) { errToast(e); } } });
    const capInput = h('input', { type: 'file', accept: '.vtt,.srt', class: 'hidden', onchange: async () => { const f = capInput.files[0]; if (!f) return; try { const r = await upload('/api/studio/captions', f); v = await patch('/api/studio/videos/' + v.id, { captions: r.file }); capRow(); toast('Captions uploaded'); } catch (e) { errToast(e); } } });
    const capWrap = h('div');
    const capRow = () => { capWrap.innerHTML = ''; capWrap.append(v.captions ? h('div', { class: 'row' }, h('span', { class: 'tag good' }, 'Captions attached'), h('button', { class: 'btn xs', onclick: async () => { v = await patch('/api/studio/videos/' + v.id, { captions: null }); capRow(); } }, 'Remove')) : h('button', { class: 'btn sm outline', onclick: () => capInput.click() }, 'Upload .vtt or .srt')); };
    capRow();
    const opt = (key, label, hint) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v[key], onchange: async e => { try { v = await patch('/api/studio/videos/' + v.id, { [key]: e.target.checked }); } catch (err) { errToast(err); e.target.checked = !e.target.checked; } } }), h('div', h('b', label), hint ? h('span', hint) : null));
    right.append(preview, h('div', { class: 'card mb16' }, h('h3', { class: 'mb8' }, 'Thumbnail'), thumbBox, h('button', { class: 'btn sm outline', onclick: () => thumbInput.click() }, 'Upload custom thumbnail'), thumbInput),
      h('div', { class: 'card mb16' }, h('h3', { class: 'mb8' }, 'Captions'), capWrap, capInput),
      h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Options'), opt('is_short', 'Short', 'Shows in the Shorts feed instead of between the videos (vertical works best). A YouTube import under 1:30 becomes a Short automatically; switch it here if you want.'), opt('allow_comments', 'Allow comments'), opt('allow_download', 'Allow downloads'), opt('made_for_kids', 'Made for kids'), opt('sponsored', 'Contains paid promotion', 'A label is shown to viewers.')));
    /* left column: per-platform publication form */
    const tagsEdit = h('div', { class: 'tagbox' });
    const drawTags = () => { tagsEdit.innerHTML = ''; v.tags.forEach(t => tagsEdit.append(h('span', { class: 'tag' }, t, h('button', { onclick: () => saveTags(v.tags.filter(x => x !== t)) }, '×')))); const inp = h('input', { placeholder: 'Add tag, press Enter', onkeydown: e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); const t = inp.value.trim().toLowerCase(); if (t) saveTags([...v.tags, t]); } } }); tagsEdit.append(inp); };
    const saveTags = async tags => { try { v = await patch('/api/studio/videos/' + v.id, { tags }); drawTags(); } catch (e) { errToast(e); } };
    drawTags();
    const formBox = h('div');
    const pTabs = () => tabs(platforms.map(p => ({ value: p, label: platformName(p) + (v.publications.find(x => x.platform === p) ? '' : ' (add)') })), activeP, p => { activeP = p; drawForm(); });
    const tabHolder = h('div');
    function drawForm() {
      tabHolder.innerHTML = ''; tabHolder.append(pTabs());
      formBox.innerHTML = '';
      const pub = v.publications.find(x => x.platform === activeP);
      const other = v.publications.find(x => x.platform !== activeP);
      const geo = activeP === 'geotube';
      const f = { title: pub ? pub.title : (other ? other.title : ''), description: pub ? pub.description : (other ? other.description : ''), category: pub ? pub.category : '', visibility: pub ? pub.visibility : 'draft', publish_at: pub ? pub.publish_at : null };
      const title = h('input', { class: 'input', value: f.title, maxlength: 100, placeholder: 'Title (required)' });
      const desc = h('textarea', { class: 'input', style: { minHeight: '140px' }, placeholder: 'Tell viewers about your video. Timestamps like 0:00 Intro create chapters.' }, f.description);
      const cat = h('select', { class: 'select' }, h('option', { value: '' }, geo ? 'Choose a GeoTube category (required)' : 'No category'), cats[activeP].map(c => h('option', { value: c.slug, selected: f.category === c.slug }, c.name)));
      const vis = h('select', { class: 'select' }, [['public', 'Public'], ['unlisted', 'Unlisted'], ['private', 'Private'], ['scheduled', 'Scheduled'], ['draft', 'Draft (not published)']].map(([val, l]) => h('option', { value: val, selected: f.visibility === val }, l)));
      const when = h('input', { class: 'input', type: 'datetime-local', value: f.publish_at ? new Date(f.publish_at - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '' });
      const whenRow = h('div', { class: 'field' + (f.visibility === 'scheduled' ? '' : ' hidden') }, h('label', 'Publish at'), when);
      vis.addEventListener('change', () => whenRow.classList.toggle('hidden', vis.value !== 'scheduled'));
      const checkBox = h('div');
      let checkTimer;
      const runCheck = () => { if (!geo) return; clearTimeout(checkTimer); checkTimer = setTimeout(async () => { try { const r = await post('/api/studio/geotube/check', { title: title.value, description: desc.value, tags: v.tags, category: cat.value }); drawCheck(r); } catch {} }, 400); };
      const drawCheck = r => { checkBox.innerHTML = ''; checkBox.append(h('h3', { class: 'mb8' }, 'GeoTube eligibility check')); if (!r.flags.length) checkBox.append(h('div', { class: 'flag ok' }, icon('check'), h('span', r.mode === 'review_all' ? 'Looks on topic. All GeoTube uploads are currently reviewed by a moderator before going live.' : 'Looks on topic. It will be published immediately.'))); else { checkBox.append(h('p', { class: 'small muted' }, 'A moderator will review this submission before it appears on GeoTube. Fixing the points below lets it publish immediately:')); r.flags.forEach(fl => checkBox.append(h('div', { class: 'flag' }, icon('flag'), h('span', fl.message)))); } if (r.positive.length) checkBox.append(h('div', { class: 'small dim' }, 'Recognised topics: ' + r.positive.join(', '))); };
      [title, desc, cat].forEach(el => el.addEventListener('input', runCheck));
      if (geo) { checkBox.append(h('div', { class: 'spinner' })); runCheck(); }
      if (pub && pub.status !== 'approved') formBox.append(h('div', { class: 'notice ' + (pub.status === 'pending' ? 'warn' : 'bad') }, h('b', { pending: 'Waiting for moderator review. ', rejected: 'Rejected by a moderator. ', removed: 'Removed by a moderator. ', restricted: 'Restricted by a moderator. ' }[pub.status]), pub.review_note || '', pub.status === 'pending' && pub.check && pub.check.flags ? h('ul', { class: 'small' }, pub.check.flags.map(fl => h('li', fl.message))) : null,
        ['rejected', 'removed', 'restricted'].includes(pub.status) && !v.appeals.find(a => a.platform === activeP && a.status === 'open') ? h('div', { class: 'mt8' }, h('button', { class: 'btn sm', onclick: () => appealDialog(activeP) }, 'Appeal this decision')) : null));
      v.appeals.filter(a => a.platform === activeP).forEach(a => formBox.append(h('div', { class: 'notice' }, h('b', 'Appeal ' + a.status + ' · ' + fmtDate(a.created_at) + '. '), a.response || (a.status === 'open' ? 'A moderator will respond.' : ''))));
      v.claims.forEach(c => formBox.append(h('div', { class: 'notice bad' }, h('b', 'Copyright claim ' + c.status + ': '), c.work, c.response ? ' · ' + c.response : '')));
      formBox.append(h('div', { class: 'field' }, h('label', 'Title'), title), h('div', { class: 'field' }, h('label', 'Description'), desc),
        h('div', { class: 'field' }, h('label', 'Category'), cat), h('div', { class: 'field' }, h('label', 'Tags'), tagsEdit, h('div', { class: 'hint' }, 'Tags help search and, on GeoTube, the topic check.')),
        geo ? h('div', { class: 'card mb16' }, checkBox) : null,
        h('div', { class: 'field' }, h('label', 'Visibility'), vis), whenRow,
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: save }, pub ? 'Save' : 'Add to ' + platformName(activeP)), pub && v.publications.length > 1 ? h('button', { class: 'btn outline', onclick: async () => { if (await confirm('Remove from ' + platformName(activeP), 'The video stays on the other platform.', { danger: true, ok: 'Remove' })) { v = await del(`/api/studio/videos/${v.id}/publications/${activeP}`); activeP = v.publications[0].platform; drawForm(); } } }, 'Remove from ' + platformName(activeP)) : null,
          pub && pub.visibility !== 'draft' ? h('a', { class: 'btn ghost', href: (activeP === 'geotube' ? '/geotube' : '/vidtube') + '/watch?v=' + v.id, target: '_blank' }, icon('play'), 'View') : null));
      async function save() {
        try {
          const body = { title: title.value, description: desc.value, category: cat.value || null, visibility: vis.value };
          if (vis.value === 'scheduled') body.publish_at = new Date(when.value).getTime();
          v = await put(`/api/studio/videos/${v.id}/publications/${activeP}`, body);
          const np = v.publications.find(x => x.platform === activeP);
          toast(np.status === 'pending' ? 'Saved. Waiting for moderator review.' : np.visibility === 'public' ? 'Published on ' + platformName(activeP) : 'Saved');
          drawForm();
        } catch (e) { errToast(e); }
      }
    }
    function appealDialog(platform) {
      const ta = h('textarea', { class: 'input', placeholder: 'Explain why this video fits ' + platformName(platform) + ' (at least 20 characters).' });
      modal({ title: 'Appeal decision', body: h('div', { class: 'field' }, h('label', 'Your message to the moderators'), ta), foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => { try { v = await post('/api/studio/appeals', { video_id: v.id, platform, text: ta.value }); closeModal(); drawForm(); toast('Appeal sent'); } catch (e) { errToast(e); } } }, 'Send appeal')] });
    }
    left.append(tabHolder, formBox);
    drawForm();
    return wrap;
  }, { pageTitle: 'Edit video' }));

  /* ---------- analytics ---------- */
  function deltaPct(cur, prev) { return prev ? Math.round(100 * (cur - prev) / prev) : null; }
  route('/studio/analytics', ctx => shell(ctx, 'analytics', async ch => {
    const days = Number(ctx.query.days) || 28, platform = ctx.query.platform || '', metric = ctx.query.metric || 'view';
    const d = await sget(`/api/studio/analytics?days=${days}&platform=${platform}`);
    const go = (o) => navigate(`/studio/analytics?days=${o.days ?? days}&platform=${o.platform ?? platform}&metric=${o.metric ?? metric}${chQ()}`);
    const wrap = h('div', h('div', { class: 'row between wrap mb16' }, h('h1', 'Channel analytics'), h('div', { class: 'row' }, chipsRow([{ value: '', label: 'Both' }, { value: 'vidtube', label: 'VidTube' }, { value: 'geotube', label: 'GeoTube' }], platform, p => go({ platform: p })), h('select', { class: 'select', style: { width: 'auto' }, onchange: e => go({ days: e.target.value }) }, [7, 28, 90, 365].map(n => h('option', { value: n, selected: days === n }, 'Last ' + n + ' days'))))));
    const t = d.totals, p = d.previous;
    wrap.append(h('div', { class: 'stats' },
      statTile('Views', fmtNum(t.view), { delta: deltaPct(t.view, p.view), onclick: () => go({ metric: 'view' }), active: metric === 'view' }),
      statTile('Watch time (hours)', fmtNum(t.watch_hours), { delta: deltaPct(t.watch_hours, p.watch_hours), onclick: () => go({ metric: 'watch' }), active: metric === 'watch' }),
      statTile('Subscribers', (t.net_subs >= 0 ? '+' : '') + fmtFull(t.net_subs), { sub: fmtFull(t.subscribers) + ' total', onclick: () => go({ metric: 'subscribers' }), active: metric === 'subscribers' }),
      statTile('Likes', fmtNum(t.like), { delta: deltaPct(t.like, p.like), onclick: () => go({ metric: 'like' }), active: metric === 'like' }),
      statTile('Comments', fmtNum(t.comment), { delta: deltaPct(t.comment, p.comment), onclick: () => go({ metric: 'comment' }), active: metric === 'comment' })));
    const label = { view: 'Views', watch: 'Watch time (hours)', subscribers: 'Subscribers', like: 'Likes', comment: 'Comments' }[metric];
    const series = metric === 'watch' ? d.series.map(x => ({ ...x, watch: Math.round(x.watch / 360) / 10 })) : d.series;
    wrap.append(h('div', { class: 'card mb16' }, h('h3', { class: 'mb8' }, label + ' · daily'), lineChart(series, { keys: [metric], fmt: n => fmtNum(n) })));
    const g = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' } });
    g.append(h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Top videos'), d.top_videos.length ? h('table', { class: 'table' }, h('thead', h('tr', h('th', 'Video'), h('th', { class: 'num' }, 'Views'), h('th', { class: 'num' }, 'Hours'))), h('tbody', d.top_videos.map(v => h('tr', { style: { cursor: 'pointer' }, onclick: () => navigate(`/studio/analytics/${v.video_id}?platform=${v.platform}${chQ()}`) }, h('td', h('div', { class: 'row' }, h('div', { class: 'thumb', style: { width: '64px', flex: 'none' } }, v.thumb ? h('img', { src: fileUrl(v.thumb), alt: '' }) : null), h('div', h('div', { class: 'clamp2 small' }, v.title), platformTag(v.platform)))), h('td', { class: 'num' }, fmtNum(v.views)), h('td', { class: 'num' }, fmtNum(Math.round(v.watch / 3600))))))) : h('p', { class: 'muted' }, 'No data yet')));
    g.append(h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Traffic sources'), hbars(d.sources)), h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Devices'), hbars(d.devices)), h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Top regions'), h('p', { class: 'small dim' }, 'Estimated from browser language.'), hbars(d.countries)),
      h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Views by platform'), hbars(d.platforms.map(x => ({ k: platformName(x.k), n: x.n })))), h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Where subscribers came from'), hbars(d.sub_sources)),
      h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Realtime · views per hour (48 h)'), lineChart(d.realtime.map(r => ({ day: new Date(r.hour).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), n: r.n })), { keys: ['n'], height: 140, xfmt: x => x })));
    wrap.append(g);
    return wrap;
  }, { pageTitle: 'Analytics' }));
  route('/studio/analytics/:id', ctx => shell(ctx, 'analytics', async ch => {
    const days = Number(ctx.query.days) || 28, platform = ctx.query.platform || '';
    const d = await get(`/api/studio/analytics/video/${ctx.params.id}?days=${days}&platform=${platform}`);
    const v = d.video, main = v.publications[0] || {};
    const go = o => navigate(`/studio/analytics/${v.id}?days=${o.days ?? days}&platform=${o.platform ?? platform}${chQ()}`);
    const wrap = h('div', h('div', { class: 'row between wrap mb16' }, h('div', { class: 'row' }, h('a', { class: 'btn icon', href: href('/studio/analytics' + chP()) }, icon('back')), h('h1', 'Video analytics')), h('div', { class: 'row' }, chipsRow([{ value: '', label: 'Both' }, ...v.publications.map(p => ({ value: p.platform, label: platformName(p.platform) }))], platform, p => go({ platform: p })), h('select', { class: 'select', style: { width: 'auto' }, onchange: e => go({ days: e.target.value }) }, [7, 28, 90, 365].map(n => h('option', { value: n, selected: days === n }, 'Last ' + n + ' days'))))));
    wrap.append(h('div', { class: 'row mb16' }, h('div', { class: 'thumb', style: { width: '160px', flex: 'none' } }, v.thumb ? h('img', { src: fileUrl(v.thumb), alt: '' }) : null), h('div', h('h2', main.title), h('div', { class: 'small muted' }, v.publications.map(p => h('span', { class: 'row', style: { display: 'inline-flex', marginRight: '12px' } }, platformTag(p.platform), ' ', fmtFull(p.views) + ' views total'))), h('a', { class: 'btn sm outline mt8', href: href('/studio/video/' + v.id + chP()) }, 'Edit details'))));
    const t = d.totals;
    wrap.append(h('div', { class: 'stats' }, statTile('Views', fmtNum(t.view)), statTile('Watch time (hours)', fmtNum(t.watch_hours)), statTile('Avg. watched', d.avg_pct == null ? '-' : d.avg_pct + '%'), statTile('Likes', fmtNum(t.like)), statTile('Subscribers gained', fmtNum(t.sub))));
    wrap.append(h('div', { class: 'card mb16' }, h('h3', { class: 'mb8' }, 'Views · daily'), lineChart(d.series, { keys: ['view'] })));
    const g = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' } });
    g.append(h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Audience retention'), h('p', { class: 'small dim' }, 'Share of viewers still watching at each tenth of the video.'), d.retention[0].pct == null ? h('p', { class: 'muted' }, 'Not enough data yet') : h('div', { class: 'retention mt16' }, d.retention.map(r => h('div', { style: { height: Math.max(2, r.pct) + '%' }, title: `${r.decile * 10}-${r.decile * 10 + 10}%: ${r.pct}% still watching` }, h('span', r.pct + '%'))))));
    g.append(h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Traffic sources'), hbars(d.sources)), h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Devices'), hbars(d.devices)), h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Top regions'), hbars(d.countries)));
    wrap.append(g);
    return wrap;
  }, { pageTitle: 'Video analytics' }));

  /* ---------- comments moderation ---------- */
  route('/studio/comments', ctx => shell(ctx, 'comments', async ch => {
    const filter = ctx.query.filter || 'published', q = ctx.query.q || '';
    const d = await sget(`/api/studio/comments?filter=${filter}&q=${encodeURIComponent(q)}`);
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Comments'));
    wrap.append(tabs([{ value: 'published', label: 'Published' }, { value: 'held', label: 'Held for review', count: d.counts.held || null }, { value: 'hidden', label: 'Hidden users' }, { value: 'all', label: 'All' }], filter, f => navigate(`/studio/comments?filter=${f}${chQ()}`)));
    wrap.append(h('input', { class: 'input mb16', style: { maxWidth: '320px' }, placeholder: 'Search comments', value: q, onkeydown: e => { if (e.key === 'Enter') navigate(`/studio/comments?filter=${filter}&q=${encodeURIComponent(e.target.value)}${chQ()}`); } }));
    if (filter === 'hidden') {
      const hidden = await sget('/api/studio/hidden-users');
      wrap.append(h('div', { class: 'card' }, h('h3', { class: 'mb8' }, 'Users hidden from your channel'), h('p', { class: 'small muted' }, 'Their comments are only visible to themselves.'), hidden.length ? hidden.map(u => h('div', { class: 'row between mb8' }, h('span', u.name + (u.handle ? ' (@' + u.handle + ')' : '')), h('button', { class: 'btn xs', onclick: async e => { await del('/api/studio/hidden-users/' + u.user_id + chP()); e.target.closest('div').remove(); } }, 'Unhide'))) : h('p', { class: 'muted' }, 'Nobody is hidden.')));
    }
    const list = h('div');
    d.items.forEach(c => {
      const node = h('div', { class: 'card mb8' });
      const act = async (a, msg) => { try { await post(`/api/studio/comments/${c.id}/${a}`); toast(msg || 'Done'); if (['approve', 'reject', 'remove', 'hide_user'].includes(a)) node.remove(); } catch (e) { errToast(e); } };
      node.append(h('div', { class: 'row', style: { alignItems: 'flex-start' } }, avatar(c.author_avatar, c.author), h('div', { class: 'grow' }, h('div', { class: 'small' }, h('b', c.author), h('span', { class: 'dim' }, ' · ' + ago(c.created_at) + ' · on '), h('a', { class: 'hash', href: (c.platform === 'geotube' ? '/geotube' : '') + `/watch?v=${c.video_id}&c=${c.id}` }, c.title), c.status === 'held' ? h('span', { class: 'tag warn', style: { marginLeft: '6px' } }, 'Held') : null, c.status === 'hidden' ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, 'Hidden user') : null, c.pinned ? h('span', { class: 'tag accent', style: { marginLeft: '6px' } }, 'Pinned') : null, c.parent_id ? h('span', { class: 'dim small' }, ' · reply') : null),
        h('div', { class: 'mt8', style: { whiteSpace: 'pre-wrap' } }, c.body), VT.mediaNode(c.attachment), h('div', { class: 'row wrap mt8' },
          c.status === 'held' ? [h('button', { class: 'btn xs primary', onclick: () => act('approve', 'Comment approved') }, 'Approve'), h('button', { class: 'btn xs', onclick: () => act('reject', 'Comment removed') }, 'Remove')] : null,
          c.status === 'visible' ? h('button', { class: 'btn xs', onclick: () => act('remove', 'Comment removed') }, icon('trash'), 'Remove') : null,
          !c.parent_id && c.status === 'visible' ? h('button', { class: 'btn xs', onclick: () => act(c.pinned ? 'unpin' : 'pin') }, icon('pin'), c.pinned ? 'Unpin' : 'Pin') : null,
          h('button', { class: 'btn xs', onclick: () => act(c.hearted ? 'unheart' : 'heart') }, icon('heart'), c.hearted ? 'Unheart' : 'Heart'),
          h('a', { class: 'btn xs', href: (c.platform === 'geotube' ? '/geotube' : '') + `/watch?v=${c.video_id}&c=${c.id}` }, 'Reply'),
          !c.mine ? h('button', { class: 'btn xs ghost', onclick: () => act(c.author_hidden ? 'unhide_user' : 'hide_user', c.author_hidden ? 'User unhidden' : 'User hidden from channel') }, icon('eyeoff'), c.author_hidden ? 'Unhide user' : 'Hide user') : null))));
      list.append(node);
    });
    if (!d.items.length && filter !== 'hidden') list.append(h('div', { class: 'empty' }, 'No comments here'));
    wrap.append(list);
    return wrap;
  }, { pageTitle: 'Comments' }));

  /* ---------- customisation ---------- */
  route('/studio/customize', ctx => shell(ctx, 'customize', async ch => {
    const tab = ctx.query.tab || 'basic';
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Channel customisation'));
    wrap.append(tabs([{ value: 'basic', label: 'Basic info' }, { value: 'branding', label: 'Branding' }, { value: 'layout', label: 'Layout' }, { value: 'geotube', label: 'GeoTube identity' }, { value: 'moderation', label: 'Comment moderation' }], tab, t => navigate(`/studio/customize?tab=${t}${chQ()}`)));
    const save = async body => { try { const r = await patch('/api/studio/channel' + chP(), body); toast('Saved'); if (state.channel && state.channel.id === r.id) { state.channel.name = r.name; state.channel.handle = r.handle; state.channel.avatar = r.avatar; VT.renderTopbar(); } return r; } catch (e) { errToast(e); throw e; } };
    const imgField = (label, key, hint, w) => {
      const input = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
      const prev = h('div', { class: key.includes('banner') ? 'banner' : 'avatar xl', style: { marginBottom: '8px' } }, ch[key] ? h('img', { src: fileUrl(ch[key]), alt: '' }) : null);
      input.onchange = async () => { const f = input.files[0]; if (!f) return; try { const r = await upload('/api/studio/images?kind=' + key.replace('geo_', 'geo_'), f); ch = await save({ [key]: r.file }); prev.innerHTML = ''; prev.append(h('img', { src: r.url, alt: '' })); } catch (e) { errToast(e); } };
      return h('div', { class: 'field' }, h('label', label), prev, h('div', { class: 'row' }, h('button', { class: 'btn sm outline', onclick: () => input.click() }, 'Upload'), ch[key] ? h('button', { class: 'btn sm ghost', onclick: async () => { ch = await save({ [key]: null }); prev.innerHTML = ''; } }, 'Remove') : null), h('div', { class: 'hint' }, hint), input);
    };
    const body = h('div', { class: 'settings' });
    if (tab === 'basic') {
      const name = h('input', { class: 'input', value: ch.name, maxlength: 50 }), handle = h('input', { class: 'input', value: ch.handle, maxlength: 30 }), desc = h('textarea', { class: 'input' }, ch.description || ''), country = h('input', { class: 'input', value: ch.country || '', placeholder: 'e.g. Belgium' });
      const hint = h('div', { class: 'hint' }, 'Changing your handle changes your channel URL.');
      let t; handle.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { const r = await get(`/api/handles/check?handle=${encodeURIComponent(handle.value)}&except=${ch.id}`); hint.textContent = r.available ? '@' + handle.value + ' is available' : r.reason; hint.style.color = r.available ? 'var(--good)' : 'var(--bad)'; }, 300); });
      const links = h('div');
      let linkList = ch.links.slice();
      const drawLinks = () => { links.innerHTML = ''; linkList.forEach((l, i) => links.append(h('div', { class: 'row mb8' }, h('input', { class: 'input', placeholder: 'Title', value: l.title, oninput: e => (linkList[i].title = e.target.value) }), h('input', { class: 'input', placeholder: 'https://', value: l.url, oninput: e => (linkList[i].url = e.target.value) }), h('button', { class: 'btn icon', onclick: () => { linkList.splice(i, 1); drawLinks(); } }, icon('close'))))); links.append(h('button', { class: 'btn sm outline', onclick: () => { linkList.push({ title: '', url: '' }); drawLinks(); } }, 'Add link')); };
      drawLinks();
      body.append(h('div', { class: 'field' }, h('label', 'Name'), name), h('div', { class: 'field' }, h('label', 'Handle'), h('div', { class: 'row' }, h('span', { class: 'muted' }, '@'), handle), hint), h('div', { class: 'field' }, h('label', 'Description'), desc), h('div', { class: 'field' }, h('label', 'Country'), country), h('div', { class: 'field' }, h('label', 'Links'), links),
        h('button', { class: 'btn primary', onclick: () => save({ name: name.value, handle: handle.value, description: desc.value, country: country.value, links: linkList }) }, 'Save'));
    } else if (tab === 'branding') {
      body.append(imgField('Profile picture', 'avatar', 'Square image, at least 256×256. PNG, JPG, WebP or GIF, max 5 MB.'), imgField('Banner', 'banner', 'Wide image, recommended 2048×400.'), imgField('Video watermark', 'watermark', 'Small logo shown in the corner of your videos.'));
    } else if (tab === 'layout') {
      const content = await sget('/api/studio/content?filter=public&limit=60');
      const vids = content.items.filter(v => v.publications.some(p => p.visibility === 'public'));
      const pick = (label, key) => h('div', { class: 'field' }, h('label', label), h('select', { class: 'select', onchange: e => save({ [key]: e.target.value || null }) }, h('option', { value: '' }, 'None'), vids.map(v => h('option', { value: v.id, selected: ch[key] === v.id }, (v.publications[0] || {}).title))));
      const all = ['featured', 'recent', 'popular', 'shorts', 'playlists', 'posts'];
      const names = { featured: 'Featured video', recent: 'Latest videos', popular: 'Popular videos', shorts: 'Shorts', playlists: 'Playlists', posts: 'Community posts' };
      let order = ch.sections.slice();
      const list = h('div', { class: 'sortable' });
      const draw = () => { list.innerHTML = ''; all.forEach(s => { const on = order.includes(s); list.append(h('label', { class: 'check item row' }, h('input', { type: 'checkbox', checked: on, onchange: e => { if (e.target.checked) order.push(s); else order = order.filter(x => x !== s); save({ sections: order }); draw(); } }), h('b', { class: 'grow' }, names[s]), on ? h('span', { class: 'row' }, h('button', { class: 'btn xs', onclick: e => { e.preventDefault(); const i = order.indexOf(s); if (i > 0) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; save({ sections: order }); draw(); } } }, '↑'), h('button', { class: 'btn xs', onclick: e => { e.preventDefault(); const i = order.indexOf(s); if (i < order.length - 1) { [order[i + 1], order[i]] = [order[i], order[i + 1]]; save({ sections: order }); draw(); } } }, '↓')) : null)); }); };
      draw();
      body.append(pick('Featured video (shown to subscribers)', 'featured_video_id'), pick('Channel trailer (shown to new visitors)', 'trailer_video_id'), h('div', { class: 'field' }, h('label', 'Sections on the Home tab'), list));
    } else if (tab === 'geotube') {
      const sep = h('button', { class: 'toggle' + (ch.geo_separate ? ' on' : ''), onclick: async () => { ch = await save({ geo_separate: !ch.geo_separate }); sep.classList.toggle('on', ch.geo_separate); fields.classList.toggle('hidden', !ch.geo_separate); } });
      const gname = h('input', { class: 'input', value: ch.geo_name || '', placeholder: ch.name }), gdesc = h('textarea', { class: 'input' }, ch.geo_description || '');
      const fields = h('div', { class: ch.geo_separate ? '' : 'hidden' }, h('div', { class: 'field' }, h('label', 'Name on GeoTube'), gname), h('div', { class: 'field' }, h('label', 'Description on GeoTube'), gdesc), imgField('Profile picture on GeoTube', 'geo_avatar', 'Leave empty to use your main picture.'), imgField('Banner on GeoTube', 'geo_banner', 'Leave empty to use your main banner.'), h('button', { class: 'btn primary', onclick: () => save({ geo_name: gname.value, geo_description: gdesc.value }) }, 'Save'));
      body.append(h('p', { class: 'muted' }, 'Your channel is the same on both platforms. If you want a different name, picture and description for your mapping audience, turn this on.'), h('div', { class: 'row mb16' }, sep, h('b', 'Use a separate identity on GeoTube')), fields);
    } else {
      const m = ch.moderation || {};
      const holdAll = h('input', { type: 'checkbox', checked: !!m.hold_all }), holdLinks = h('input', { type: 'checkbox', checked: !!m.hold_links }), words = h('textarea', { class: 'input', placeholder: 'One word or phrase per line' }, (m.blocked || []).join('\n'));
      body.append(h('label', { class: 'check' }, holdAll, h('div', h('b', 'Hold all comments for review'), h('span', 'Nothing appears until you approve it.'))), h('label', { class: 'check' }, holdLinks, h('div', h('b', 'Hold comments with links'))), h('div', { class: 'field mt16' }, h('label', 'Blocked words'), words, h('div', { class: 'hint' }, 'Comments containing these are held for review.')),
        h('button', { class: 'btn primary', onclick: () => save({ moderation: { hold_all: holdAll.checked, hold_links: holdLinks.checked, blocked: words.value.split('\n').map(s => s.trim()).filter(Boolean) } }) }, 'Save'));
    }
    wrap.append(body);
    return wrap;
  }, { pageTitle: 'Customisation' }));

  /* ---------- posts ---------- */
  route('/studio/posts', ctx => shell(ctx, 'posts', async ch => {
    const data = await get(`/api/channels/${ch.handle}?platform=${ctx.platform}`);
    const ta = h('textarea', { class: 'input', placeholder: 'Share an update with your subscribers...' });
    const list = h('div');
    const media = p => { const l = (p.attachments || []).filter(a => a && a.url); return l.length ? h('div', { class: 'post-media n' + Math.min(l.length, 4) }, l.map(a => VT.mediaNode(a, 'post-img'))) : null; };
    const row = p => h('div', { class: 'post' }, h('div', { class: 'row between small muted' }, h('span', ago(p.created_at)), h('button', { class: 'btn xs ghost', onclick: async e => { await del('/api/studio/posts/' + p.id + chP()); e.target.closest('.post').remove(); } }, 'Delete')), p.body ? h('div', { class: 'mt8' }, p.body) : null, media(p));
    data.posts.forEach(p => list.append(row(p)));
    const attach = VT.attachmentPicker({ max: 4, kind: 'post' });
    const send = async () => { const body = ta.value.trim(); if (!body && !attach.count()) return; try { const r = await post('/api/studio/posts' + chP(), { body, attachments: attach.get() }); list.prepend(row({ id: r.id, body, attachments: r.attachments, created_at: Date.now() })); ta.value = ''; attach.clear(); toast('Posted'); } catch (e) { errToast(e); } };
    return h('div', h('h1', { class: 'mb16' }, 'Community posts'), h('div', { class: 'card mb16' }, ta, attach.node, h('div', { class: 'row mt8', style: { justifyContent: 'space-between' } }, h('span', { class: 'small muted' }, 'Up to 4 pictures or GIFs per post.'), h('button', { class: 'btn primary', onclick: send }, 'Post'))), list);
  }, { pageTitle: 'Posts' }));

  /* ---------- monetisation ---------- */
  route('/studio/monetization', ctx => shell(ctx, 'monetization', async ch => {
    const m = await sget('/api/studio/monetization');
    const wrap = h('div', h('h1', { class: 'mb16' }, 'Monetisation'));
    const pct = (a, b) => Math.min(100, Math.round(100 * a / b));
    wrap.append(h('div', { class: 'card mb16' }, h('h3', 'Partner programme requirements'), h('div', { class: 'mt16' }, h('div', { class: 'row between small' }, h('span', 'Subscribers'), h('span', `${fmtFull(m.progress.subscribers)} / ${m.progress.min.subscribers}`)), h('div', { class: 'progress mt8' }, h('div', { style: { width: pct(m.progress.subscribers, m.progress.min.subscribers) + '%' } }))),
      h('div', { class: 'mt16' }, h('div', { class: 'row between small' }, h('span', 'Public watch hours (12 months)'), h('span', `${fmtFull(m.progress.watch_hours)} / ${m.progress.min.watch_hours}`)), h('div', { class: 'progress mt8' }, h('div', { style: { width: pct(m.progress.watch_hours, m.progress.min.watch_hours) + '%' } }))),
      h('div', { class: 'mt16' }, !m.enabled ? h('div', { class: 'notice' }, 'The partner programme is not open yet on this server. Keep growing; you will be able to apply here once it opens.') : m.status === 'approved' ? h('div', { class: 'notice good' }, h('b', 'You are a partner. '), `Estimated earnings last 28 days: €${m.estimated_earnings.toFixed(2)}. Turn monetisation on per video from the content list.`) : m.status === 'applied' ? h('div', { class: 'notice warn' }, 'Your application is under review (sent ' + fmtDate(m.applied_at) + ').') : m.status === 'rejected' ? h('div', { class: 'notice bad' }, 'Your previous application was not approved. You can apply again.') : null,
        m.enabled && ['not_applied', 'rejected'].includes(m.status) ? h('button', { class: 'btn primary', disabled: !m.progress.eligible || !ch.isOwner, onclick: async () => { try { await post('/api/studio/monetization/apply' + chP()); toast('Application sent'); VT.render(); } catch (e) { errToast(e); } } }, m.progress.eligible ? 'Apply now' : 'Not eligible yet') : null)));
    const method = h('select', { class: 'select' }, h('option', { value: 'bank', selected: m.payment.method === 'bank' }, 'Bank transfer (IBAN)'), h('option', { value: 'paypal', selected: m.payment.method === 'paypal' }, 'PayPal')), account = h('input', { class: 'input', value: m.payment.account || '', placeholder: 'IBAN or PayPal email' }), name = h('input', { class: 'input', value: m.payment.name || '', placeholder: 'Account holder' });
    wrap.append(h('div', { class: 'card', style: { maxWidth: '520px' } }, h('h3', { class: 'mb8' }, 'Payment details'), h('div', { class: 'field' }, h('label', 'Method'), method), h('div', { class: 'field' }, h('label', 'Account'), account), h('div', { class: 'field' }, h('label', 'Name'), name), h('button', { class: 'btn primary', disabled: !ch.isOwner, onclick: async () => { try { await patch('/api/studio/monetization' + chP(), { method: method.value, account: account.value, name: name.value }); toast('Saved'); } catch (e) { errToast(e); } } }, 'Save')));
    return wrap;
  }, { pageTitle: 'Monetisation' }));

  /* ---------- audio library ---------- */
  route('/studio/audio', ctx => shell(ctx, 'audio', async () => {
    const tracks = await get('/api/studio/audio');
    return h('div', h('h1', { class: 'mb8' }, 'Audio library'), h('p', { class: 'muted mb16' }, 'Royalty-free tracks you can use in your videos. Download and mix them in your editor.'),
      tracks.length ? h('div', { class: 'card' }, tracks.map(t => h('div', { class: 'audio-track' }, icon('music'), h('div', { class: 'grow' }, h('b', t.title), h('div', { class: 'small muted' }, t.mood + ' · ' + fmtDur(t.duration))), h('audio', { controls: true, preload: 'none', src: t.url }), h('a', { class: 'btn sm outline', href: t.url, download: t.title + '.mp3' }, icon('download'), 'Download')))) : h('div', { class: 'empty' }, 'No tracks available yet'));
  }, { pageTitle: 'Audio library' }));

  /* ---------- studio settings: managers ---------- */
  route('/studio/settings', ctx => shell(ctx, 'settings', async ch => {
    const list = h('div');
    const draw = c => { list.innerHTML = ''; if (!c.managers.length) list.append(h('p', { class: 'muted' }, 'No managers yet.')); c.managers.forEach(m => list.append(h('div', { class: 'row between mb8' }, h('span', m.email, h('span', { class: 'dim small' }, ' · added ' + fmtDate(m.created_at))), (c.isOwner || m.id === state.user.id) ? h('button', { class: 'btn xs', onclick: async () => { ch = await del(`/api/studio/managers/${m.id}` + chP()); draw(ch); } }, 'Remove') : null))); };
    draw(ch);
    const email = h('input', { class: 'input', placeholder: 'Email address of an existing account' });
    const claims = await sget('/api/studio/claims');
    return h('div', h('h1', { class: 'mb16' }, 'Channel settings'),
      h('div', { class: 'card mb16', style: { maxWidth: '640px' } }, h('h3', { class: 'mb8' }, 'Channel managers'), h('p', { class: 'small muted' }, 'Managers can upload, edit, publish and moderate comments, but cannot delete the channel, add managers or change payment details.'), list,
        ch.isOwner ? h('div', { class: 'row mt16' }, email, h('button', { class: 'btn primary', onclick: async () => { try { ch = await post('/api/studio/managers' + chP(), { email: email.value }); email.value = ''; draw(ch); toast('Manager added'); } catch (e) { errToast(e); } } }, 'Add')) : null),
      h('div', { class: 'card', style: { maxWidth: '640px' } }, h('h3', { class: 'mb8' }, 'Copyright claims against your videos'), claims.length ? h('table', { class: 'table' }, h('thead', h('tr', h('th', 'Video'), h('th', 'Claimed work'), h('th', 'Status'))), h('tbody', claims.map(c => h('tr', h('td', h('a', { class: 'hash', href: href('/studio/video/' + c.video_id + chP()) }, c.title)), h('td', c.work), h('td', h('span', { class: 'tag ' + (c.status === 'upheld' ? 'bad' : c.status === 'rejected' ? 'good' : 'warn') }, c.status)))))) : h('p', { class: 'muted' }, 'No claims. Keep it that way!')));
  }, { pageTitle: 'Settings' }));
})();
