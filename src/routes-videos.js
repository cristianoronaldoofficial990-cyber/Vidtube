'use strict';
// Viewer-facing API: feeds, watch page, search, reactions, comments, subscriptions, playlists,
// history, notifications, reports and channel pages.
const path = require('path');
const {
  get, all, run, tx, route, HttpError, bad, str, oneOf, platformOf, intOf, json, now, DAY, rid,
  need, isMod, canManageChannel, limit, notify, audit, CARD, LISTED, subscriberCount, track, viewerKey, channelOfUser, BADGES_SQL, badgeList, badgesOf,
} = require('./core');
const { categoryFilter } = require('./geo');
const media = require('./media');

const PAGE = 24;
const pageOf = ctx => ({ page: intOf(ctx.query.page, 0, 0, 1000), lim: intOf(ctx.query.limit, PAGE, 1, 60) });
const notInterestedSql = ctx => (ctx.user ? ` AND v.id NOT IN (SELECT video_id FROM not_interested WHERE user_id=${ctx.user.id})` : '');
const cardOut = r => ({ ...r, is_verified: !!r.is_verified, is_short: !!r.is_short, badges: badgeList(r.badges) });

/* ---------- categories, announcements ---------- */
route('GET', '/api/categories', ctx => all('SELECT slug,name FROM categories WHERE platform=? AND active=1 ORDER BY sort, name', platformOf(ctx.query.platform)));
route('GET', '/api/announcements', () => all('SELECT id,title,body,created_at FROM announcements WHERE active=1 ORDER BY id DESC LIMIT 3'));

/* ---------- feeds ---------- */
route('GET', '/api/feed', ctx => {
  const platform = platformOf(ctx.query.platform);
  const tab = ctx.query.tab || 'home';
  const { page, lim } = pageOf(ctx);
  const cat = categoryFilter(platform, ctx.query.cat);
  const base = `${CARD} WHERE ${LISTED} AND p.platform=?${cat.sql}${notInterestedSql(ctx)}`;
  const t = now();
  let items = [], shorts = [];
  if (tab === 'home') {
    // Freshness-weighted popularity, nudged towards the viewer's chosen interests.
    const interests = ctx.user ? json((get('SELECT interests FROM user_prefs WHERE user_id=?', ctx.user.id) || {}).interests, []) : [];
    const boost = interests.length ? ` * CASE WHEN p.category IN (${interests.map(() => '?').join(',')}) THEN 1.6 ELSE 1 END` : '';
    items = all(`${base} AND v.is_short=0 ORDER BY ((p.views+1.0+p.likes*4) / (((?-p.published_at)/3600000.0)+6))${boost} DESC LIMIT ? OFFSET ?`,
      platform, ...cat.args, t, ...interests, lim, page * lim);
    if (page === 0) shorts = all(`${base} AND v.is_short=1 ORDER BY p.published_at DESC LIMIT 12`, platform, ...cat.args);
  } else if (tab === 'trending') {
    items = all(`${base} AND p.published_at>? ORDER BY (SELECT COALESCE(SUM(value),0) FROM analytics_events e WHERE e.video_id=v.id AND e.platform=p.platform AND e.type='view' AND e.created_at>?) DESC, p.views DESC LIMIT ? OFFSET ?`,
      platform, ...cat.args, t - 30 * DAY, t - 7 * DAY, lim, page * lim);
    if (!items.length && page === 0) items = all(`${base} ORDER BY p.views DESC LIMIT ?`, platform, ...cat.args, lim);
  } else if (tab === 'shorts') {
    items = all(`${base} AND v.is_short=1 ORDER BY p.published_at DESC LIMIT ? OFFSET ?`, platform, ...cat.args, lim, page * lim);
  } else if (tab === 'subscriptions') {
    const u = need(ctx);
    items = all(`${base} AND v.channel_id IN (SELECT channel_id FROM subscriptions WHERE user_id=?) ORDER BY p.published_at DESC LIMIT ? OFFSET ?`,
      platform, ...cat.args, u.id, lim, page * lim);
  } else throw bad('Unknown feed');
  return { items: items.map(cardOut), shorts: shorts.map(cardOut), page, more: items.length === lim };
});

/* ---------- watch ---------- */
function loadPublication(ctx, id, platform, { forEdit = false } = {}) {
  const r = get(`SELECT p.*, v.asset_id, v.thumb, v.captions, v.tags, v.is_short, v.made_for_kids, v.allow_comments, v.allow_download,
      v.sponsored, v.channel_id, v.created_at AS video_created, v.is_demo
    FROM publications p JOIN videos v ON v.id=p.video_id WHERE p.video_id=? AND p.platform=?`, id, platform);
  if (!r) throw new HttpError(404, 'This video is not available');
  const manager = ctx.user && (canManageChannel(ctx.user, r.channel_id) || isMod(ctx.user));
  if (forEdit && !manager) throw new HttpError(403, 'You cannot edit this video');
  if (!manager) {
    if (['private', 'draft', 'scheduled'].includes(r.visibility)) throw new HttpError(403, 'This video is private');
    if (r.status === 'removed') throw new HttpError(410, 'This video was removed for violating the community guidelines');
    if (r.status === 'rejected') throw new HttpError(403, platform === 'geotube' ? 'This video was not accepted on GeoTube' : 'This video is not available');
    if (r.status === 'pending') throw new HttpError(403, 'This video is awaiting review by a moderator');
  }
  const ch = get('SELECT * FROM channels WHERE id=?', r.channel_id);
  if (ch.suspended && !manager) throw new HttpError(403, 'This channel is suspended');
  return { pub: r, channel: ch, manager };
}
function channelPublic(ch, platform) {
  const geo = platform === 'geotube' && ch.geo_separate;
  return {
    id: ch.id, handle: ch.handle, name: geo && ch.geo_name ? ch.geo_name : ch.name,
    description: geo && ch.geo_description ? ch.geo_description : ch.description,
    avatar: geo && ch.geo_avatar ? ch.geo_avatar : ch.avatar, banner: geo && ch.geo_banner ? ch.geo_banner : ch.banner,
    country: ch.country, links: json(ch.links, []), is_verified: !!ch.is_verified, created_at: ch.created_at,
    subscribers: subscriberCount(ch.id), badges: badgesOf(ch.user_id),
  };
}

