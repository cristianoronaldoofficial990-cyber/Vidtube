'use strict';
// Moderation + administration API: GeoTube review queue, reports, appeals, copyright claims,
// users, channels, categories, platform settings, announcements and the audit log.
const {
  get, all, run, tx, route, HttpError, bad, str, oneOf, platformOf, intOf, json, now, DAY, dayStr,
  needRole, notify, audit, getSetting, setSetting, DEFAULT_SETTINGS, subscriberCount,
  BADGES, BADGES_SQL, badgeList, badgesOf,
} = require('./core');
const media = require('./media');
const safety = require('./safety');

const link = (platform, id) => (platform === 'geotube' ? '/geotube' : '') + '/watch?v=' + id;
const pageOf = ctx => ({ page: intOf(ctx.query.page, 0, 0, 1000), lim: 40 });

/* ---------- overview ---------- */
route('GET', '/api/admin/stats', ctx => {
  needRole(ctx, 'moderator');
  const t = now();
  return {
    users: get('SELECT COUNT(*) AS n FROM users').n, channels: get('SELECT COUNT(*) AS n FROM channels').n,
    videos: get('SELECT COUNT(*) AS n FROM videos').n,
    publications: all('SELECT platform, COUNT(*) AS n FROM publications WHERE visibility=\'public\' AND status=\'approved\' GROUP BY platform'),
    queue: get("SELECT COUNT(*) AS n FROM publications WHERE status='pending'").n,
    safety_flags: get(`SELECT COUNT(*) AS n FROM publications WHERE status='pending' AND check_json LIKE '%"${safety.FLAG_CODE}"%'`).n,
    flagged_channels: get(`SELECT COUNT(*) AS n FROM channels c WHERE ${safety.FLAGGED_CHANNEL_SQL} > 0`).n,
    reports: get("SELECT COUNT(*) AS n FROM reports WHERE status='open'").n,
    appeals: get("SELECT COUNT(*) AS n FROM appeals WHERE status='open'").n,
    claims: get("SELECT COUNT(*) AS n FROM copyright_claims WHERE status='open'").n,
    monetization: get("SELECT COUNT(*) AS n FROM monetization WHERE status='applied'").n,
    views_24h: get("SELECT COALESCE(SUM(value),0) AS n FROM analytics_events WHERE type='view' AND created_at>?", t - DAY).n,
    uploads_7d: get('SELECT COUNT(*) AS n FROM videos WHERE created_at>?', t - 7 * DAY).n,
    signups_7d: get('SELECT COUNT(*) AS n FROM users WHERE created_at>?', t - 7 * DAY).n,
    failed_jobs: get("SELECT COUNT(*) AS n FROM processing_jobs WHERE status='failed' AND created_at>?", t - 7 * DAY).n,
    ffmpeg: media.hasFfmpeg,
    daily: (() => {
      const rows = all("SELECT day, platform, SUM(value) AS n FROM analytics_events WHERE type='view' AND day>=? GROUP BY day, platform", dayStr(t - 13 * DAY));
      const out = {};
      for (let i = 13; i >= 0; i--) { const d = dayStr(t - i * DAY); out[d] = { day: d, vidtube: 0, geotube: 0 }; }
      for (const r of rows) if (out[r.day]) out[r.day][r.platform] = r.n;
      return Object.values(out);
    })(),
  };
});

/* ---------- GeoTube review queue ---------- */
const QUEUE_SELECT = `SELECT p.video_id, p.platform, p.title, p.description, p.category, p.status, p.visibility, p.review_note, p.check_json, p.human_reviewed, p.updated_at, p.created_at,
  v.thumb, v.tags, v.asset_id, v.channel_id, c.handle, c.name AS channel_name, c.geo_name, c.geo_separate, c.created_at AS channel_created,
  a.duration, a.qualities, a.status AS asset_status,
  (SELECT COUNT(*) FROM publications p2 JOIN videos v2 ON v2.id=p2.video_id WHERE v2.channel_id=v.channel_id AND p2.platform='geotube' AND p2.status='approved') AS approved_before,
  (SELECT COUNT(*) FROM publications p2 JOIN videos v2 ON v2.id=p2.video_id WHERE v2.channel_id=v.channel_id AND p2.platform='geotube' AND p2.status='rejected') AS rejected_before,
  (SELECT COUNT(*) FROM publications p2 JOIN videos v2 ON v2.id=p2.video_id WHERE v2.channel_id=v.channel_id AND p2.check_json LIKE '%"sexual_content"%' AND (p2.status='pending' OR p2.human_reviewed=0)) AS channel_flagged
  FROM publications p JOIN videos v ON v.id=p.video_id JOIN channels c ON c.id=v.channel_id JOIN media_assets a ON a.id=v.asset_id`;
