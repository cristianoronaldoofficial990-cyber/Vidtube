'use strict';
// Creator Studio API: uploads, video details, publishing per platform, analytics, comment moderation,
// channel customisation, managers, appeals, monetisation and community posts.
const fs = require('fs');
const path = require('path');
const {
  get, all, run, tx, route, HttpError, bad, str, oneOf, platformOf, intOf, json, now, DAY, dayStr, rid,
  need, limit, notify, audit, studioChannel, getSetting, subscriberCount, canManageChannel, channelOfUser,
} = require('./core');
const geo = require('./geo');
const safety = require('./safety');
const gifs = require('./gifs');
const media = require('./media');
const { validHandle } = require('./routes-auth');

const PUB_FIELDS = `p.platform, p.title, p.description, p.category, p.visibility, p.status, p.publish_at, p.published_at, p.review_note, p.check_json,
  p.views, p.likes, p.dislikes, p.comment_count, p.updated_at`;

/* ---------- uploads ---------- */
// Default title from the file name. Windows cannot store "?" in file names and tools replace it with "_",
// so a trailing underscore is turned back into a question mark.
function defaultTitle(filename) {
  let t = filename.replace(/\.[^.]+$/, '').trim();
  t = t.replace(/_+$/, m => '?'.repeat(m.length));
  return t.slice(0, 100) || 'Untitled video';
}
route('POST', '/api/studio/upload', async ctx => {
  const ch = studioChannel(ctx);
  limit(ctx, 'upload', 30, 3600000);
  const u = ctx.user;
  const filename = str(ctx.query.filename, 'File name', { max: 200 }) || 'video';
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (!media.VIDEO_EXT.includes(ext)) { ctx.req.resume(); throw bad(`Unsupported file type .${ext}. Use MP4, MOV, WebM, MKV, AVI or M4V.`); }
  const maxBytes = getSetting('uploads').maxVideoMB * 1048576;
  const total = intOf(ctx.req.headers['content-length'], 0);
  if (total > maxBytes) { ctx.req.resume(); throw new HttpError(413, `File is too large (limit ${getSetting('uploads').maxVideoMB} MB)`); }
  const assetId = rid(10);
  const dir = path.join(media.MEDIA_DIR, assetId);
  fs.mkdirSync(dir, { recursive: true });
  run("INSERT INTO media_assets(id,owner_id,original_name,ext,size,status,created_at) VALUES(?,?,?,?,?,'uploading',?)", assetId, u.id, filename, ext, total, now());
  const jobId = Number(run("INSERT INTO upload_jobs(user_id,asset_id,status,total_bytes,created_at) VALUES(?,?,'uploading',?,?)", u.id, assetId, total || null, now()).lastInsertRowid);
  let lastTick = 0;
  try {
    const size = await media.receiveToFile(ctx.req, path.join(dir, 'source.' + ext), maxBytes, first => {
      if (!media.sniffVideo(first)) throw bad('This file does not look like a video');
    }, n => { const t = now(); if (t - lastTick > 500) { lastTick = t; run('UPDATE upload_jobs SET bytes_received=? WHERE id=?', n, jobId); } });
    const videoId = tx(() => {
      run("UPDATE media_assets SET size=?, status='processing' WHERE id=?", size, assetId);
      run("UPDATE upload_jobs SET status='done', bytes_received=?, finished_at=? WHERE id=?", size, now(), jobId);
      const vid = rid(8);
      run('INSERT INTO videos(id,channel_id,asset_id,created_at) VALUES(?,?,?,?)', vid, ch.id, assetId, now());
      const platform = platformOf(ctx.query.platform);
      run("INSERT INTO publications(video_id,platform,title,visibility,created_at,updated_at) VALUES(?,?,?,'draft',?,?)",
        vid, platform, defaultTitle(filename), now(), now());
      return vid;
    });
    media.enqueue(assetId);
    audit(u.id, 'video.upload', 'video', videoId, { channel: ch.id, size });
    return { video_id: videoId, asset_id: assetId };
  } catch (e) {
    run("UPDATE upload_jobs SET status='failed', error=?, finished_at=? WHERE id=?", String(e.message).slice(0, 300), now(), jobId);
    run('DELETE FROM media_assets WHERE id=?', assetId);
    fs.rm(dir, { recursive: true, force: true }, () => {});
    throw e;
  }
}, { raw: true });