route('GET', '/api/videos/:id', ctx => {
  const platform = platformOf(ctx.query.platform);
  const { pub, channel, manager } = loadPublication(ctx, ctx.params.id, platform);
  const asset = get('SELECT status,duration,width,height,qualities,error FROM media_assets WHERE id=?', pub.asset_id);
  const me = ctx.user ? {
    reaction: (get('SELECT value FROM reactions WHERE user_id=? AND video_id=? AND platform=?', ctx.user.id, pub.video_id, platform) || {}).value || 0,
    subscribed: !!get('SELECT 1 AS x FROM subscriptions WHERE user_id=? AND channel_id=?', ctx.user.id, channel.id),
    sub_notify: (get('SELECT notify FROM subscriptions WHERE user_id=? AND channel_id=?', ctx.user.id, channel.id) || {}).notify || null,
    in_watch_later: !!get('SELECT 1 AS x FROM playlist_items WHERE playlist_id=? AND video_id=? AND platform=?', 'WL' + ctx.user.id, pub.video_id, platform),
    resume: (get('SELECT position FROM watch_history WHERE user_id=? AND video_id=? AND platform=?', ctx.user.id, pub.video_id, platform) || {}).position || 0,
    manager,
  } : null;
  const relCat = categoryFilter(platform, pub.category);
  const related = all(`${CARD} WHERE ${LISTED} AND p.platform=? AND v.id<>?${notInterestedSql(ctx)}
    ORDER BY (CASE WHEN v.channel_id=? THEN 2 ELSE 0 END) + (CASE WHEN p.category=? THEN 1 ELSE 0 END) DESC, p.views DESC, p.published_at DESC LIMIT 20`,
    platform, pub.video_id, channel.id, pub.category || '').map(cardOut);
  const otherPlatform = platform === 'geotube' ? 'vidtube' : 'geotube';
  const alsoOn = get("SELECT 1 AS x FROM publications WHERE video_id=? AND platform=? AND visibility='public' AND status='approved'", pub.video_id, otherPlatform) ? otherPlatform : null;
  return {
    id: pub.video_id, platform, title: pub.title, description: pub.description, category: pub.category,
    category_name: (get('SELECT name FROM categories WHERE platform=? AND slug=?', platform, pub.category) || {}).name || null,
    visibility: pub.visibility, status: pub.status, review_note: manager ? pub.review_note : null,
    published_at: pub.published_at, views: pub.views, likes: pub.likes, dislikes: manager ? pub.dislikes : undefined, comment_count: pub.comment_count,
    tags: json(pub.tags, []), is_short: !!pub.is_short, made_for_kids: !!pub.made_for_kids, allow_comments: !!pub.allow_comments,
    allow_download: !!pub.allow_download, sponsored: !!pub.sponsored, thumb: pub.thumb, captions: pub.captions, is_demo: !!pub.is_demo,
    asset: { id: pub.asset_id, status: asset.status, duration: asset.duration, width: asset.width, height: asset.height,
      qualities: json(asset.qualities, []).map(q => ({ ...q, url: `/media/${pub.asset_id}/${q.file}` })), error: manager ? asset.error : null },
    channel: channelPublic(channel, platform), me, related, also_on: alsoOn, watermark: channel.watermark,
  };
});

// Registers a view, watch time and resume position. Every start of the video counts as a view:
// the browser sends "start: true" when playback begins (and again when it is replayed after the
// end). The same person watching three times is three views, and the channel owner's own plays
// count as well. Later beacons without "start" only add watch time / resume position.
// Returns whether this call counted a new view and the new total.
route('POST', '/api/videos/:id/view', ctx => {
  const platform = platformOf(ctx.body.platform);
  const { pub } = loadPublication(ctx, ctx.params.id, platform);
  const key = viewerKey(ctx);
  const t = now();
  const position = Math.max(0, Number(ctx.body.position) || 0);
  const delta = Math.min(120, Math.max(0, Number(ctx.body.delta) || 0));
  const decile = intOf(ctx.body.decile, -1, -1, 9);
  const source = ['home', 'search', 'suggested', 'channel', 'subscriptions', 'shorts', 'playlist', 'notification', 'external', 'direct', 'trending'].includes(ctx.body.source) ? ctx.body.source : 'direct';
  const isSelf = false; // the owner's own plays count like anyone else's
  const start = ctx.body.start === true;
  if (start) limit(ctx, 'viewstart', 120, 60000); // only stops scripted flooding, never a real viewer
  let counted = false;
  tx(() => {
    let v = get('SELECT * FROM video_views WHERE video_id=? AND platform=? AND viewer_key=? ORDER BY created_at DESC LIMIT 1', pub.video_id, platform, key);
    if (start || !v) {
      run('INSERT INTO video_views(video_id,platform,viewer_key,user_id,max_decile,created_at) VALUES(?,?,?,?,?,?)',
        pub.video_id, platform, key, ctx.user ? ctx.user.id : null, decile, t);
      if (!isSelf) {
        run('UPDATE publications SET views=views+1 WHERE video_id=? AND platform=?', pub.video_id, platform);
        track(ctx, 'view', { channelId: pub.channel_id, videoId: pub.video_id, platform, source });
        counted = true;
      }
      if (counted && ctx.user) require('./halloween').onView(ctx.user.id);
    } else if (decile > v.max_decile) run('UPDATE video_views SET max_decile=? WHERE id=?', decile, v.id);
    if (delta > 0 && !isSelf) track(ctx, 'watch', { channelId: pub.channel_id, videoId: pub.video_id, platform, value: delta, source });
    if (ctx.user) {
      const p = get('SELECT history_paused FROM user_prefs WHERE user_id=?', ctx.user.id);
      if (!p || !p.history_paused) {
        const dur = (get('SELECT duration FROM media_assets WHERE id=?', pub.asset_id) || {}).duration || 0;
        run(`INSERT INTO watch_history(user_id,video_id,platform,position,pct,watched_at) VALUES(?,?,?,?,?,?)
             ON CONFLICT(user_id,video_id,platform) DO UPDATE SET position=excluded.position, pct=excluded.pct, watched_at=excluded.watched_at`,
          ctx.user.id, pub.video_id, platform, position, dur ? Math.min(1, position / dur) : 0, t);
      }
    }
  });
  return { ok: true, counted, views: get('SELECT views FROM publications WHERE video_id=? AND platform=?', pub.video_id, platform).views };
});