const queueOut = r => ({ ...r, tags: json(r.tags, []), check: json(r.check_json, null), human_reviewed: !!r.human_reviewed,
  qualities: json(r.qualities, []).map(q => ({ ...q, url: `/media/${r.asset_id}/${q.file}` })) });
route('GET', '/api/admin/queue', ctx => {
  needRole(ctx, 'moderator');
  const status = ctx.query.status || 'pending';
  const { page, lim } = pageOf(ctx);
  const safetyOnly = ctx.query.filter === 'safety' ? ` AND p.check_json LIKE '%"${safety.FLAG_CODE}"%'` : '';
  const where = (status === 'history' ? "p.human_reviewed=1 AND p.status<>'pending'" : "p.status='pending'") + safetyOnly;
  const rows = all(`${QUEUE_SELECT} WHERE ${where} ORDER BY p.updated_at ${status === 'history' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`, lim, page * lim);
  return { items: rows.map(queueOut), more: rows.length === lim };
});
route('GET', '/api/admin/queue/:videoId/:platform', ctx => {
  needRole(ctx, 'moderator');
  const r = get(`${QUEUE_SELECT} WHERE p.video_id=? AND p.platform=?`, ctx.params.videoId, platformOf(ctx.params.platform));
  if (!r) throw new HttpError(404, 'Submission not found');
  return { ...queueOut(r), decisions: all('SELECT * FROM moderation_decisions WHERE target_type=\'video\' AND target_id=? ORDER BY id DESC', r.video_id),
    reports: all("SELECT id, reason, details, status, created_at FROM reports WHERE target_type='video' AND target_id=? ORDER BY id DESC", r.video_id) };
});
function decide(ctx, videoId, platform, action, note) {
  const mod = needRole(ctx, 'moderator');
  const p = get('SELECT p.*, v.channel_id FROM publications p JOIN videos v ON v.id=p.video_id WHERE p.video_id=? AND p.platform=?', videoId, platform);
  if (!p) throw new HttpError(404, 'Publication not found');
  const status = { approve: 'approved', reject: 'rejected', restrict: 'restricted', remove: 'removed', restore: 'approved' }[action];
  if (!status) throw bad('Unknown action');
  tx(() => {
    run('UPDATE publications SET status=?, review_note=?, human_reviewed=1, published_at=COALESCE(published_at, CASE WHEN ? = \'approved\' AND visibility=\'public\' THEN ? ELSE NULL END), updated_at=? WHERE video_id=? AND platform=?',
      status, note || null, status, now(), now(), videoId, platform);
    run('INSERT INTO moderation_decisions(target_type,target_id,platform,moderator_id,action,reason,created_at) VALUES(?,?,?,?,?,?,?)', 'video', videoId, platform, mod.id, action, note || '', now());
  });
  const ch = get('SELECT user_id FROM channels WHERE id=?', p.channel_id);
  const msgs = {
    approve: ['Your video was approved', `"${p.title}" is now live on ${platform === 'geotube' ? 'GeoTube' : 'VidTube'}.`],
    reject: ['Your GeoTube submission was not accepted', note || 'A moderator decided the video does not fit GeoTube. You can appeal from Studio.'],
    restrict: ['Your video was restricted', note || 'The video stays available by link but is no longer recommended.'],
    remove: ['Your video was removed', note || 'The video violated the community guidelines. You can appeal from Studio.'],
    restore: ['Your video was restored', `"${p.title}" is available again.`],
  }[action];
  notify(ch.user_id, platform === 'geotube' && ['approve', 'reject'].includes(action) ? 'geotube_review' : 'moderation', msgs[0], msgs[1], `/studio/video/${videoId}`);
  audit(mod.id, 'moderation.' + action, 'video', videoId, { platform, note });
}
route('POST', '/api/admin/queue/:videoId/:platform', ctx => {
  const action = oneOf(ctx.body.action, ['approve', 'reject', 'restrict'], 'Action');
  const note = str(ctx.body.note, 'Note', { max: 1000 });
  if (action !== 'approve' && !note) throw bad('Tell the creator why (a note is required when rejecting or restricting)');
  decide(ctx, ctx.params.videoId, platformOf(ctx.params.platform), action, note);
  return { ok: true };
});
route('POST', '/api/admin/videos/:videoId/:platform', ctx => {
  const action = oneOf(ctx.body.action, ['remove', 'restore', 'restrict', 'approve'], 'Action');
  decide(ctx, ctx.params.videoId, platformOf(ctx.params.platform), action, str(ctx.body.note, 'Note', { max: 1000 }));
  return { ok: true };
});
route('GET', '/api/admin/videos', ctx => {
  needRole(ctx, 'moderator');
  const q = str(ctx.query.q, 'Search', { max: 100 });
  const { page, lim } = pageOf(ctx);
  const rows = all(`${QUEUE_SELECT} WHERE (p.title LIKE ? OR p.video_id=? OR c.handle LIKE ?) ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`, `%${q}%`, q, `%${q}%`, lim, page * lim);
  return { items: rows.map(queueOut), more: rows.length === lim };
});