// Turns a GIF into a video (or a vertical Short): the GIF is looped to the wanted length and
// encoded to MP4 by FFmpeg, then it goes through the normal processing queue like any upload.
// The GIF can be one of your Halloween GIFs, a GIF you uploaded, or a GIPHY GIF (fetched by the server).
const GIPHY_URL = /^https:\/\/([a-z0-9-]+\.)*giphy\.com\/[^\s"'<>]+$/i;
route('POST', '/api/studio/from-gif', async ctx => {
  const ch = studioChannel(ctx);
  limit(ctx, 'upload', 30, 3600000);
  if (!media.hasFfmpeg) throw new HttpError(503, 'FFmpeg is not installed on this server, so GIFs cannot be turned into videos');
  const u = ctx.user;
  const b = ctx.body || {};
  const short = b.short === true;
  const title = str(b.title, 'Title', { max: 100 });
  const platform = platformOf(b.platform);
  const list = Array.isArray(b.gifs) ? b.gifs : b.gif ? [b.gif] : [];
  if (!list.length) throw bad('Choose a GIF first');
  if (list.length > 10) throw bad('At most 10 GIFs per video');
  // Length per GIF; the whole video stays within 60 s (Short) or 180 s.
  const maxTotal = short ? 60 : 180;
  const seconds = Math.max(1, Math.min(maxTotal / list.length, Number(b.seconds) || 10));

  // 1. Find every GIF file (own uploads / Halloween GIFs by ownership, GIPHY by download).
  const srcs = [], tmps = [], names = [];
  const cleanup = () => tmps.forEach(t => fs.rm(t, { force: true }, () => {}));
  try {
    for (const g of list) {
      if (!g || !g.source) throw bad('Choose a GIF first');
      if (g.source === 'giphy') {
        const url = String(g.url || '');
        if (!GIPHY_URL.test(url)) throw bad('Only GIFs from GIPHY can be used by link');
        let res;
        try { res = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' }); } catch { throw new HttpError(502, 'A GIF could not be downloaded from GIPHY'); }
        if (!res.ok) throw new HttpError(502, 'A GIF could not be downloaded from GIPHY');
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 15 * 1048576) throw bad('A GIF is too large (limit 15 MB)');
        if (media.sniffImage(buf) !== 'gif') throw bad('That link is not a GIF');
        const t = path.join(media.TMP_DIR, 'gif_' + rid(10) + '.gif');
        fs.writeFileSync(t, buf); tmps.push(t); srcs.push(t);
        names.push(str(g.title, 'Title', { max: 100 }) || 'GIPHY GIF');
      } else {
        const a = gifs.parseAttachment(g, u.id); // checks that the GIF belongs to this account
        if (!a || a.kind !== 'gif') throw bad('Only GIFs can be turned into a video');
        srcs.push(path.join(media.FILES_DIR, a.file));
        names.push(a.title || 'My GIF');
      }
    }
    for (const s of srcs) if (!fs.existsSync(s)) throw bad('A GIF file no longer exists');
  } catch (e) { cleanup(); throw e; }

  // 2. Loop each GIF for `seconds`, play them one after another and encode to MP4.
  //    Short: 720x1280 with each GIF centred on a blurred copy of itself. One normal GIF keeps its own
  //    shape; several normal GIFs are put on a 1280x720 canvas the same blurred way so they can be joined.
  const assetId = rid(10);
  const dir = path.join(media.MEDIA_DIR, assetId);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'source.mp4');
  const n = srcs.length;
  const args = ['-y', '-v', 'error'];
  srcs.forEach(s => args.push('-stream_loop', '-1', '-t', seconds.toFixed(2), '-i', s));
  const canvas = (i, W, H) => `[${i}:v]fps=30,split[a${i}][b${i}];[a${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:5,setsar=1[bg${i}];[b${i}]scale=${W}:${H}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[fg${i}];[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2,format=yuv420p,trim=duration=${seconds.toFixed(2)},setpts=PTS-STARTPTS[v${i}]`;
  let vf;
  if (short) vf = srcs.map((s, i) => canvas(i, 720, 1280)).join(';');
  else if (n === 1) vf = "[0:v]fps=30,scale=w='if(lt(iw,640),640,trunc(iw/2)*2)':h=-2:flags=lanczos,setsar=1,format=yuv420p[v0]";
  else vf = srcs.map((s, i) => canvas(i, 1280, 720)).join(';');
  vf += ';' + srcs.map((s, i) => `[v${i}]`).join('') + (n > 1 ? `concat=n=${n}:v=1:a=0[out]` : 'null[out]');
  args.push('-filter_complex', vf, '-map', '[out]', '-t', (seconds * n).toFixed(2), '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart', '-an', out);
  const r = await media.runFf(media.FFMPEG, args, { signal: AbortSignal.timeout(300000) });
  cleanup();
  let size = 0; try { size = fs.statSync(out).size; } catch {}
  if (r.code !== 0 || !size) { fs.rm(dir, { recursive: true, force: true }, () => {}); throw new HttpError(500, 'The video could not be made' + (r.err ? ': ' + r.err.split('\n').filter(Boolean).pop() : '')); }

  // 3. Register it exactly like an upload and let the queue make the playable versions + thumbnail.
  const name = n === 1 ? names[0] : `${names[0]} + ${n - 1} more`;
  const videoId = tx(() => {
    run("INSERT INTO media_assets(id,owner_id,original_name,ext,size,status,created_at) VALUES(?,?,?,?,?,'processing',?)", assetId, u.id, name + '.gif', 'mp4', size, now());
    const vid = rid(8);
    run('INSERT INTO videos(id,channel_id,asset_id,is_short,created_at) VALUES(?,?,?,?,?)', vid, ch.id, assetId, short ? 1 : 0, now());
    run("INSERT INTO publications(video_id,platform,title,visibility,created_at,updated_at) VALUES(?,?,?,'draft',?,?)", vid, platform, title || defaultTitle(name), now(), now());
    return vid;
  });
  media.enqueue(assetId);
  audit(u.id, 'video.from_gif', 'video', videoId, { channel: ch.id, short, seconds, count: n, sources: list.map(g => g.source) });
  return { video_id: videoId, asset_id: assetId };
});

route('GET', '/api/studio/upload/:assetId', ctx => {
  need(ctx);
  const a = get('SELECT id,status,error,duration,width,height,qualities FROM media_assets WHERE id=?', ctx.params.assetId);
  if (!a) throw new HttpError(404, 'Upload not found');
  const v = get('SELECT id, thumb, is_short FROM videos WHERE asset_id=?', a.id);
  return { ...a, qualities: json(a.qualities, []), video: v || null,
    queue_position: a.status === 'processing' ? get(`SELECT COUNT(*) AS n FROM processing_jobs j WHERE j.status IN ('queued','running') AND j.id < (SELECT MAX(id) FROM processing_jobs WHERE asset_id=?)`, a.id).n : 0 };
});

route('POST', '/api/studio/images', async ctx => {
  need(ctx);
  limit(ctx, 'img', 60, 3600000);
  const kind = oneOf(ctx.query.kind, ['thumb', 'avatar', 'banner', 'geo_avatar', 'geo_banner', 'watermark'], 'Image kind');
  const name = await media.saveImage(ctx, kind);
  return { file: name, url: '/files/' + name };
}, { raw: true });

route('POST', '/api/studio/captions', async ctx => {
  const u = need(ctx);
  limit(ctx, 'cap', 60, 3600000);
  const tmp = path.join(media.TMP_DIR, rid(12));
  await media.receiveToFile(ctx.req, tmp, 2 * 1048576, first => {
    const head = first.toString('utf8', 0, 20);
    if (!/^﻿?WEBVTT/.test(head) && !/^\s*1\s*\r?\n/.test(head)) throw bad('Captions must be a WebVTT (.vtt) or SubRip (.srt) file');
  });
  let text = fs.readFileSync(tmp, 'utf8').replace(/^﻿/, '');
  fs.rmSync(tmp, { force: true });
  if (!/^WEBVTT/.test(text)) { // minimal SRT -> VTT conversion
    text = 'WEBVTT\n\n' + text.replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  }
  const name = `c_${rid(12)}.vtt`;
  fs.writeFileSync(path.join(media.FILES_DIR, name), text);
  run('INSERT INTO files(name,user_id,kind,created_at) VALUES(?,?,?,?)', name, u.id, 'captions', now());
  return { file: name, url: '/files/' + name };
}, { raw: true });