route('POST', '/api/videos/:id/react', ctx => {
  const u = need(ctx);
  limit(ctx, 'react', 60, 60000);
  const platform = platformOf(ctx.body.platform);
  const { pub } = loadPublication(ctx, ctx.params.id, platform);
  const value = [1, -1, 0].includes(ctx.body.value) ? ctx.body.value : 0;
  tx(() => {
    const cur = get('SELECT value FROM reactions WHERE user_id=? AND video_id=? AND platform=?', u.id, pub.video_id, platform);
    if (cur) {
      run('DELETE FROM reactions WHERE user_id=? AND video_id=? AND platform=?', u.id, pub.video_id, platform);
      run(`UPDATE publications SET ${cur.value === 1 ? 'likes=MAX(0,likes-1)' : 'dislikes=MAX(0,dislikes-1)'} WHERE video_id=? AND platform=?`, pub.video_id, platform);
    }
    if (value) {
      run('INSERT INTO reactions(user_id,video_id,platform,value,created_at) VALUES(?,?,?,?,?)', u.id, pub.video_id, platform, value, now());
      run(`UPDATE publications SET ${value === 1 ? 'likes=likes+1' : 'dislikes=dislikes+1'} WHERE video_id=? AND platform=?`, pub.video_id, platform);
      if (value === 1) track(ctx, 'like', { channelId: pub.channel_id, videoId: pub.video_id, platform });
    }
  });
  const p = get('SELECT likes FROM publications WHERE video_id=? AND platform=?', pub.video_id, platform);
  return { value, likes: p.likes };
});

route('POST', '/api/videos/:id/not-interested', ctx => {
  const u = need(ctx);
  run('INSERT OR IGNORE INTO not_interested(user_id,video_id) VALUES(?,?)', u.id, ctx.params.id);
  return { ok: true };
});
route('DELETE', '/api/videos/:id/not-interested', ctx => {
  const u = need(ctx);
  run('DELETE FROM not_interested WHERE user_id=? AND video_id=?', u.id, ctx.params.id);
  return { ok: true };
});

route('GET', '/api/videos/:id/download', ctx => {
  const platform = platformOf(ctx.query.platform);
  const { pub, manager } = loadPublication(ctx, ctx.params.id, platform);
  if (!pub.allow_download && !manager) throw new HttpError(403, 'Downloads are disabled for this video');
  const asset = get('SELECT qualities FROM media_assets WHERE id=?', pub.asset_id);
  const q = json(asset.qualities, [])[0];
  if (!q) throw new HttpError(404, 'No file available');
  track(ctx, 'download', { channelId: pub.channel_id, videoId: pub.video_id, platform });
  media.sendFile(ctx.req, ctx.res, path.join(media.MEDIA_DIR, pub.asset_id, q.file), { download: `${pub.title}.${q.file.split('.').pop()}` });
}, { stream: true });

/* ---------- comments ---------- */
const gifs = require('./gifs');
const safety = require('./safety');
const COMMENT_SELECT = `SELECT c.*, ch.handle, ch.name AS author_name, ch.avatar AS author_avatar, ch.id AS author_channel_id, u.email AS author_email, ${BADGES_SQL('c.user_id')} AS author_badges,
  (SELECT COUNT(*) FROM comments r WHERE r.parent_id=c.id AND r.status='visible') AS reply_count
  FROM comments c JOIN users u ON u.id=c.user_id LEFT JOIN channels ch ON ch.user_id=c.user_id`;