/* ---------- reports ---------- */
route('GET', '/api/admin/reports', ctx => {
  needRole(ctx, 'moderator');
  const status = oneOf(ctx.query.status || 'open', ['open', 'resolved', 'dismissed'], 'Status');
  const { page, lim } = pageOf(ctx);
  const rows = all(`SELECT r.*, u.email AS reporter_email FROM reports r LEFT JOIN users u ON u.id=r.reporter_id WHERE r.status=? ORDER BY r.id ${status === 'open' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`, status, lim, page * lim);
  const items = rows.map(r => {
    let target = null;
    if (r.target_type === 'video') { const p = get('SELECT p.title, p.status, p.platform, v.thumb, c.handle FROM publications p JOIN videos v ON v.id=p.video_id JOIN channels c ON c.id=v.channel_id WHERE p.video_id=? ORDER BY CASE WHEN p.platform=? THEN 0 ELSE 1 END LIMIT 1', r.target_id, r.platform || 'vidtube'); target = p ? { ...p, link: link(p.platform, r.target_id) } : { missing: true }; }
    else if (r.target_type === 'comment') { const c = get('SELECT c.body, c.status, c.video_id, c.platform, u.email FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?', intOf(r.target_id, 0)); target = c ? { ...c, link: link(c.platform, c.video_id) + '&c=' + r.target_id } : { missing: true }; }
    else { const c = get('SELECT handle, name, suspended FROM channels WHERE id=?', intOf(r.target_id, 0)); target = c ? { ...c, link: '/@' + c.handle } : { missing: true }; }
    const open = get("SELECT COUNT(*) AS n FROM reports WHERE target_type=? AND target_id=? AND status='open'", r.target_type, r.target_id).n;
    return { ...r, target, open_count: open };
  });
  return { items, more: rows.length === lim };
});
route('POST', '/api/admin/reports/:id', ctx => {
  const mod = needRole(ctx, 'moderator');
  const r = get('SELECT * FROM reports WHERE id=?', intOf(ctx.params.id, 0));
  if (!r) throw new HttpError(404, 'Report not found');
  const action = oneOf(ctx.body.action, ['dismiss', 'resolve'], 'Action');
  const apply = ctx.body.apply ? oneOf(ctx.body.apply, ['none', 'remove_video', 'restrict_video', 'remove_comment', 'suspend_channel', 'suspend_user'], 'Measure') : 'none';
  const note = str(ctx.body.resolution, 'Resolution', { max: 1000 });
  if (apply === 'remove_video' || apply === 'restrict_video') {
    for (const p of all('SELECT platform FROM publications WHERE video_id=?', r.target_id)) decide(ctx, r.target_id, p.platform, apply === 'remove_video' ? 'remove' : 'restrict', note || r.reason);
  } else if (apply === 'remove_comment') {
    const c = get('SELECT * FROM comments WHERE id=?', intOf(r.target_id, 0));
    if (c) tx(() => {
      const n = c.status === 'visible' ? 1 + get("SELECT COUNT(*) AS n FROM comments WHERE parent_id=? AND status='visible'", c.id).n : 0;
      run('DELETE FROM comments WHERE id=?', c.id);
      run('UPDATE publications SET comment_count=MAX(0,comment_count-?) WHERE video_id=? AND platform=?', n, c.video_id, c.platform);
      notify(c.user_id, 'moderation', 'Your comment was removed', note || 'It violated the community guidelines.', null);
    });
  } else if (apply === 'suspend_channel' || apply === 'suspend_user') {
    let chId = null;
    if (r.target_type === 'channel') chId = intOf(r.target_id, 0);
    else if (r.target_type === 'video') chId = (get('SELECT channel_id FROM videos WHERE id=?', r.target_id) || {}).channel_id;
    else { const c = get('SELECT user_id FROM comments WHERE id=?', intOf(r.target_id, 0)); if (c) { if (apply === 'suspend_user') run("UPDATE users SET status='suspended' WHERE id=?", c.user_id); chId = (get('SELECT id FROM channels WHERE user_id=?', c.user_id) || {}).id; } }
    if (chId) suspendChannel(ctx, chId, true, note);
  }
  // Every open report on the same target is closed with the same decision.
  run('UPDATE reports SET status=?, resolution=?, resolved_by=?, resolved_at=? WHERE target_type=? AND target_id=? AND status=\'open\'',
    action === 'dismiss' ? 'dismissed' : 'resolved', note || null, mod.id, now(), r.target_type, r.target_id);
  audit(mod.id, 'report.' + action, 'report', r.id, { apply, note });
  return { ok: true };
});