/* ---------- content list + details ---------- */
function studioVideo(ctx, id) {
  const u = need(ctx);
  const v = get(`SELECT v.*, a.status AS asset_status, a.error AS asset_error, a.duration, a.width, a.height, a.qualities, a.original_name, a.size
    FROM videos v JOIN media_assets a ON a.id=v.asset_id WHERE v.id=?`, id);
  if (!v) throw new HttpError(404, 'Video not found');
  if (!canManageChannel(u, v.channel_id)) throw new HttpError(403, 'You cannot edit this video');
  return v;
}
function videoOut(v) {
  return {
    id: v.id, channel_id: v.channel_id, asset_id: v.asset_id, thumb: v.thumb, captions: v.captions, tags: json(v.tags, []),
    is_short: !!v.is_short, made_for_kids: !!v.made_for_kids, allow_comments: !!v.allow_comments, allow_download: !!v.allow_download,
    sponsored: !!v.sponsored, monetized: !!v.monetized, is_demo: !!v.is_demo, created_at: v.created_at,
    asset: { status: v.asset_status, error: v.asset_error, duration: v.duration, width: v.width, height: v.height, original_name: v.original_name, size: v.size,
      qualities: json(v.qualities, []).map(q => ({ ...q, url: `/media/${v.asset_id}/${q.file}` })) },
    publications: all(`SELECT ${PUB_FIELDS} FROM publications p WHERE p.video_id=?`, v.id).map(p => ({ ...p, check: json(p.check_json, null) })),
    appeals: all('SELECT id, platform, text, status, response, created_at, resolved_at FROM appeals WHERE video_id=? ORDER BY id DESC', v.id),
    claims: all('SELECT id, work, status, response, created_at FROM copyright_claims WHERE video_id=? ORDER BY id DESC', v.id),
  };
}
route('GET', '/api/studio/content', ctx => {
  const ch = studioChannel(ctx);
  const platform = ctx.query.platform ? platformOf(ctx.query.platform) : null;
  const filter = ctx.query.filter || 'all';
  const q = str(ctx.query.q, 'Search', { max: 100 });
  const page = intOf(ctx.query.page, 0, 0, 1000), lim = 30;
  let where = 'v.channel_id=?'; const args = [ch.id];
  if (q) { where += ' AND EXISTS(SELECT 1 FROM publications p WHERE p.video_id=v.id AND p.title LIKE ?)'; args.push(`%${q}%`); }
  const platSql = platform ? ' AND p.platform=?' : '';
  const platArgs = platform ? [platform] : [];
  if (filter === 'failed') where += " AND a.status='failed'";
  else if (filter === 'processing') where += " AND a.status IN ('uploading','processing')";
  else if (filter === 'drafts') { where += ` AND NOT EXISTS(SELECT 1 FROM publications p WHERE p.video_id=v.id AND p.visibility<>'draft'${platSql})`; args.push(...platArgs); }
  else if (['public', 'private', 'unlisted', 'scheduled'].includes(filter)) { where += ` AND EXISTS(SELECT 1 FROM publications p WHERE p.video_id=v.id AND p.visibility=?${platSql})`; args.push(filter, ...platArgs); }
  else if (['pending', 'rejected', 'removed', 'restricted'].includes(filter)) { where += ` AND EXISTS(SELECT 1 FROM publications p WHERE p.video_id=v.id AND p.status=?${platSql})`; args.push(filter, ...platArgs); }
  else if (filter === 'shorts') where += ' AND v.is_short=1';
  else if (platform) { where += ` AND EXISTS(SELECT 1 FROM publications p WHERE p.video_id=v.id${platSql})`; args.push(...platArgs); }
  const rows = all(`SELECT v.*, a.status AS asset_status, a.error AS asset_error, a.duration, a.width, a.height, a.qualities, a.original_name, a.size
    FROM videos v JOIN media_assets a ON a.id=v.asset_id WHERE ${where} ORDER BY v.created_at DESC LIMIT ? OFFSET ?`, ...args, lim, page * lim);
  return { items: rows.map(videoOut), more: rows.length === lim, channel: { id: ch.id, handle: ch.handle, name: ch.name, isOwner: ch.isOwner } };
});
route('GET', '/api/studio/videos/:id', ctx => videoOut(studioVideo(ctx, ctx.params.id)));

route('PATCH', '/api/studio/videos/:id', ctx => {
  const v = studioVideo(ctx, ctx.params.id);
  const b = ctx.body;
  const tags = Array.isArray(b.tags) ? b.tags.map(t => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 30) : json(v.tags, []);
  const bool = (val, cur) => (typeof val === 'boolean' ? (val ? 1 : 0) : cur);
  const owner = get('SELECT user_id FROM channels WHERE id=?', v.channel_id).user_id;
  const fileOwner = ctx.user.id === owner ? owner : ctx.user.id;
  const thumb = b.thumb !== undefined ? media.ownFile(fileOwner, b.thumb, v.thumb) : v.thumb;
  const captions = b.captions !== undefined ? media.ownFile(fileOwner, b.captions, v.captions) : v.captions;
  run(`UPDATE videos SET thumb=?, captions=?, tags=?, is_short=?, made_for_kids=?, allow_comments=?, allow_download=?, sponsored=? WHERE id=?`,
    thumb, captions, JSON.stringify([...new Set(tags)]), bool(b.is_short, v.is_short), bool(b.made_for_kids, v.made_for_kids),
    bool(b.allow_comments, v.allow_comments), bool(b.allow_download, v.allow_download), bool(b.sponsored, v.sponsored), v.id);
  if (thumb !== v.thumb && v.thumb && !v.thumb.startsWith('t_')) media.deleteFile(v.thumb);
  if (Array.isArray(b.tags)) for (const p of all('SELECT platform FROM publications WHERE video_id=?', v.id)) safety.rescanPublication(v.id, p.platform);
  return videoOut(studioVideo(ctx, v.id));
});