function commentOut(c, ctx, ownerUserId) {
  const mine = ctx.user && ctx.user.id === c.user_id;
  return {
    id: c.id, parent_id: c.parent_id, body: c.body, attachment: gifs.attachmentFromRow(c.attachment), status: c.status, pinned: !!c.pinned, hearted: !!c.hearted, likes: c.likes,
    edited_at: c.edited_at, created_at: c.created_at, reply_count: c.reply_count,
    author: { name: c.author_name || c.author_email.split('@')[0], handle: c.handle, avatar: c.author_avatar, channel_id: c.author_channel_id, is_owner: c.user_id === ownerUserId, badges: badgeList(c.author_badges) },
    mine: !!mine,
    liked: ctx.user ? !!get('SELECT 1 AS x FROM comment_likes WHERE comment_id=? AND user_id=?', c.id, ctx.user.id) : false,
  };
}
route('GET', '/api/videos/:id/comments', ctx => {
  const platform = platformOf(ctx.query.platform);
  const { pub, channel, manager } = loadPublication(ctx, ctx.params.id, platform);
  const parent = ctx.query.parent ? intOf(ctx.query.parent, 0) : null;
  const sort = ctx.query.sort === 'new' ? 'c.created_at DESC' : 'c.pinned DESC, c.likes DESC, c.created_at DESC';
  const { page, lim } = pageOf(ctx);
  // Held and hidden comments are only visible to their author and to channel managers.
  const vis = manager ? "c.status IN ('visible','held','hidden')" : `(c.status='visible' OR (c.status IN ('held','hidden') AND c.user_id=${ctx.user ? ctx.user.id : -1}))`;
  const rows = all(`${COMMENT_SELECT} WHERE c.video_id=? AND c.platform=? AND ${parent ? 'c.parent_id=?' : 'c.parent_id IS NULL'} AND ${vis}
    ORDER BY ${parent ? 'c.created_at ASC' : sort} LIMIT ? OFFSET ?`, ...(parent ? [pub.video_id, platform, parent] : [pub.video_id, platform]), lim, page * lim);
  return { items: rows.map(c => commentOut(c, ctx, channel.user_id)), more: rows.length === lim, total: pub.comment_count };
});
function moderateComment(channel, userId, body) {
  if (get('SELECT 1 AS x FROM hidden_users WHERE channel_id=? AND user_id=?', channel.id, userId)) return 'hidden';
  const m = json(channel.moderation, {});
  if (m.hold_all) return 'held';
  if (m.hold_links && /https?:\/\/|www\./i.test(body)) return 'held';
  const words = Array.isArray(m.blocked) ? m.blocked : [];
  const low = body.toLowerCase();
  if (words.some(w => w && low.includes(String(w).toLowerCase()))) return 'held';
  return 'visible';
}
route('POST', '/api/videos/:id/comments', ctx => {
  const u = need(ctx);
  limit(ctx, 'comment', 20, 300000);
  const platform = platformOf(ctx.body.platform);
  const { pub, channel, manager } = loadPublication(ctx, ctx.params.id, platform);
  if (!pub.allow_comments) throw new HttpError(403, 'Comments are turned off for this video');
  // A comment may be just a picture or GIF, so text is only required without an attachment.
  const attachment = gifs.parseAttachment(ctx.body.attachment, u.id);
  const body = str(ctx.body.body, 'Comment', { min: attachment ? 0 : 1, max: 2000 });
  const parentId = ctx.body.parent_id ? intOf(ctx.body.parent_id, 0) : null;
  let parent = null;
  if (parentId) {
    parent = get('SELECT * FROM comments WHERE id=? AND video_id=? AND platform=? AND parent_id IS NULL', parentId, pub.video_id, platform);
    if (!parent) throw bad('You can only reply to a top-level comment on this video');
  }
  let status = manager ? 'visible' : moderateComment(channel, u.id, body);
  // A GIF whose GIPHY title trips the sexual-content detector waits for the creator's approval.
  if (status === 'visible' && attachment && ['giphy', 'mygif'].includes(attachment.source) && safety.scanVideo({ title: attachment.title, description: '', tags: [] }).hits.length) status = 'held';
  const preview = body || (attachment ? (attachment.kind === 'gif' ? '[GIF]' : '[Picture]') : '');
  const id = tx(() => {
    const r = run('INSERT INTO comments(video_id,platform,user_id,parent_id,body,attachment,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
      pub.video_id, platform, u.id, parentId, body, attachment ? JSON.stringify(attachment) : null, status, now());
    if (status === 'visible') run('UPDATE publications SET comment_count=comment_count+1 WHERE video_id=? AND platform=?', pub.video_id, platform);
    return Number(r.lastInsertRowid);
  });
  const link = (platform === 'geotube' ? '/geotube' : '') + `/watch?v=${pub.video_id}&c=${id}`;
  if (status === 'visible') track(ctx, 'comment', { channelId: channel.id, videoId: pub.video_id, platform });
  if (status === 'held') notify(channel.user_id, 'comments', 'A comment is waiting for your review', preview.slice(0, 120), '/studio/comments?filter=held');
  else if (parent && parent.user_id !== u.id) notify(parent.user_id, 'replies', 'Someone replied to your comment', preview.slice(0, 120), link);
  else if (!parent && channel.user_id !== u.id && status === 'visible') notify(channel.user_id, 'comments', `New comment on "${pub.title}"`, preview.slice(0, 120), link);
  const row = get(`${COMMENT_SELECT} WHERE c.id=?`, id);
  return commentOut(row, ctx, channel.user_id);
});
route('PATCH', '/api/comments/:id', ctx => {
  const u = need(ctx);
  const c = get('SELECT * FROM comments WHERE id=?', intOf(ctx.params.id, 0));
  if (!c || c.user_id !== u.id) throw new HttpError(403, 'You can only edit your own comments');
  // Omitted = keep the current attachment, null = remove it, an object = replace it.
  const attachment = ctx.body.attachment === undefined ? json(c.attachment, null) : gifs.parseAttachment(ctx.body.attachment, u.id);
  const body = str(ctx.body.body, 'Comment', { min: attachment ? 0 : 1, max: 2000 });
  run('UPDATE comments SET body=?, attachment=?, edited_at=? WHERE id=?', body, attachment ? JSON.stringify(attachment) : null, now(), c.id);
  return { ok: true, attachment: gifs.attachmentOut(attachment) };
});
route('DELETE', '/api/comments/:id', ctx => {
  const u = need(ctx);
  const c = get('SELECT c.*, v.channel_id FROM comments c JOIN videos v ON v.id=c.video_id WHERE c.id=?', intOf(ctx.params.id, 0));
  if (!c) throw new HttpError(404, 'Comment not found');
  if (c.user_id !== u.id && !canManageChannel(u, c.channel_id) && !isMod(u)) throw new HttpError(403, 'You cannot delete this comment');
  tx(() => {
    const visible = all("SELECT COUNT(*) AS n FROM comments WHERE (id=? OR parent_id=?) AND status='visible'", c.id, c.id)[0].n;
    run('DELETE FROM comments WHERE id=?', c.id);
    run('UPDATE publications SET comment_count=MAX(0,comment_count-?) WHERE video_id=? AND platform=?', visible, c.video_id, c.platform);
  });
  if (c.user_id !== u.id) audit(u.id, 'comment.delete', 'comment', c.id, { by: canManageChannel(u, c.channel_id) ? 'creator' : 'moderator' });
  return { ok: true };
});
route('POST', '/api/comments/:id/like', ctx => {
  const u = need(ctx);
  limit(ctx, 'clike', 60, 60000);
  const c = get('SELECT id,likes FROM comments WHERE id=?', intOf(ctx.params.id, 0));
  if (!c) throw new HttpError(404, 'Comment not found');
  const liked = tx(() => {
    if (get('SELECT 1 AS x FROM comment_likes WHERE comment_id=? AND user_id=?', c.id, u.id)) {
      run('DELETE FROM comment_likes WHERE comment_id=? AND user_id=?', c.id, u.id);
      run('UPDATE comments SET likes=MAX(0,likes-1) WHERE id=?', c.id); return false;
    }
    run('INSERT INTO comment_likes(comment_id,user_id) VALUES(?,?)', c.id, u.id);
    run('UPDATE comments SET likes=likes+1 WHERE id=?', c.id); return true;
  });
  return { liked, likes: get('SELECT likes FROM comments WHERE id=?', c.id).likes };
});