/* ---------- appeals + claims ---------- */
route('GET', '/api/admin/appeals', ctx => {
  needRole(ctx, 'moderator');
  const status = oneOf(ctx.query.status || 'open', ['open', 'granted', 'denied'], 'Status');
  return all(`SELECT a.*, p.title, p.status AS pub_status, p.review_note, v.thumb, c.handle, u.email FROM appeals a JOIN videos v ON v.id=a.video_id JOIN channels c ON c.id=v.channel_id
    JOIN users u ON u.id=a.user_id LEFT JOIN publications p ON p.video_id=a.video_id AND p.platform=a.platform WHERE a.status=? ORDER BY a.id ${status === 'open' ? 'ASC' : 'DESC'} LIMIT 100`, status);
});
route('POST', '/api/admin/appeals/:id', ctx => {
  const mod = needRole(ctx, 'moderator');
  const a = get('SELECT * FROM appeals WHERE id=?', intOf(ctx.params.id, 0));
  if (!a || a.status !== 'open') throw new HttpError(404, 'Appeal not found or already handled');
  const action = oneOf(ctx.body.action, ['grant', 'deny'], 'Action');
  const response = str(ctx.body.response, 'Response', { max: 1000 });
  run('UPDATE appeals SET status=?, response=?, resolved_by=?, resolved_at=? WHERE id=?', action === 'grant' ? 'granted' : 'denied', response || null, mod.id, now(), a.id);
  if (action === 'grant') decide(ctx, a.video_id, a.platform, 'approve', response || 'Appeal granted');
  else notify(a.user_id, 'moderation', 'Your appeal was denied', response || 'The original decision stands.', `/studio/video/${a.video_id}`);
  audit(mod.id, 'appeal.' + action, 'appeal', a.id, { response });
  return { ok: true };
});
route('GET', '/api/admin/claims', ctx => {
  needRole(ctx, 'moderator');
  const status = oneOf(ctx.query.status || 'open', ['open', 'upheld', 'rejected'], 'Status');
  return all(`SELECT cl.*, u.email AS claimant_email, c.handle AS channel_handle, (SELECT title FROM publications p WHERE p.video_id=cl.video_id LIMIT 1) AS title, v.thumb
    FROM copyright_claims cl JOIN users u ON u.id=cl.claimant_id JOIN videos v ON v.id=cl.video_id JOIN channels c ON c.id=v.channel_id WHERE cl.status=? ORDER BY cl.id DESC LIMIT 100`, status);
});
route('POST', '/api/admin/claims/:id', ctx => {
  const mod = needRole(ctx, 'moderator');
  const cl = get('SELECT * FROM copyright_claims WHERE id=?', intOf(ctx.params.id, 0));
  if (!cl || cl.status !== 'open') throw new HttpError(404, 'Claim not found or already handled');
  const action = oneOf(ctx.body.action, ['uphold', 'reject'], 'Action');
  const response = str(ctx.body.response, 'Response', { max: 1000 });
  run('UPDATE copyright_claims SET status=?, response=?, resolved_by=?, resolved_at=? WHERE id=?', action === 'uphold' ? 'upheld' : 'rejected', response || null, mod.id, now(), cl.id);
  if (action === 'uphold') for (const p of all('SELECT platform FROM publications WHERE video_id=?', cl.video_id)) decide(ctx, cl.video_id, p.platform, 'remove', 'Removed after a copyright claim. ' + response);
  notify(cl.claimant_id, 'moderation', action === 'uphold' ? 'Your copyright claim was upheld' : 'Your copyright claim was rejected', response || '', null);
  audit(mod.id, 'claim.' + action, 'claim', cl.id);
  return { ok: true };
});