// Creates or updates the publication of a video on one platform (VidTube or GeoTube).
route('PUT', '/api/studio/videos/:id/publications/:platform', ctx => {
  const v = studioVideo(ctx, ctx.params.id);
  const platform = platformOf(ctx.params.platform);
  const b = ctx.body;
  const cur = get('SELECT * FROM publications WHERE video_id=? AND platform=?', v.id, platform);
  const title = str(b.title !== undefined ? b.title : cur && cur.title, 'Title', { min: 1, max: 100 });
  const description = str(b.description !== undefined ? b.description : cur && cur.description, 'Description', { max: 5000 });
  let category = b.category !== undefined ? (b.category || null) : cur ? cur.category : null;
  if (category && !get('SELECT 1 AS x FROM categories WHERE platform=? AND slug=? AND active=1', platform, category)) throw bad('Unknown category');
  let visibility = b.visibility ? oneOf(b.visibility, ['public', 'unlisted', 'private', 'draft', 'scheduled'], 'Visibility') : cur ? cur.visibility : 'draft';
  let publishAt = null;
  if (visibility === 'scheduled') {
    publishAt = Number(b.publish_at) || (cur && cur.publish_at);
    if (!publishAt || publishAt < now() + 60000) throw bad('Choose a scheduled time at least one minute in the future');
  }
  if (platform === 'geotube' && !category && visibility !== 'draft') throw bad('Choose a GeoTube category');
  const ch = get('SELECT * FROM channels WHERE id=?', v.channel_id);
  if (ch.suspended) throw new HttpError(403, 'This channel is suspended');
  let status = cur ? cur.status : 'approved';
  let check = cur ? json(cur.check_json, null) : null;
  let reviewNote = cur ? cur.review_note : null;
  const humanRejected = cur && cur.human_reviewed && ['rejected', 'removed'].includes(cur.status);
  if (cur && cur.status === 'removed') throw new HttpError(403, 'This publication was removed by a moderator. You can appeal from the video page.');
  if (platform === 'geotube' && visibility !== 'draft') {
    check = geo.checkEligibility({ title, description, tags: json(v.tags, []), category, channelId: v.channel_id });
    const metaChanged = !cur || cur.title !== title || cur.description !== description || cur.category !== category || cur.status === 'pending';
    if (metaChanged || !cur || cur.visibility === 'draft') {
      status = geo.initialStatus(check, humanRejected);
      if (status === 'approved') reviewNote = null;
    }
  }
  // Sexual-content detector: one hit holds the video for a moderator, on VidTube as well as GeoTube.
  let safetyHold = false;
  if (visibility !== 'draft' && status !== 'removed') {
    const scan = safety.scanVideo({ title, description, tags: json(v.tags, []) });
    const applied = safety.applyScan(check, scan, cur, v);
    check = applied.check;
    if (applied.hold && status !== 'rejected') { safetyHold = status !== 'pending' || !cur || cur.status !== 'pending'; status = 'pending'; }
    // The term is gone again: a VidTube video held only by the detector goes live without waiting.
    else if (!applied.hold && platform !== 'geotube' && status === 'pending') status = 'approved';
  }
  const wasLive = cur && cur.visibility === 'public' && cur.status === 'approved';
  const publishedAt = cur && cur.published_at ? cur.published_at : (visibility === 'public' && status === 'approved' ? now() : null);
  tx(() => {
    if (cur) run(`UPDATE publications SET title=?, description=?, category=?, visibility=?, status=?, publish_at=?, published_at=?, review_note=?, check_json=?, human_reviewed=?, updated_at=? WHERE video_id=? AND platform=?`,
      title, description, category, visibility, status, publishAt, publishedAt, reviewNote, check ? JSON.stringify(check) : null,
      status === 'pending' && humanRejected ? 1 : (cur.human_reviewed && !['approved'].includes(status) ? cur.human_reviewed : 0), now(), v.id, platform);
    else run(`INSERT INTO publications(video_id,platform,title,description,category,visibility,status,publish_at,published_at,check_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      v.id, platform, title, description, category, visibility, status, publishAt, publishedAt, check ? JSON.stringify(check) : null, now(), now());
  });
  if (safetyHold) {
    safety.notifyHold(v, { platform, title }, ch.user_id);
    audit(null, 'safety.hold', 'video', v.id, { platform, hits: check.safety.hits });
  } else if (platform === 'geotube' && status === 'pending' && visibility !== 'draft' && (!cur || cur.status !== 'pending' || !wasLive)) {
    notify(ch.user_id, 'geotube_review', 'Your GeoTube submission is in review', `"${title}" will be checked by a moderator before it appears on GeoTube.`, `/studio/video/${v.id}`);
    for (const m of all("SELECT id FROM users WHERE role IN ('moderator','admin')")) notify(m.id, 'moderation', 'New GeoTube submission to review', title, '/admin/queue');
  }
  audit(ctx.user.id, 'publication.save', 'video', v.id, { platform, visibility, status });
  return videoOut(studioVideo(ctx, v.id));
});
route('DELETE', '/api/studio/videos/:id/publications/:platform', ctx => {
  const v = studioVideo(ctx, ctx.params.id);
  const platform = platformOf(ctx.params.platform);
  if (get('SELECT COUNT(*) AS n FROM publications WHERE video_id=?', v.id).n <= 1) throw bad('A video needs at least one platform. Delete the video instead.');
  run('DELETE FROM publications WHERE video_id=? AND platform=?', v.id, platform);
  run('DELETE FROM reactions WHERE video_id=? AND platform=?', v.id, platform);
  run('DELETE FROM comments WHERE video_id=? AND platform=?', v.id, platform);
  audit(ctx.user.id, 'publication.delete', 'video', v.id, { platform });
  return videoOut(studioVideo(ctx, v.id));
});
route('DELETE', '/api/studio/videos/:id', ctx => {
  const v = studioVideo(ctx, ctx.params.id);
  tx(() => {
    run('UPDATE channels SET featured_video_id=NULL WHERE featured_video_id=?', v.id);
    run('UPDATE channels SET trailer_video_id=NULL WHERE trailer_video_id=?', v.id);
    run('DELETE FROM videos WHERE id=?', v.id);
  });
  if (v.thumb) media.deleteFile(v.thumb);
  if (v.captions) media.deleteFile(v.captions);
  media.releaseAsset(v.asset_id);
  audit(ctx.user.id, 'video.delete', 'video', v.id);
  return { ok: true };
});
route('POST', '/api/studio/geotube/check', ctx => {
  need(ctx);
  const tags = Array.isArray(ctx.body.tags) ? ctx.body.tags.map(String) : [];
  const ch = channelOfUser(ctx.user.id);
  const check = geo.checkEligibility({ title: String(ctx.body.title || ''), description: String(ctx.body.description || ''), tags, category: ctx.body.category || null, channelId: ch ? ch.id : null });
  return { ...check, would_be: geo.initialStatus(check, false) };
});

/* ---------- appeals + claims ---------- */
route('POST', '/api/studio/appeals', ctx => {
  const v = studioVideo(ctx, ctx.body.video_id);
  limit(ctx, 'appeal', 10, 3600000);
  const platform = platformOf(ctx.body.platform);
  const p = get('SELECT * FROM publications WHERE video_id=? AND platform=?', v.id, platform);
  if (!p || !['rejected', 'removed', 'restricted'].includes(p.status)) throw bad('Only rejected, restricted or removed videos can be appealed');
  if (get("SELECT 1 AS x FROM appeals WHERE video_id=? AND platform=? AND status='open'", v.id, platform)) throw bad('An appeal is already open for this video');
  run('INSERT INTO appeals(user_id,video_id,platform,text,created_at) VALUES(?,?,?,?,?)', ctx.user.id, v.id, platform, str(ctx.body.text, 'Appeal', { min: 20, max: 3000 }), now());
  for (const m of all("SELECT id FROM users WHERE role IN ('moderator','admin')")) notify(m.id, 'moderation', 'New appeal submitted', p.title, '/admin/appeals');
  return videoOut(studioVideo(ctx, v.id));
});
route('GET', '/api/studio/claims', ctx => {
  const ch = studioChannel(ctx);
  return all(`SELECT c.id, c.video_id, c.work, c.status, c.response, c.created_at, c.resolved_at, (SELECT title FROM publications p WHERE p.video_id=c.video_id LIMIT 1) AS title
    FROM copyright_claims c JOIN videos v ON v.id=c.video_id WHERE v.channel_id=? ORDER BY c.id DESC`, ch.id);
});

/* ---------- dashboard + analytics ---------- */
function series(channelId, platform, days) {
  const from = dayStr(now() - (days - 1) * DAY);
  const rows = all(`SELECT day, type, SUM(value) AS n FROM analytics_events WHERE channel_id=? AND day>=? ${platform ? 'AND platform=?' : ''} AND type IN ('view','watch','sub','unsub','like','comment') GROUP BY day, type`,
    ...(platform ? [channelId, from, platform] : [channelId, from]));
  const byDay = {};
  for (let i = days - 1; i >= 0; i--) { const d = dayStr(now() - i * DAY); byDay[d] = { day: d, view: 0, watch: 0, sub: 0, unsub: 0, like: 0, comment: 0 }; }
  for (const r of rows) if (byDay[r.day]) byDay[r.day][r.type] = r.n;
  return Object.values(byDay);
}
function sumSeries(s) {
  const t = { view: 0, watch: 0, sub: 0, unsub: 0, like: 0, comment: 0 };
  for (const d of s) for (const k of Object.keys(t)) t[k] += d[k];
  return t;
}
route('GET', '/api/studio/dashboard', ctx => {
  const ch = studioChannel(ctx);
  const platform = ctx.query.platform ? platformOf(ctx.query.platform) : null;
  const s28 = series(ch.id, platform, 28), s48 = sumSeries(series(ch.id, platform, 2));
  const totals = sumSeries(s28);
  const latest = get(`SELECT p.video_id, p.platform, p.title, p.views, p.likes, p.comment_count, p.published_at, v.thumb FROM publications p JOIN videos v ON v.id=p.video_id
    WHERE v.channel_id=? AND p.visibility='public' AND p.status='approved' ${platform ? 'AND p.platform=?' : ''} ORDER BY p.published_at DESC LIMIT 1`, ...(platform ? [ch.id, platform] : [ch.id]));
  const typical = get(`SELECT AVG(views) AS v FROM (SELECT p.views FROM publications p JOIN videos v ON v.id=p.video_id WHERE v.channel_id=? AND p.visibility='public' ORDER BY p.published_at DESC LIMIT 10)`, ch.id).v || 0;
  const avgPct = get(`SELECT AVG(max_decile) AS d FROM video_views vv JOIN videos v ON v.id=vv.video_id WHERE v.channel_id=? AND vv.max_decile>=0 AND vv.created_at>?`, ch.id, now() - 28 * DAY).d;
  return {
    channel: { id: ch.id, name: ch.name, handle: ch.handle, avatar: ch.avatar, isOwner: ch.isOwner, subscribers: subscriberCount(ch.id) },
    last28: { ...totals, watch_hours: Math.round(totals.watch / 360) / 10, series: s28, avg_pct: avgPct == null ? null : Math.round((avgPct + 1) * 10) },
    last48h: { views: s48.view },
    latest: latest ? { ...latest, typical_views: Math.round(typical) } : null,
    pending_review: all(`SELECT p.video_id, p.platform, p.title, p.updated_at FROM publications p JOIN videos v ON v.id=p.video_id WHERE v.channel_id=? AND p.status='pending'`, ch.id),
    processing: all(`SELECT v.id, a.status, a.original_name FROM videos v JOIN media_assets a ON a.id=v.asset_id WHERE v.channel_id=? AND a.status IN ('processing','uploading','failed')`, ch.id),
    held_comments: get(`SELECT COUNT(*) AS n FROM comments c JOIN videos v ON v.id=c.video_id WHERE v.channel_id=? AND c.status='held'`, ch.id).n,
    recent_comments: all(`SELECT c.id, c.body, c.created_at, c.video_id, c.platform, p.title, COALESCE(ch2.name, u.email) AS author, ch2.avatar FROM comments c JOIN videos v ON v.id=c.video_id
      JOIN publications p ON p.video_id=c.video_id AND p.platform=c.platform JOIN users u ON u.id=c.user_id LEFT JOIN channels ch2 ON ch2.user_id=c.user_id
      WHERE v.channel_id=? AND c.status='visible' AND c.user_id<>? ORDER BY c.id DESC LIMIT 5`, ch.id, ch.user_id),
    announcements: all('SELECT id,title,body,created_at FROM announcements WHERE active=1 ORDER BY id DESC LIMIT 2'),
    monetization: get('SELECT status FROM monetization WHERE channel_id=?', ch.id) || { status: 'not_applied' },
  };
});
route('GET', '/api/studio/analytics', ctx => {
  const ch = studioChannel(ctx);
  const platform = ctx.query.platform ? platformOf(ctx.query.platform) : null;
  const days = intOf(ctx.query.days, 28, 7, 365);
  const s = series(ch.id, platform, days);
  const prev = sumSeries(series(ch.id, platform, days * 2).slice(0, days));
  const totals = sumSeries(s);
  const from = dayStr(now() - (days - 1) * DAY);
  const pa = platform ? [platform] : [];
  const pf = platform ? ' AND e.platform=?' : '';
  const group = (col, type = 'view') => all(`SELECT COALESCE(${col},'Unknown') AS k, SUM(value) AS n FROM analytics_events e WHERE channel_id=? AND day>=? AND type=?${pf} GROUP BY k ORDER BY n DESC LIMIT 12`, ch.id, from, type, ...pa);
  const subsNow = subscriberCount(ch.id);
  let running = subsNow;
  const subSeries = [...s].reverse().map(d => { const r = { day: d.day, subscribers: running }; running -= (d.sub - d.unsub); return r; }).reverse();
  return {
    days, totals: { ...totals, watch_hours: Math.round(totals.watch / 360) / 10, subscribers: subsNow, net_subs: totals.sub - totals.unsub },
    previous: { ...prev, watch_hours: Math.round(prev.watch / 360) / 10 },
    series: s.map((d, i) => ({ ...d, subscribers: subSeries[i].subscribers })),
    top_videos: all(`SELECT e.video_id, e.platform, p.title, v.thumb, SUM(CASE WHEN e.type='view' THEN e.value ELSE 0 END) AS views,
        SUM(CASE WHEN e.type='watch' THEN e.value ELSE 0 END) AS watch, SUM(CASE WHEN e.type='like' THEN e.value ELSE 0 END) AS likes
      FROM analytics_events e JOIN publications p ON p.video_id=e.video_id AND p.platform=e.platform JOIN videos v ON v.id=e.video_id
      WHERE e.channel_id=? AND e.day>=? AND e.video_id IS NOT NULL${pf} GROUP BY e.video_id, e.platform ORDER BY views DESC LIMIT 10`, ch.id, from, ...pa),
    sources: group('source'), devices: group('device'), countries: group('country'),
    platforms: all(`SELECT platform AS k, SUM(value) AS n FROM analytics_events e WHERE channel_id=? AND day>=? AND type='view' GROUP BY platform`, ch.id, from),
    realtime: all(`SELECT (created_at/3600000)*3600000 AS hour, SUM(value) AS n FROM analytics_events e WHERE channel_id=? AND type='view' AND created_at>?${pf} GROUP BY hour ORDER BY hour`, ch.id, now() - 48 * 3600000, ...pa),
    sub_sources: all(`SELECT COALESCE(p.title,'Channel page') AS k, SUM(e.value) AS n FROM analytics_events e LEFT JOIN publications p ON p.video_id=e.source AND p.platform=e.platform WHERE e.channel_id=? AND e.day>=? AND e.type='sub' GROUP BY k ORDER BY n DESC LIMIT 8`, ch.id, from),
  };
});
route('GET', '/api/studio/analytics/video/:id', ctx => {
  const v = studioVideo(ctx, ctx.params.id);
  const platform = ctx.query.platform ? platformOf(ctx.query.platform) : null;
  const days = intOf(ctx.query.days, 28, 7, 365);
  const from = dayStr(now() - (days - 1) * DAY);
  const pf = platform ? ' AND platform=?' : ''; const pa = platform ? [platform] : [];
  const rows = all(`SELECT day, type, SUM(value) AS n FROM analytics_events WHERE video_id=? AND day>=?${pf} GROUP BY day, type`, v.id, from, ...pa);
  const byDay = {};
  for (let i = days - 1; i >= 0; i--) { const d = dayStr(now() - i * DAY); byDay[d] = { day: d, view: 0, watch: 0, like: 0, comment: 0, sub: 0 }; }
  for (const r of rows) if (byDay[r.day] && r.type in byDay[r.day]) byDay[r.day][r.type] = r.n;
  const viewers = all(`SELECT max_decile FROM video_views WHERE video_id=? AND max_decile>=0${pf}`, v.id, ...pa);
  const retention = Array.from({ length: 10 }, (_, d) => ({ decile: d, pct: viewers.length ? Math.round(100 * viewers.filter(x => x.max_decile >= d).length / viewers.length) : null }));
  const totals = Object.values(byDay).reduce((a, d) => ({ view: a.view + d.view, watch: a.watch + d.watch, like: a.like + d.like, comment: a.comment + d.comment, sub: a.sub + d.sub }), { view: 0, watch: 0, like: 0, comment: 0, sub: 0 });
  return {
    video: videoOut(v), days, series: Object.values(byDay), totals: { ...totals, watch_hours: Math.round(totals.watch / 360) / 10 }, retention,
    sources: all(`SELECT COALESCE(source,'direct') AS k, SUM(value) AS n FROM analytics_events WHERE video_id=? AND day>=? AND type='view'${pf} GROUP BY k ORDER BY n DESC`, v.id, from, ...pa),
    devices: all(`SELECT COALESCE(device,'Unknown') AS k, SUM(value) AS n FROM analytics_events WHERE video_id=? AND day>=? AND type='view'${pf} GROUP BY k ORDER BY n DESC`, v.id, from, ...pa),
    countries: all(`SELECT COALESCE(country,'Unknown') AS k, SUM(value) AS n FROM analytics_events WHERE video_id=? AND day>=? AND type='view'${pf} GROUP BY k ORDER BY n DESC LIMIT 10`, v.id, from, ...pa),
    avg_pct: viewers.length ? Math.round((viewers.reduce((a, x) => a + x.max_decile + 1, 0) / viewers.length) * 10) : null,
  };
});

/* ---------- comment moderation ---------- */
route('GET', '/api/studio/comments', ctx => {
  const ch = studioChannel(ctx);
  const filter = ctx.query.filter || 'all';
  const page = intOf(ctx.query.page, 0, 0, 1000), lim = 30;
  const status = { held: "c.status='held'", hidden: "c.status='hidden'", all: "c.status IN ('visible','held','hidden')" }[filter] || "c.status='visible'";
  const q = str(ctx.query.q, 'Search', { max: 100 });
  const rows = all(`SELECT c.*, p.title, COALESCE(ch2.name, u.email) AS author, ch2.handle AS author_handle, ch2.avatar AS author_avatar, u.id AS author_id,
      (SELECT COUNT(*) FROM comments r WHERE r.parent_id=c.id) AS reply_count,
      EXISTS(SELECT 1 FROM hidden_users h WHERE h.channel_id=? AND h.user_id=c.user_id) AS author_hidden
    FROM comments c JOIN videos v ON v.id=c.video_id JOIN publications p ON p.video_id=c.video_id AND p.platform=c.platform
    JOIN users u ON u.id=c.user_id LEFT JOIN channels ch2 ON ch2.user_id=c.user_id
    WHERE v.channel_id=? AND ${status} ${q ? 'AND c.body LIKE ?' : ''} ORDER BY c.id DESC LIMIT ? OFFSET ?`, ch.id, ch.id, ...(q ? [`%${q}%`] : []), lim, page * lim);
  return { items: rows.map(r => ({ ...r, attachment: gifs.attachmentFromRow(r.attachment), pinned: !!r.pinned, hearted: !!r.hearted, author_hidden: !!r.author_hidden, mine: r.user_id === ctx.user.id })), more: rows.length === lim,
    counts: { held: get(`SELECT COUNT(*) AS n FROM comments c JOIN videos v ON v.id=c.video_id WHERE v.channel_id=? AND c.status='held'`, ch.id).n } };
});
route('POST', '/api/studio/comments/:id/:action', ctx => {
  const u = need(ctx);
  const c = get('SELECT c.*, v.channel_id FROM comments c JOIN videos v ON v.id=c.video_id WHERE c.id=?', intOf(ctx.params.id, 0));
  if (!c || !canManageChannel(u, c.channel_id)) throw new HttpError(404, 'Comment not found');
  const action = oneOf(ctx.params.action, ['approve', 'remove', 'pin', 'unpin', 'heart', 'unheart', 'hide_user', 'unhide_user', 'reject'], 'Action');
  const bump = n => run('UPDATE publications SET comment_count=MAX(0,comment_count+?) WHERE video_id=? AND platform=?', n, c.video_id, c.platform);
  tx(() => {
    if (action === 'approve' && c.status !== 'visible') {
      run("UPDATE comments SET status='visible' WHERE id=?", c.id); bump(1);
      if (c.parent_id) { const p = get('SELECT user_id FROM comments WHERE id=?', c.parent_id); if (p && p.user_id !== c.user_id) notify(p.user_id, 'replies', 'Someone replied to your comment', c.body.slice(0, 120), (c.platform === 'geotube' ? '/geotube' : '') + `/watch?v=${c.video_id}&c=${c.id}`); }
    }
    if (action === 'reject' || action === 'remove') { if (c.status === 'visible') bump(-1 - all("SELECT COUNT(*) AS n FROM comments WHERE parent_id=? AND status='visible'", c.id)[0].n); run('DELETE FROM comments WHERE id=?', c.id); }
    if (action === 'pin') { run('UPDATE comments SET pinned=0 WHERE video_id=? AND platform=?', c.video_id, c.platform); run('UPDATE comments SET pinned=1 WHERE id=?', c.id); }
    if (action === 'unpin') run('UPDATE comments SET pinned=0 WHERE id=?', c.id);
    if (action === 'heart') { run('UPDATE comments SET hearted=1 WHERE id=?', c.id); if (c.user_id !== u.id) notify(c.user_id, 'replies', 'The creator hearted your comment', c.body.slice(0, 120), (c.platform === 'geotube' ? '/geotube' : '') + `/watch?v=${c.video_id}&c=${c.id}`); }
    if (action === 'unheart') run('UPDATE comments SET hearted=0 WHERE id=?', c.id);
    if (action === 'hide_user') {
      run('INSERT OR IGNORE INTO hidden_users(channel_id,user_id,created_at) VALUES(?,?,?)', c.channel_id, c.user_id, now());
      const vis = get(`SELECT COUNT(*) AS n FROM comments c2 JOIN videos v ON v.id=c2.video_id WHERE v.channel_id=? AND c2.user_id=? AND c2.status='visible'`, c.channel_id, c.user_id).n;
      for (const r of all(`SELECT c2.id, c2.video_id, c2.platform, c2.status FROM comments c2 JOIN videos v ON v.id=c2.video_id WHERE v.channel_id=? AND c2.user_id=?`, c.channel_id, c.user_id)) {
        if (r.status === 'visible') run('UPDATE publications SET comment_count=MAX(0,comment_count-1) WHERE video_id=? AND platform=?', r.video_id, r.platform);
        run("UPDATE comments SET status='hidden' WHERE id=?", r.id);
      }
      void vis;
    }
    if (action === 'unhide_user') run('DELETE FROM hidden_users WHERE channel_id=? AND user_id=?', c.channel_id, c.user_id);
  });
  return { ok: true };
});
route('GET', '/api/studio/hidden-users', ctx => {
  const ch = studioChannel(ctx);
  return all('SELECT h.user_id, h.created_at, COALESCE(c.name, u.email) AS name, c.handle FROM hidden_users h JOIN users u ON u.id=h.user_id LEFT JOIN channels c ON c.user_id=u.id WHERE h.channel_id=? ORDER BY h.created_at DESC', ch.id);
});
route('DELETE', '/api/studio/hidden-users/:userId', ctx => {
  const ch = studioChannel(ctx);
  run('DELETE FROM hidden_users WHERE channel_id=? AND user_id=?', ch.id, intOf(ctx.params.userId, 0));
  return { ok: true };
});

/* ---------- channel customisation ---------- */
function channelOut(ch) {
  return {
    id: ch.id, handle: ch.handle, name: ch.name, description: ch.description, avatar: ch.avatar, banner: ch.banner, country: ch.country,
    links: json(ch.links, []), featured_video_id: ch.featured_video_id, trailer_video_id: ch.trailer_video_id, sections: json(ch.sections, []),
    watermark: ch.watermark, geo_separate: !!ch.geo_separate, geo_name: ch.geo_name, geo_description: ch.geo_description, geo_avatar: ch.geo_avatar, geo_banner: ch.geo_banner,
    is_verified: !!ch.is_verified, suspended: !!ch.suspended, moderation: json(ch.moderation, {}), created_at: ch.created_at, isOwner: !!ch.isOwner,
    subscribers: subscriberCount(ch.id),
    managers: all('SELECT u.id, u.email, m.created_at FROM channel_managers m JOIN users u ON u.id=m.user_id WHERE m.channel_id=?', ch.id),
  };
}
route('GET', '/api/studio/channel', ctx => channelOut(studioChannel(ctx)));
route('PATCH', '/api/studio/channel', ctx => {
  const ch = studioChannel(ctx);
  const b = ctx.body;
  const owner = ch.user_id;
  const fileOf = (val, cur) => (val !== undefined ? media.ownFile(ctx.user.id === owner ? owner : ctx.user.id, val, cur) : cur);
  const name = b.name !== undefined ? str(b.name, 'Channel name', { min: 2, max: 50 }) : ch.name;
  const handle = b.handle !== undefined && b.handle !== ch.handle ? validHandle(b.handle, ch.id) : ch.handle;
  const links = Array.isArray(b.links) ? b.links.slice(0, 10).map(l => ({ title: String(l.title || '').slice(0, 40), url: String(l.url || '').slice(0, 300) })).filter(l => /^https?:\/\//.test(l.url)) : json(ch.links, []);
  const sections = Array.isArray(b.sections) ? b.sections.filter(s => ['featured', 'recent', 'popular', 'shorts', 'playlists', 'posts'].includes(s)).slice(0, 6) : json(ch.sections, []);
  const vidOf = (id, cur) => (id === undefined ? cur : id ? (get('SELECT id FROM videos WHERE id=? AND channel_id=?', id, ch.id) ? id : cur) : null);
  const mod = b.moderation && typeof b.moderation === 'object' ? {
    hold_all: !!b.moderation.hold_all, hold_links: !!b.moderation.hold_links,
    blocked: Array.isArray(b.moderation.blocked) ? b.moderation.blocked.map(w => String(w).trim().slice(0, 40)).filter(Boolean).slice(0, 200) : [],
  } : json(ch.moderation, {});
  const avatar = fileOf(b.avatar, ch.avatar), banner = fileOf(b.banner, ch.banner), watermark = fileOf(b.watermark, ch.watermark);
  const geoAvatar = fileOf(b.geo_avatar, ch.geo_avatar), geoBanner = fileOf(b.geo_banner, ch.geo_banner);
  run(`UPDATE channels SET name=?, handle=?, description=?, avatar=?, banner=?, country=?, links=?, featured_video_id=?, trailer_video_id=?, sections=?, watermark=?,
       geo_separate=?, geo_name=?, geo_description=?, geo_avatar=?, geo_banner=?, moderation=? WHERE id=?`,
    name, handle, b.description !== undefined ? str(b.description, 'Description', { max: 2000 }) : ch.description, avatar, banner,
    b.country !== undefined ? str(b.country, 'Country', { max: 60 }) || null : ch.country, JSON.stringify(links),
    vidOf(b.featured_video_id, ch.featured_video_id), vidOf(b.trailer_video_id, ch.trailer_video_id), JSON.stringify(sections), watermark,
    typeof b.geo_separate === 'boolean' ? (b.geo_separate ? 1 : 0) : ch.geo_separate,
    b.geo_name !== undefined ? str(b.geo_name, 'GeoTube name', { max: 50 }) || null : ch.geo_name,
    b.geo_description !== undefined ? str(b.geo_description, 'GeoTube description', { max: 2000 }) || null : ch.geo_description,
    geoAvatar, geoBanner, JSON.stringify(mod), ch.id);
  for (const [o, n] of [[ch.avatar, avatar], [ch.banner, banner], [ch.watermark, watermark], [ch.geo_avatar, geoAvatar], [ch.geo_banner, geoBanner]]) if (o && o !== n) media.deleteFile(o);
  safety.reportChannel(get('SELECT * FROM channels WHERE id=?', ch.id), safety.scanChannel(get('SELECT * FROM channels WHERE id=?', ch.id)));
  audit(ctx.user.id, 'channel.update', 'channel', ch.id);
  return channelOut({ ...get('SELECT * FROM channels WHERE id=?', ch.id), isOwner: ch.isOwner });
});
route('POST', '/api/studio/managers', ctx => {
  const ch = studioChannel(ctx);
  if (!ch.isOwner) throw new HttpError(403, 'Only the channel owner can add managers');
  const email = str(ctx.body.email, 'Email', { min: 3, max: 200 });
  const u = get('SELECT id FROM users WHERE email=?', email);
  if (!u) throw new HttpError(404, 'No account with that email address');
  if (u.id === ch.user_id) throw bad('That is you');
  if (get('SELECT COUNT(*) AS n FROM channel_managers WHERE channel_id=?', ch.id).n >= 10) throw bad('A channel can have at most 10 managers');
  run('INSERT OR IGNORE INTO channel_managers(channel_id,user_id,created_at) VALUES(?,?,?)', ch.id, u.id, now());
  notify(u.id, 'channel', `You are now a manager of ${ch.name}`, 'Open Studio and switch channels to manage it.', '/studio');
  audit(ctx.user.id, 'manager.add', 'channel', ch.id, { user: u.id });
  return channelOut(ch);
});
route('DELETE', '/api/studio/managers/:userId', ctx => {
  const ch = studioChannel(ctx);
  const uid = intOf(ctx.params.userId, 0);
  if (!ch.isOwner && uid !== ctx.user.id) throw new HttpError(403, 'Only the channel owner can remove managers');
  run('DELETE FROM channel_managers WHERE channel_id=? AND user_id=?', ch.id, uid);
  return channelOut(ch);
});

/* ---------- community posts ---------- */
route('POST', '/api/studio/posts', ctx => {
  const ch = studioChannel(ctx);
  limit(ctx, 'post', 20, 3600000);
  // Up to four pictures or GIFs per post; text is optional when there is at least one.
  const attachments = (Array.isArray(ctx.body.attachments) ? ctx.body.attachments.slice(0, 4) : []).map(a => gifs.parseAttachment(a, ctx.user.id)).filter(Boolean);
  const body = str(ctx.body.body, 'Post', { min: attachments.length ? 0 : 1, max: 2000 });
  const r = run('INSERT INTO community_posts(channel_id,body,attachments,created_at) VALUES(?,?,?,?)', ch.id, body, JSON.stringify(attachments), now());
  const preview = body || (attachments.length === 1 ? 'Shared a ' + (attachments[0].kind === 'gif' ? 'GIF' : 'picture') : `Shared ${attachments.length} pictures`);
  for (const s of all("SELECT user_id FROM subscriptions WHERE channel_id=? AND notify='all'", ch.id))
    notify(s.user_id, 'subscriptions', `${ch.name} posted an update`, preview.slice(0, 120), '/@' + ch.handle + '?tab=posts');
  return { id: Number(r.lastInsertRowid), attachments: attachments.map(gifs.attachmentOut) };
});
route('DELETE', '/api/studio/posts/:id', ctx => {
  const ch = studioChannel(ctx);
  run('DELETE FROM community_posts WHERE id=? AND channel_id=?', intOf(ctx.params.id, 0), ch.id);
  return { ok: true };
});

/* ---------- monetisation + audio library ---------- */
const MONETIZATION_MIN = { subscribers: 100, watch_hours: 50 };
route('GET', '/api/studio/monetization', ctx => {
  const ch = studioChannel(ctx);
  const m = get('SELECT * FROM monetization WHERE channel_id=?', ch.id) || { status: 'not_applied', payment: '{}' };
  const hours = Math.round((get(`SELECT COALESCE(SUM(value),0) AS n FROM analytics_events WHERE channel_id=? AND type='watch' AND created_at>?`, ch.id, now() - 365 * DAY).n) / 360) / 10;
  const subs = subscriberCount(ch.id);
  return { enabled: !!getSetting('monetization').enabled, status: m.status, applied_at: m.applied_at, payment: json(m.payment, {}),
    progress: { subscribers: subs, watch_hours: hours, min: MONETIZATION_MIN, eligible: subs >= MONETIZATION_MIN.subscribers && hours >= MONETIZATION_MIN.watch_hours },
    estimated_earnings: m.status === 'approved' ? Math.round(get(`SELECT COALESCE(SUM(value),0) AS n FROM analytics_events e JOIN videos v ON v.id=e.video_id WHERE e.channel_id=? AND e.type='view' AND v.monetized=1 AND e.created_at>?`, ch.id, now() - 28 * DAY).n * 0.0012 * 100) / 100 : 0 };
});
route('POST', '/api/studio/monetization/apply', ctx => {
  const ch = studioChannel(ctx);
  if (!ch.isOwner) throw new HttpError(403, 'Only the channel owner can apply');
  if (!getSetting('monetization').enabled) throw bad('The partner programme is not open yet');
  run("INSERT INTO monetization(channel_id,status,applied_at) VALUES(?,'applied',?) ON CONFLICT(channel_id) DO UPDATE SET status='applied', applied_at=excluded.applied_at", ch.id, now());
  for (const m of all("SELECT id FROM users WHERE role='admin'")) notify(m.id, 'moderation', 'New monetisation application', ch.name, '/admin/channels');
  return { ok: true };
});
route('PATCH', '/api/studio/monetization', ctx => {
  const ch = studioChannel(ctx);
  if (!ch.isOwner) throw new HttpError(403, 'Only the channel owner can change payment details');
  const p = { method: oneOf(ctx.body.method || 'bank', ['bank', 'paypal'], 'Method'), account: str(ctx.body.account, 'Account', { max: 100 }), name: str(ctx.body.name, 'Name', { max: 100 }) };
  run('INSERT INTO monetization(channel_id,payment) VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET payment=excluded.payment', ch.id, JSON.stringify(p));
  return { ok: true };
});
route('POST', '/api/studio/videos/:id/monetize', ctx => {
  const v = studioVideo(ctx, ctx.params.id);
  const m = get('SELECT status FROM monetization WHERE channel_id=?', v.channel_id);
  if (!m || m.status !== 'approved') throw bad('Your channel is not in the partner programme');
  run('UPDATE videos SET monetized=? WHERE id=?', ctx.body.on ? 1 : 0, v.id);
  return videoOut(studioVideo(ctx, v.id));
});
route('GET', '/api/studio/audio', ctx => { need(ctx); return all('SELECT id,title,mood,duration,file FROM audio_tracks ORDER BY mood,title').map(t => ({ ...t, url: '/files/' + t.file })); });