/* ---------- channels ---------- */
route('GET', '/api/channels/:handle', ctx => {
  const platform = platformOf(ctx.query.platform);
  const ch = get('SELECT * FROM channels WHERE handle=?', String(ctx.params.handle).replace(/^@/, ''));
  if (!ch) throw new HttpError(404, 'Channel not found');
  const manager = ctx.user && (canManageChannel(ctx.user, ch.id) || isMod(ctx.user));
  if (ch.suspended && !manager) throw new HttpError(403, 'This channel is suspended');
  const where = `${CARD} WHERE ${LISTED} AND p.platform=? AND v.channel_id=?`;
  const sections = json(ch.sections, []);
  const out = {
    ...channelPublic(ch, platform), sections, manager: !!manager, suspended: !!ch.suspended,
    video_count: get(`SELECT COUNT(*) AS n FROM publications p JOIN videos v ON v.id=p.video_id JOIN media_assets a ON a.id=v.asset_id JOIN channels c ON c.id=v.channel_id WHERE ${LISTED} AND p.platform=? AND v.channel_id=?`, platform, ch.id).n,
    total_views: get("SELECT COALESCE(SUM(views),0) AS n FROM publications p JOIN videos v ON v.id=p.video_id WHERE v.channel_id=? AND p.platform=?", ch.id, platform).n,
    me: ctx.user ? { subscribed: !!get('SELECT 1 AS x FROM subscriptions WHERE user_id=? AND channel_id=?', ctx.user.id, ch.id),
      sub_notify: (get('SELECT notify FROM subscriptions WHERE user_id=? AND channel_id=?', ctx.user.id, ch.id) || {}).notify || null } : null,
    featured: null, trailer: null, recent: [], popular: [], shorts: [], playlists: [], posts: [],
  };
  const feat = id => (id ? all(`${where} AND v.id=?`, platform, ch.id, id).map(cardOut)[0] || null : null);
  out.featured = feat(ch.featured_video_id);
  out.trailer = feat(ch.trailer_video_id);
  out.recent = all(`${where} ORDER BY p.published_at DESC LIMIT 12`, platform, ch.id).map(cardOut);
  out.popular = all(`${where} AND v.is_short=0 ORDER BY p.views DESC LIMIT 12`, platform, ch.id).map(cardOut);
  out.shorts = all(`${where} AND v.is_short=1 ORDER BY p.published_at DESC LIMIT 12`, platform, ch.id).map(cardOut);
  out.playlists = all(`SELECT pl.id, pl.title, pl.visibility, pl.updated_at, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id=pl.id) AS count,
    (SELECT v.thumb FROM playlist_items i JOIN videos v ON v.id=i.video_id WHERE i.playlist_id=pl.id ORDER BY i.position LIMIT 1) AS thumb
    FROM playlists pl WHERE pl.user_id=? AND pl.visibility='public' AND pl.id NOT LIKE 'WL%' ORDER BY pl.updated_at DESC LIMIT 12`, ch.user_id);
  out.posts = all('SELECT id, body, attachments, created_at FROM community_posts WHERE channel_id=? ORDER BY id DESC LIMIT 10', ch.id).map(p => ({ ...p, attachments: gifs.attachmentsFromRow(p.attachments) }));
  return out;
});
route('GET', '/api/channels/:handle/videos', ctx => {
  const platform = platformOf(ctx.query.platform);
  const ch = get('SELECT id FROM channels WHERE handle=?', String(ctx.params.handle).replace(/^@/, ''));
  if (!ch) throw new HttpError(404, 'Channel not found');
  const { page, lim } = pageOf(ctx);
  const sort = { latest: 'p.published_at DESC', popular: 'p.views DESC', oldest: 'p.published_at ASC' }[ctx.query.sort] || 'p.published_at DESC';
  const kind = ctx.query.kind === 'shorts' ? ' AND v.is_short=1' : ctx.query.kind === 'videos' ? ' AND v.is_short=0' : '';
  const items = all(`${CARD} WHERE ${LISTED} AND p.platform=? AND v.channel_id=?${kind} ORDER BY ${sort} LIMIT ? OFFSET ?`, platform, ch.id, lim, page * lim);
  return { items: items.map(cardOut), more: items.length === lim };
});
route('POST', '/api/channels/:id/subscribe', ctx => {
  const u = need(ctx);
  limit(ctx, 'sub', 60, 60000);
  const ch = get('SELECT * FROM channels WHERE id=?', intOf(ctx.params.id, 0));
  if (!ch) throw new HttpError(404, 'Channel not found');
  if (ch.user_id === u.id) throw bad('You cannot subscribe to your own channel');
  const notifyMode = oneOf(ctx.body.notify || 'personalized', ['all', 'personalized', 'none'], 'Notification setting');
  const existed = !!get('SELECT 1 AS x FROM subscriptions WHERE user_id=? AND channel_id=?', u.id, ch.id);
  run(`INSERT INTO subscriptions(user_id,channel_id,notify,created_at) VALUES(?,?,?,?)
       ON CONFLICT(user_id,channel_id) DO UPDATE SET notify=excluded.notify`, u.id, ch.id, notifyMode, now());
  if (!existed) {
    track(ctx, 'sub', { channelId: ch.id, platform: platformOf(ctx.body.platform), source: ctx.body.video_id || null });
    const n = subscriberCount(ch.id);
    if ([10, 50, 100, 500, 1000, 5000, 10000, 100000].includes(n)) notify(ch.user_id, 'channel', `Your channel reached ${n} subscribers!`, 'Keep it up.', '/studio');
  }
  return { subscribed: true, notify: notifyMode, subscribers: subscriberCount(ch.id) };
});
route('DELETE', '/api/channels/:id/subscribe', ctx => {
  const u = need(ctx);
  const id = intOf(ctx.params.id, 0);
  const r = run('DELETE FROM subscriptions WHERE user_id=? AND channel_id=?', u.id, id);
  if (r.changes) track(ctx, 'unsub', { channelId: id, platform: platformOf(ctx.query.platform) });
  return { subscribed: false, subscribers: subscriberCount(id) };
});
route('GET', '/api/subscriptions', ctx => {
  const u = need(ctx);
  const platform = platformOf(ctx.query.platform);
  return all(`SELECT c.id, c.handle, c.notify, c.is_verified,
      CASE WHEN ?='geotube' AND c.geo_separate=1 AND c.geo_name<>'' THEN c.geo_name ELSE c.name END AS name,
      CASE WHEN ?='geotube' AND c.geo_separate=1 AND c.geo_avatar IS NOT NULL THEN c.geo_avatar ELSE c.avatar END AS avatar,
      (SELECT MAX(p.published_at) FROM publications p JOIN videos v ON v.id=p.video_id WHERE v.channel_id=c.id AND p.platform=? AND p.visibility='public') AS last_upload
    FROM (SELECT ch.*, s.notify FROM subscriptions s JOIN channels ch ON ch.id=s.channel_id WHERE s.user_id=? AND ch.suspended=0) c
    ORDER BY name COLLATE NOCASE`, platform, platform, platform, u.id);
});