/* ---------- users + channels ---------- */
route('GET', '/api/admin/users', ctx => {
  needRole(ctx, 'moderator');
  const q = str(ctx.query.q, 'Search', { max: 100 });
  const { page, lim } = pageOf(ctx);
  const rows = all(`SELECT u.id, u.email, u.role, u.status, u.email_verified, u.is_demo, u.created_at, c.id AS channel_id, c.handle, c.name, c.suspended, ${BADGES_SQL('u.id')} AS badges,
    (SELECT COUNT(*) FROM videos v WHERE v.channel_id=c.id) AS videos, (SELECT COUNT(*) FROM comments cm WHERE cm.user_id=u.id) AS comments
    FROM users u LEFT JOIN channels c ON c.user_id=u.id WHERE u.email LIKE ? OR c.handle LIKE ? OR c.name LIKE ? ORDER BY u.id DESC LIMIT ? OFFSET ?`, `%${q}%`, `%${q}%`, `%${q}%`, lim, page * lim);
  return { items: rows.map(r => ({ ...r, badges: badgeList(r.badges) })), more: rows.length === lim };
});
// Special badges. Only administrators grant them; the owner badge moves to the chosen account (one holder).
route('PUT', '/api/admin/users/:id/badges', ctx => {
  const admin = needRole(ctx, 'admin');
  const u = get('SELECT * FROM users WHERE id=?', intOf(ctx.params.id, 0));
  if (!u) throw new HttpError(404, 'User not found');
  const b = ctx.body || {};
  for (const badge of Object.keys(BADGES)) {
    if (typeof b[badge] !== 'boolean') continue;
    if (b[badge]) {
      if (badge === 'owner') run("DELETE FROM user_badges WHERE badge='owner' AND user_id<>?", u.id);
      run('INSERT OR IGNORE INTO user_badges(user_id,badge,created_at) VALUES(?,?,?)', u.id, badge, now());
      notify(u.id, 'channel', `You received the ${BADGES[badge].label} badge`, 'It now appears next to your name.', '/settings');
    } else run('DELETE FROM user_badges WHERE user_id=? AND badge=?', u.id, badge);
    audit(admin.id, 'user.badge', 'user', u.id, { badge, on: b[badge] });
  }
  return { badges: badgesOf(u.id) };
});
route('PATCH', '/api/admin/users/:id', ctx => {
  const admin = needRole(ctx, 'admin');
  const u = get('SELECT * FROM users WHERE id=?', intOf(ctx.params.id, 0));
  if (!u) throw new HttpError(404, 'User not found');
  const role = ctx.body.role ? oneOf(ctx.body.role, ['user', 'creator', 'moderator', 'admin'], 'Role') : u.role;
  const status = ctx.body.status ? oneOf(ctx.body.status, ['active', 'suspended'], 'Status') : u.status;
  if (u.id === admin.id && (role !== 'admin' || status !== 'active')) throw bad('You cannot demote or suspend yourself');
  if (u.role === 'admin' && role !== 'admin' && get("SELECT COUNT(*) AS n FROM users WHERE role='admin'").n <= 1) throw bad('There must be at least one administrator');
  run('UPDATE users SET role=?, status=? WHERE id=?', role, status, u.id);
  if (status === 'suspended') { run('DELETE FROM sessions WHERE user_id=?', u.id); const ch = get('SELECT id FROM channels WHERE user_id=?', u.id); if (ch) suspendChannel(ctx, ch.id, true, ctx.body.note); }
  else if (u.status === 'suspended') { const ch = get('SELECT id FROM channels WHERE user_id=?', u.id); if (ch) suspendChannel(ctx, ch.id, false); }
  if (role !== u.role) notify(u.id, 'security', 'Your account role changed', `You are now: ${role}.`, '/settings');
  audit(admin.id, 'user.update', 'user', u.id, { role, status });
  return { ok: true };
});
function suspendChannel(ctx, channelId, on, note) {
  run('UPDATE channels SET suspended=? WHERE id=?', on ? 1 : 0, channelId);
  const ch = get('SELECT user_id, name FROM channels WHERE id=?', channelId);
  if (ch) notify(ch.user_id, 'moderation', on ? 'Your channel was suspended' : 'Your channel was reinstated', on ? (note || 'Your channel violated the community guidelines. Contact support to appeal.') : 'Your videos are visible again.', '/studio');
  audit(ctx.user.id, on ? 'channel.suspend' : 'channel.reinstate', 'channel', channelId, { note });
}
route('GET', '/api/admin/channels', ctx => {
  needRole(ctx, 'moderator');
  const q = str(ctx.query.q, 'Search', { max: 100 });
  const filter = ctx.query.filter || 'all';
  const { page, lim } = pageOf(ctx);
  const where = { suspended: 'AND c.suspended=1', verified: 'AND c.is_verified=1', monetization: "AND m.status='applied'", partners: "AND m.status='approved'", flagged: `AND ${safety.FLAGGED_CHANNEL_SQL} > 0` }[filter] || '';
  const rows = all(`SELECT c.id, c.handle, c.name, c.avatar, c.is_verified, c.suspended, c.is_demo, c.created_at, u.email, m.status AS monetization,
    (SELECT COUNT(*) FROM videos v WHERE v.channel_id=c.id) AS videos, ${safety.FLAGGED_CHANNEL_SQL} AS flagged
    FROM channels c JOIN users u ON u.id=c.user_id LEFT JOIN monetization m ON m.channel_id=c.id WHERE (c.handle LIKE ? OR c.name LIKE ? OR u.email LIKE ?) ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`, `%${q}%`, `%${q}%`, `%${q}%`, lim, page * lim);
  return { items: rows.map(r => ({ ...r, subscribers: subscriberCount(r.id) })), more: rows.length === lim };
});
route('PATCH', '/api/admin/channels/:id', ctx => {
  const mod = needRole(ctx, 'moderator');
  const ch = get('SELECT * FROM channels WHERE id=?', intOf(ctx.params.id, 0));
  if (!ch) throw new HttpError(404, 'Channel not found');
  const b = ctx.body;
  if (typeof b.is_verified === 'boolean') { run('UPDATE channels SET is_verified=? WHERE id=?', b.is_verified ? 1 : 0, ch.id); if (b.is_verified && !ch.is_verified) notify(ch.user_id, 'channel', 'Your channel is now verified', 'A verification badge appears next to your name.', '/studio'); audit(mod.id, 'channel.verify', 'channel', ch.id, { on: b.is_verified }); }
  if (typeof b.suspended === 'boolean' && !!ch.suspended !== b.suspended) suspendChannel(ctx, ch.id, b.suspended, str(b.note, 'Note', { max: 500 }));
  if (b.monetization) {
    needRole(ctx, 'admin');
    const st = oneOf(b.monetization, ['not_applied', 'applied', 'approved', 'rejected'], 'Monetisation status');
    run('INSERT INTO monetization(channel_id,status) VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET status=excluded.status', ch.id, st);
    if (st === 'approved') notify(ch.user_id, 'channel', 'Welcome to the partner programme', 'You can now monetise your videos from Studio.', '/studio/monetization');
    if (st === 'rejected') notify(ch.user_id, 'channel', 'Monetisation application not approved', str(b.note, 'Note', { max: 500 }) || 'You can apply again later.', '/studio/monetization');
    audit(mod.id, 'channel.monetization', 'channel', ch.id, { status: st });
  }
  if (typeof b.demo_subs === 'number') { needRole(ctx, 'admin'); run('UPDATE channels SET demo_subs=? WHERE id=?', Math.max(0, Math.floor(b.demo_subs)), ch.id); }
  return { ok: true };
});