/* ---------- playlists ---------- */
function watchLater(userId) {
  const id = 'WL' + userId;
  if (!get('SELECT 1 AS x FROM playlists WHERE id=?', id))
    run("INSERT INTO playlists(id,user_id,title,visibility,created_at,updated_at) VALUES(?,?,'Watch later','private',?,?)", id, userId, now(), now());
  return id;
}
function playlistOut(p, ctx) {
  const items = all(`SELECT i.position, i.platform AS item_platform, c.* FROM playlist_items i JOIN (${CARD}) c ON c.id=i.video_id AND c.platform=i.platform
    WHERE i.playlist_id=? ORDER BY i.position`, p.id);
  const owner = get('SELECT c.handle, c.name, u.email FROM users u LEFT JOIN channels c ON c.user_id=u.id WHERE u.id=?', p.user_id) || {};
  return {
    id: p.id, title: p.title, description: p.description, visibility: p.visibility, updated_at: p.updated_at, created_at: p.created_at,
    owner: { name: owner.name || (owner.email || '').split('@')[0], handle: owner.handle }, mine: !!ctx.user && ctx.user.id === p.user_id,
    items: items.map(cardOut), count: items.length,
  };
}
route('GET', '/api/playlists', ctx => {
  const u = need(ctx);
  watchLater(u.id);
  return all(`SELECT pl.*, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id=pl.id) AS count,
    (SELECT v.thumb FROM playlist_items i JOIN videos v ON v.id=i.video_id WHERE i.playlist_id=pl.id ORDER BY i.position LIMIT 1) AS thumb,
    (SELECT i.video_id FROM playlist_items i WHERE i.playlist_id=pl.id ORDER BY i.position LIMIT 1) AS first_video,
    (SELECT i.platform FROM playlist_items i WHERE i.playlist_id=pl.id ORDER BY i.position LIMIT 1) AS first_platform,
    EXISTS(SELECT 1 FROM playlist_items i WHERE i.playlist_id=pl.id AND i.video_id=? AND i.platform=?) AS has_video
    FROM playlists pl WHERE pl.user_id=? ORDER BY CASE WHEN pl.id LIKE 'WL%' THEN 0 ELSE 1 END, pl.updated_at DESC`,
    ctx.query.video || '', platformOf(ctx.query.platform), u.id).map(p => ({ ...p, has_video: !!p.has_video, watch_later: p.id.startsWith('WL') }));
});
route('POST', '/api/playlists', ctx => {
  const u = need(ctx);
  limit(ctx, 'mkpl', 30, 3600000);
  const id = rid(10);
  run('INSERT INTO playlists(id,user_id,title,description,visibility,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', id, u.id,
    str(ctx.body.title, 'Title', { min: 1, max: 150 }), str(ctx.body.description, 'Description', { max: 5000 }),
    oneOf(ctx.body.visibility || 'private', ['public', 'unlisted', 'private'], 'Visibility'), now(), now());
  return playlistOut(get('SELECT * FROM playlists WHERE id=?', id), ctx);
});
function ownPlaylist(ctx, id) {
  const u = need(ctx);
  if (id === 'WL') id = watchLater(u.id);
  const p = get('SELECT * FROM playlists WHERE id=?', id);
  if (!p || p.user_id !== u.id) throw new HttpError(404, 'Playlist not found');
  return p;
}
route('GET', '/api/playlists/:id', ctx => {
  const id = ctx.params.id === 'WL' ? watchLater(need(ctx).id) : ctx.params.id;
  const p = get('SELECT * FROM playlists WHERE id=?', id);
  if (!p) throw new HttpError(404, 'Playlist not found');
  if (p.visibility === 'private' && (!ctx.user || ctx.user.id !== p.user_id)) throw new HttpError(403, 'This playlist is private');
  return playlistOut(p, ctx);
});
route('PATCH', '/api/playlists/:id', ctx => {
  const p = ownPlaylist(ctx, ctx.params.id);
  if (p.id.startsWith('WL')) throw bad('Watch later cannot be edited');
  run('UPDATE playlists SET title=?, description=?, visibility=?, updated_at=? WHERE id=?',
    ctx.body.title !== undefined ? str(ctx.body.title, 'Title', { min: 1, max: 150 }) : p.title,
    ctx.body.description !== undefined ? str(ctx.body.description, 'Description', { max: 5000 }) : p.description,
    ctx.body.visibility ? oneOf(ctx.body.visibility, ['public', 'unlisted', 'private'], 'Visibility') : p.visibility, now(), p.id);
  return playlistOut(get('SELECT * FROM playlists WHERE id=?', p.id), ctx);
});
route('DELETE', '/api/playlists/:id', ctx => {
  const p = ownPlaylist(ctx, ctx.params.id);
  if (p.id.startsWith('WL')) throw bad('Watch later cannot be deleted');
  run('DELETE FROM playlists WHERE id=?', p.id);
  return { ok: true };
});
route('POST', '/api/playlists/:id/items', ctx => {
  const p = ownPlaylist(ctx, ctx.params.id);
  const platform = platformOf(ctx.body.platform);
  const videoId = str(ctx.body.video_id, 'Video', { min: 1, max: 40 });
  if (!get('SELECT 1 AS x FROM publications WHERE video_id=? AND platform=?', videoId, platform)) throw new HttpError(404, 'Video not found');
  if (get('SELECT COUNT(*) AS n FROM playlist_items WHERE playlist_id=?', p.id).n >= 5000) throw bad('This playlist is full');
  const pos = (get('SELECT COALESCE(MAX(position),0) AS m FROM playlist_items WHERE playlist_id=?', p.id).m || 0) + 1;
  run('INSERT OR IGNORE INTO playlist_items(playlist_id,video_id,platform,position,added_at) VALUES(?,?,?,?,?)', p.id, videoId, platform, pos, now());
  run('UPDATE playlists SET updated_at=? WHERE id=?', now(), p.id);
  return { ok: true, added: true };
});
route('DELETE', '/api/playlists/:id/items/:videoId', ctx => {
  const p = ownPlaylist(ctx, ctx.params.id);
  run('DELETE FROM playlist_items WHERE playlist_id=? AND video_id=? AND platform=?', p.id, ctx.params.videoId, platformOf(ctx.query.platform));
  run('UPDATE playlists SET updated_at=? WHERE id=?', now(), p.id);
  return { ok: true, added: false };
});
route('PATCH', '/api/playlists/:id/items', ctx => {
  const p = ownPlaylist(ctx, ctx.params.id);
  const order = Array.isArray(ctx.body.order) ? ctx.body.order : [];
  tx(() => order.forEach((key, i) => {
    const [vid, plat] = String(key).split('@');
    run('UPDATE playlist_items SET position=? WHERE playlist_id=? AND video_id=? AND platform=?', i + 1, p.id, vid, platformOf(plat));
  }));
  return { ok: true };
});

/* ---------- library + history ---------- */
route('GET', '/api/library', ctx => {
  const u = need(ctx);
  const platform = platformOf(ctx.query.platform);
  const wl = watchLater(u.id);
  return {
    history: all(`SELECT h.position, h.pct, h.watched_at, c.* FROM watch_history h JOIN (${CARD}) c ON c.id=h.video_id AND c.platform=h.platform
      WHERE h.user_id=? AND h.platform=? ORDER BY h.watched_at DESC LIMIT 12`, u.id, platform).map(cardOut),
    liked: all(`SELECT r.created_at AS liked_at, c.* FROM reactions r JOIN (${CARD}) c ON c.id=r.video_id AND c.platform=r.platform
      WHERE r.user_id=? AND r.value=1 ORDER BY r.created_at DESC LIMIT 12`, u.id).map(cardOut),
    watch_later: playlistOut(get('SELECT * FROM playlists WHERE id=?', wl), ctx),
    playlists: all(`SELECT pl.*, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id=pl.id) AS count,
      (SELECT v.thumb FROM playlist_items i JOIN videos v ON v.id=i.video_id WHERE i.playlist_id=pl.id ORDER BY i.position LIMIT 1) AS thumb
      FROM playlists pl WHERE pl.user_id=? AND pl.id NOT LIKE 'WL%' ORDER BY pl.updated_at DESC`, u.id),
  };
});
route('GET', '/api/history', ctx => {
  const u = need(ctx);
  const q = str(ctx.query.q, 'Search', { max: 100 });
  const { page, lim } = pageOf(ctx);
  const items = all(`SELECT h.position, h.pct, h.watched_at, c.* FROM watch_history h JOIN (${CARD}) c ON c.id=h.video_id AND c.platform=h.platform
    WHERE h.user_id=? ${q ? 'AND c.title LIKE ?' : ''} ORDER BY h.watched_at DESC LIMIT ? OFFSET ?`, ...(q ? [u.id, `%${q}%`] : [u.id]), lim, page * lim);
  const p = get('SELECT history_paused FROM user_prefs WHERE user_id=?', u.id);
  return { items: items.map(cardOut), more: items.length === lim, paused: !!(p && p.history_paused),
    searches: all('SELECT id, query, scope, created_at FROM search_history WHERE user_id=? ORDER BY id DESC LIMIT 30', u.id) };
});
route('DELETE', '/api/history', ctx => { const u = need(ctx); run('DELETE FROM watch_history WHERE user_id=?', u.id); return { ok: true }; });
route('DELETE', '/api/history/:videoId', ctx => { const u = need(ctx); run('DELETE FROM watch_history WHERE user_id=? AND video_id=?', u.id, ctx.params.videoId); return { ok: true }; });
route('DELETE', '/api/search-history', ctx => { const u = need(ctx); run('DELETE FROM search_history WHERE user_id=?', u.id); return { ok: true }; });
route('GET', '/api/liked', ctx => {
  const u = need(ctx);
  const { page, lim } = pageOf(ctx);
  const items = all(`SELECT r.created_at AS liked_at, c.* FROM reactions r JOIN (${CARD}) c ON c.id=r.video_id AND c.platform=r.platform
    WHERE r.user_id=? AND r.value=1 ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, u.id, lim, page * lim);
  return { items: items.map(cardOut), more: items.length === lim };
});

/* ---------- search ---------- */
route('GET', '/api/search', ctx => {
  const platform = platformOf(ctx.query.platform);
  const q = str(ctx.query.q, 'Search', { max: 200 });
  if (!q) return { videos: [], channels: [], playlists: [], more: false };
  limit(ctx, 'search', 120, 60000);
  const { page, lim } = pageOf(ctx);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const type = ctx.query.type || 'all';
  const likeArgs = [];
  const where = terms.map(t => { likeArgs.push(`%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`); return '(p.title LIKE ? OR p.description LIKE ? OR v.tags LIKE ? OR c.name LIKE ?)'; }).join(' AND ');
  const scoreArgs = [];
  const score = terms.map(t => { scoreArgs.push(`%${t}%`, `%${t}%`, `%${t}%`); return '(CASE WHEN p.title LIKE ? THEN 5 ELSE 0 END)+(CASE WHEN v.tags LIKE ? THEN 2 ELSE 0 END)+(CASE WHEN p.description LIKE ? THEN 1 ELSE 0 END)'; }).join('+');
  let extra = '';
  const dur = { short: ' AND a.duration<240', medium: ' AND a.duration>=240 AND a.duration<=1200', long: ' AND a.duration>1200' }[ctx.query.duration] || '';
  const dateMs = { hour: 3600000, today: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY }[ctx.query.date];
  if (dateMs) extra += ` AND p.published_at>${now() - dateMs}`;
  if (type === 'short') extra += ' AND v.is_short=1';
  if (type === 'video') extra += ' AND v.is_short=0';
  const cat = categoryFilter(platform, ctx.query.cat);
  const order = { date: 'p.published_at DESC', views: 'p.views DESC', rating: 'p.likes DESC' }[ctx.query.sort] || 'score DESC, p.views DESC';
  const videos = type === 'channel' || type === 'playlist' ? [] : all(`${CARD.replace('SELECT ', `SELECT (${score}) AS score, `)} WHERE ${LISTED} AND p.platform=? AND ${where}${dur}${extra}${cat.sql}${notInterestedSql(ctx)} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...scoreArgs, platform, ...likeArgs, ...cat.args, lim, page * lim).map(cardOut);
  const channels = page === 0 && (type === 'all' || type === 'channel') ? all(`SELECT c.id, c.handle, c.is_verified, ${BADGES_SQL('c.user_id')} AS badges,
      CASE WHEN ?='geotube' AND c.geo_separate=1 AND c.geo_name<>'' THEN c.geo_name ELSE c.name END AS name,
      CASE WHEN ?='geotube' AND c.geo_separate=1 AND c.geo_avatar IS NOT NULL THEN c.geo_avatar ELSE c.avatar END AS avatar,
      CASE WHEN ?='geotube' AND c.geo_separate=1 AND c.geo_description<>'' THEN c.geo_description ELSE c.description END AS description,
      (SELECT COUNT(*) FROM publications p JOIN videos v ON v.id=p.video_id WHERE v.channel_id=c.id AND p.platform=? AND p.visibility='public' AND p.status='approved') AS video_count
    FROM channels c WHERE c.suspended=0 AND (c.name LIKE ? OR c.handle LIKE ? OR c.geo_name LIKE ?) ORDER BY video_count DESC LIMIT 6`,
    platform, platform, platform, platform, `%${q}%`, `%${q}%`, `%${q}%`).map(c => ({ ...c, is_verified: !!c.is_verified, badges: badgeList(c.badges), subscribers: subscriberCount(c.id) })) : [];
  const playlists = page === 0 && (type === 'all' || type === 'playlist') ? all(`SELECT pl.id, pl.title, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id=pl.id) AS count,
      (SELECT v.thumb FROM playlist_items i JOIN videos v ON v.id=i.video_id WHERE i.playlist_id=pl.id ORDER BY i.position LIMIT 1) AS thumb,
      (SELECT COALESCE(c.name, u.email) FROM users u LEFT JOIN channels c ON c.user_id=u.id WHERE u.id=pl.user_id) AS owner
    FROM playlists pl WHERE pl.visibility='public' AND pl.title LIKE ? AND pl.id NOT LIKE 'WL%' ORDER BY pl.updated_at DESC LIMIT 6`, `%${q}%`) : [];
  if (ctx.user && page === 0) {
    run('INSERT INTO search_history(user_id,query,scope,created_at) VALUES(?,?,?,?)', ctx.user.id, q, platform, now());
    run('DELETE FROM search_history WHERE user_id=? AND id NOT IN (SELECT id FROM search_history WHERE user_id=? ORDER BY id DESC LIMIT 100)', ctx.user.id, ctx.user.id);
  }
  return { videos, channels, playlists, more: videos.length === lim };
});
route('GET', '/api/search/suggest', ctx => {
  const platform = platformOf(ctx.query.platform);
  const q = str(ctx.query.q, 'Search', { max: 100 }).toLowerCase();
  if (!q) return { items: ctx.user ? all('SELECT DISTINCT query AS text FROM search_history WHERE user_id=? AND scope=? ORDER BY id DESC LIMIT 8', ctx.user.id, platform).map(r => ({ text: r.text, history: true })) : [] };
  const hist = ctx.user ? all('SELECT DISTINCT query AS text FROM search_history WHERE user_id=? AND query LIKE ? ORDER BY id DESC LIMIT 3', ctx.user.id, `${q}%`).map(r => ({ text: r.text, history: true })) : [];
  const titles = all(`SELECT DISTINCT p.title AS text FROM publications p JOIN videos v ON v.id=p.video_id JOIN channels c ON c.id=v.channel_id JOIN media_assets a ON a.id=v.asset_id
    WHERE ${LISTED} AND p.platform=? AND p.title LIKE ? ORDER BY p.views DESC LIMIT 6`, platform, `%${q}%`).map(r => ({ text: r.text }));
  const chans = all('SELECT name AS text, handle FROM channels WHERE suspended=0 AND (name LIKE ? OR handle LIKE ?) LIMIT 3', `${q}%`, `${q}%`).map(r => ({ text: r.text, channel: r.handle }));
  return { items: [...hist, ...chans, ...titles].slice(0, 10) };
});