/* ---------- categories ---------- */
route('GET', '/api/admin/categories', ctx => { needRole(ctx, 'admin'); return all('SELECT * FROM categories ORDER BY platform, sort, name'); });
route('POST', '/api/admin/categories', ctx => {
  const admin = needRole(ctx, 'admin');
  const platform = platformOf(ctx.body.platform);
  const name = str(ctx.body.name, 'Name', { min: 2, max: 40 });
  const slug = str(ctx.body.slug || name, 'Slug', { min: 2, max: 40 }).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (get('SELECT 1 AS x FROM categories WHERE platform=? AND slug=?', platform, slug)) throw new HttpError(409, 'That category already exists');
  run('INSERT INTO categories(platform,slug,name,sort) VALUES(?,?,?,?)', platform, slug, name, intOf(ctx.body.sort, 100));
  audit(admin.id, 'category.create', 'category', slug, { platform });
  return { ok: true };
});
route('PATCH', '/api/admin/categories/:id', ctx => {
  const admin = needRole(ctx, 'admin');
  const c = get('SELECT * FROM categories WHERE id=?', intOf(ctx.params.id, 0));
  if (!c) throw new HttpError(404, 'Category not found');
  run('UPDATE categories SET name=?, sort=?, active=? WHERE id=?', ctx.body.name !== undefined ? str(ctx.body.name, 'Name', { min: 2, max: 40 }) : c.name,
    ctx.body.sort !== undefined ? intOf(ctx.body.sort, c.sort) : c.sort, typeof ctx.body.active === 'boolean' ? (ctx.body.active ? 1 : 0) : c.active, c.id);
  audit(admin.id, 'category.update', 'category', c.id);
  return { ok: true };
});
route('DELETE', '/api/admin/categories/:id', ctx => {
  const admin = needRole(ctx, 'admin');
  const c = get('SELECT * FROM categories WHERE id=?', intOf(ctx.params.id, 0));
  if (!c) throw new HttpError(404, 'Category not found');
  if (get('SELECT COUNT(*) AS n FROM publications WHERE platform=? AND category=?', c.platform, c.slug).n) throw bad('Videos use this category. Deactivate it instead.');
  run('DELETE FROM categories WHERE id=?', c.id);
  audit(admin.id, 'category.delete', 'category', c.id);
  return { ok: true };
});