/* ---------- notifications ---------- */
route('GET', '/api/notifications', ctx => {
  const u = need(ctx);
  const { page, lim } = pageOf(ctx);
  const items = all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?', u.id, lim, page * lim);
  return { items, unread: get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read=0', u.id).n, more: items.length === lim };
});
route('POST', '/api/notifications/read', ctx => {
  const u = need(ctx);
  if (Array.isArray(ctx.body.ids)) for (const id of ctx.body.ids.slice(0, 100)) run('UPDATE notifications SET read=1 WHERE user_id=? AND id=?', u.id, intOf(id, 0));
  else run('UPDATE notifications SET read=1 WHERE user_id=?', u.id);
  return { unread: get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read=0', u.id).n };
});
route('DELETE', '/api/notifications/:id', ctx => { const u = need(ctx); run('DELETE FROM notifications WHERE user_id=? AND id=?', u.id, intOf(ctx.params.id, 0)); return { ok: true }; });

/* ---------- reports + copyright ---------- */
const REASONS = ['spam', 'sexual', 'violent', 'hateful', 'harassment', 'harmful', 'misinformation', 'child_safety', 'legal', 'off_topic', 'other'];
// Anyone may report, signed in or not. Anonymous reports are rate-limited per IP.
route('POST', '/api/reports', ctx => {
  const u = ctx.user;
  limit(ctx, 'report', u ? 20 : 8, 3600000);
  const targetType = oneOf(ctx.body.target_type, ['video', 'comment', 'channel'], 'Report target');
  const targetId = str(ctx.body.target_id, 'Target', { min: 1, max: 40 });
  const reason = oneOf(ctx.body.reason, REASONS, 'Reason');
  const platform = ctx.body.platform ? platformOf(ctx.body.platform) : null;
  if (u && get("SELECT 1 AS x FROM reports WHERE reporter_id=? AND target_type=? AND target_id=? AND status='open'", u.id, targetType, targetId)) return { ok: true, duplicate: true };
  run('INSERT INTO reports(reporter_id,target_type,target_id,platform,reason,details,created_at) VALUES(?,?,?,?,?,?,?)',
    u ? u.id : null, targetType, targetId, platform, reason, str(ctx.body.details, 'Details', { max: 2000 }), now());
  return { ok: true };
});
route('POST', '/api/claims', ctx => {
  const u = need(ctx);
  limit(ctx, 'claim', 5, 3600000);
  const videoId = str(ctx.body.video_id, 'Video', { min: 1, max: 40 });
  if (!get('SELECT 1 AS x FROM videos WHERE id=?', videoId)) throw new HttpError(404, 'Video not found');
  run('INSERT INTO copyright_claims(claimant_id,video_id,work,details,created_at) VALUES(?,?,?,?,?)', u.id, videoId,
    str(ctx.body.work, 'Your original work', { min: 3, max: 500 }), str(ctx.body.details, 'Details', { min: 20, max: 5000 }), now());
  return { ok: true };
});

/* ---------- misc ---------- */
route('GET', '/api/users/lookup', ctx => {
  need(ctx);
  const email = str(ctx.query.email, 'Email', { min: 3, max: 200 });
  const u = get('SELECT u.id, c.handle, c.name FROM users u LEFT JOIN channels c ON c.user_id=u.id WHERE u.email=?', email);
  return u ? { found: true, name: u.name || email, handle: u.handle } : { found: false };
});

module.exports = { loadPublication, channelPublic, cardOut, watchLater };