/* ---------- settings + announcements ---------- */
route('GET', '/api/admin/settings', ctx => { needRole(ctx, 'admin'); const out = {}; for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = getSetting(k); return out; });
route('PUT', '/api/admin/settings/:key', ctx => {
  const admin = needRole(ctx, 'admin');
  const key = oneOf(ctx.params.key, Object.keys(DEFAULT_SETTINGS), 'Setting');
  const b = ctx.body || {};
  let value;
  if (key === 'geotube') {
    const words = v => (Array.isArray(v) ? v.map(w => String(w).trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 500) : undefined);
    const cur = getSetting('geotube');
    value = { mode: b.mode ? oneOf(b.mode, ['review_flagged', 'review_all'], 'Mode') : cur.mode, reviewFirstUpload: typeof b.reviewFirstUpload === 'boolean' ? b.reviewFirstUpload : cur.reviewFirstUpload,
      positive: words(b.positive) || cur.positive, negative: words(b.negative) || cur.negative };
  } else if (key === 'uploads') value = { maxVideoMB: intOf(b.maxVideoMB, 500, 10, 10000) };
  else if (key === 'safety') {
    const cur = getSetting('safety');
    const terms = Array.isArray(b.terms) ? [...new Set(b.terms.map(w => String(w).trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 2000) : cur.terms;
    value = { enabled: typeof b.enabled === 'boolean' ? b.enabled : cur.enabled, terms };
  }
  else if (key === 'ads') {
    const cur = getSetting('ads');
    const onIds = Array.isArray(b.enabledChannels) ? b.enabledChannels.map(String) : null;
    value = {
      enabled: typeof b.enabled === 'boolean' ? b.enabled : cur.enabled,
      preroll: typeof b.preroll === 'boolean' ? b.preroll : cur.preroll,
      prerollChance: intOf(b.prerollChance, cur.prerollChance, 0, 100),
      prerollMin: intOf(b.prerollMin, cur.prerollMin, 1, 60), prerollMax: intOf(b.prerollMax, cur.prerollMax, 1, 60),
      channels: require('./core').DEFAULT_SETTINGS.ads.channels.map(c => ({ id: c.id, enabled: onIds ? onIds.includes(c.id) : (cur.channels || []).find(x => x.id === c.id)?.enabled !== false })),
    };
  }
  else if (key === 'halloween') {
    const cur = getSetting('halloween');
    value = { enabled: typeof b.enabled === 'boolean' ? b.enabled : cur.enabled, goal: intOf(b.goal, cur.goal, 1, 1000), alwaysOn: typeof b.alwaysOn === 'boolean' ? b.alwaysOn : !!cur.alwaysOn };
  }
  else if (key === 'youtube') {
    const cur = getSetting('youtube');
    value = { ...cur, enabled: typeof b.enabled === 'boolean' ? b.enabled : cur.enabled,
      intervalMinutes: intOf(b.intervalMinutes, cur.intervalMinutes, 1, 1440), maxHeight: intOf(b.maxHeight, cur.maxHeight, 360, 2160) };
  }
  else value = { enabled: !!b.enabled };
  setSetting(key, value);
  if (key === 'youtube') { const yt = require('./youtube'); yt.schedule(); if (value.enabled) yt.poll(); }
  audit(admin.id, 'settings.update', 'settings', key);
  // A changed term list applies to everything already published.
  const held = key === 'safety' && value.enabled ? safety.rescanAll() : 0;
  return { ...getSetting(key), held };
});
route('POST', '/api/admin/safety/scan', ctx => {
  const mod = needRole(ctx, 'moderator');
  const held = safety.rescanAll();
  audit(mod.id, 'safety.rescan', 'settings', 'safety', { held });
  return { held };
});
route('GET', '/api/admin/announcements', ctx => { needRole(ctx, 'admin'); return all('SELECT * FROM announcements ORDER BY id DESC LIMIT 50'); });
route('POST', '/api/admin/announcements', ctx => {
  const admin = needRole(ctx, 'admin');
  run('INSERT INTO announcements(title,body,created_by,created_at) VALUES(?,?,?,?)', str(ctx.body.title, 'Title', { min: 1, max: 120 }), str(ctx.body.body, 'Body', { max: 2000 }), admin.id, now());
  return { ok: true };
});
route('PATCH', '/api/admin/announcements/:id', ctx => {
  needRole(ctx, 'admin');
  run('UPDATE announcements SET active=? WHERE id=?', ctx.body.active ? 1 : 0, intOf(ctx.params.id, 0));
  return { ok: true };
});
route('GET', '/api/admin/audit', ctx => {
  needRole(ctx, 'admin');
  const { page, lim } = pageOf(ctx);
  const rows = all('SELECT a.*, u.email AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT ? OFFSET ?', lim, page * lim);
  return { items: rows.map(r => ({ ...r, details: json(r.details, null) })), more: rows.length === lim };
});
route('GET', '/api/admin/outbox', ctx => {
  needRole(ctx, 'admin');
  return { smtp: require('./mail').enabled, items: all('SELECT id,to_email,subject,body,link AS code,created_at FROM outbox ORDER BY id DESC LIMIT 100') };
});
route('GET', '/api/admin/jobs', ctx => {
  needRole(ctx, 'admin');
  return all(`SELECT j.*, a.original_name, a.owner_id FROM processing_jobs j LEFT JOIN media_assets a ON a.id=j.asset_id ORDER BY j.id DESC LIMIT 50`);
});
route('POST', '/api/admin/jobs/:id/retry', ctx => {
  needRole(ctx, 'admin');
  const j = get('SELECT * FROM processing_jobs WHERE id=?', intOf(ctx.params.id, 0));
  if (!j || j.status !== 'failed') throw bad('Only failed jobs can be retried');
  run("UPDATE media_assets SET status='processing', error=NULL WHERE id=?", j.asset_id);
  media.enqueue(j.asset_id);
  return { ok: true };
});
