'use strict';
// Shared server plumbing: query helpers, routing table, auth/permission checks,
// rate limiting, notifications (with SSE push), audit log and listing SQL.
const crypto = require('crypto');
const { db } = require('./db');

/* ---------- database helpers ---------- */
const stmts = new Map();
const norm = a => a.map(x => (x === undefined ? null : x === true ? 1 : x === false ? 0 : x));
function prep(sql) {
  let s = stmts.get(sql);
  if (!s) { s = db.prepare(sql); stmts.set(sql, s); }
  return s;
}
const get = (sql, ...a) => prep(sql).get(...norm(a));
const all = (sql, ...a) => prep(sql).all(...norm(a));
const run = (sql, ...a) => prep(sql).run(...norm(a));
let txDepth = 0;
function tx(fn) {
  if (txDepth) return fn();
  db.exec('BEGIN'); txDepth++;
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { txDepth--; }
}

/* ---------- errors + validation ---------- */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = msg => new HttpError(400, msg);
function str(v, name, { min = 0, max = 5000 } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  v = v.trim();
  if (v.length < min) throw bad(min === 1 ? `${name} is required` : `${name} must be at least ${min} characters`);
  if (v.length > max) throw bad(`${name} must be at most ${max} characters`);
  return v;
}
function oneOf(v, list, name) {
  if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}`);
  return v;
}
const platformOf = v => (v === 'geotube' ? 'geotube' : 'vidtube');
const intOf = (v, def, min = 0, max = 1e9) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const json = (s, def) => { try { return JSON.parse(s); } catch { return def; } };

/* ---------- ids, hashing ---------- */
const now = () => Date.now();
const DAY = 86400000;
const dayStr = ts => new Date(ts).toISOString().slice(0, 10);
const rid = (bytes = 8) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
function hashPassword(pw) {
  return new Promise((ok, fail) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(pw, salt, 64, (e, key) => (e ? fail(e) : ok(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`)));
  });
}
function verifyPassword(pw, stored) {
  return new Promise(ok => {
    const [alg, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt' || !salt || !hash) return ok(false);
    crypto.scrypt(pw, Buffer.from(salt, 'hex'), 64, (e, key) => {
      if (e) return ok(false);
      const want = Buffer.from(hash, 'hex');
      ok(want.length === key.length && crypto.timingSafeEqual(want, key));
    });
  });
}

/* ---------- routing ---------- */
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, rx, keys, handler, opts });
}
function matchRoute(method, pathname) {
  let pathMatched = false;
  for (const r of routes) {
    const m = r.rx.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params = {};
    r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
    return { route: r, params };
  }
  return pathMatched ? { wrongMethod: true } : null;
}

/* ---------- auth + permissions ---------- */
const ROLE_RANK = { user: 0, creator: 1, moderator: 2, admin: 3 };
function need(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Please sign in to continue');
  if (ctx.user.status === 'suspended') throw new HttpError(403, 'Your account is suspended');
  return ctx.user;
}
function needRole(ctx, role) {
  const u = need(ctx);
  if (ROLE_RANK[u.role] < ROLE_RANK[role]) throw new HttpError(403, 'You do not have permission to do that');
  return u;
}
const isMod = u => !!u && ROLE_RANK[u.role] >= ROLE_RANK.moderator;
const channelOfUser = userId => get('SELECT * FROM channels WHERE user_id=?', userId);
function canManageChannel(user, channelId) {
  if (!user) return false;
  const ch = get('SELECT user_id FROM channels WHERE id=?', channelId);
  if (!ch) return false;
  if (ch.user_id === user.id) return true;
  return !!get('SELECT 1 AS x FROM channel_managers WHERE channel_id=? AND user_id=?', channelId, user.id);
}
// The channel a Studio request acts on: the caller's own, or one they manage (?ch=ID).
function studioChannel(ctx) {
  const u = need(ctx);
  const chId = ctx.query.ch ? intOf(ctx.query.ch, 0) : 0;
  if (chId) {
    if (!canManageChannel(u, chId)) throw new HttpError(403, 'You are not a manager of that channel');
    const ch = get('SELECT * FROM channels WHERE id=?', chId);
    ch.isOwner = ch.user_id === u.id;
    return ch;
  }
  const ch = channelOfUser(u.id);
  if (!ch) throw new HttpError(409, 'Create a channel first');
  ch.isOwner = true;
  return ch;
}

/* ---------- rate limiting (in-memory, per process) ---------- */
const buckets = new Map();
function limit(ctx, name, max, windowMs) {
  const key = `${name}:${ctx.user ? 'u' + ctx.user.id : ctx.ip}`;
  const t = now();
  let b = buckets.get(key);
  if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  if (++b.n > max) throw new HttpError(429, 'You are doing that too often. Please wait a moment and try again.');
}
setInterval(() => { const t = now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60000).unref();

/* ---------- notifications + realtime ---------- */
const streams = new Map(); // userId -> Set<res>
function pushEvent(userId, event, data) {
  const set = streams.get(userId);
  if (!set) return;
  for (const res of set) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
const ALWAYS_NOTIFY = new Set(['security', 'moderation', 'geotube_review']);
function notify(userId, type, title, body = '', link = null) {
  if (!userId) return;
  if (!ALWAYS_NOTIFY.has(type)) {
    const p = get('SELECT notif FROM user_prefs WHERE user_id=?', userId);
    if (p && json(p.notif, {})[type] === false) return;
  }
  const r = run('INSERT INTO notifications(user_id,type,title,body,link,created_at) VALUES(?,?,?,?,?,?)',
    userId, type, title, body, link, now());
  pushEvent(userId, 'notification', { id: Number(r.lastInsertRowid), type, title, body, link, read: 0, created_at: now() });
}
function audit(actorId, action, targetType, targetId, details) {
  run('INSERT INTO audit_logs(actor_id,action,target_type,target_id,details,created_at) VALUES(?,?,?,?,?,?)',
    actorId, action, targetType, targetId == null ? null : String(targetId), details ? JSON.stringify(details) : null, now());
}

/* ---------- settings ---------- */
const DEFAULT_SETTINGS = {
  geotube: {
    mode: 'review_flagged', // 'review_flagged' | 'review_all'
    reviewFirstUpload: false,
    positive: ['map', 'maps', 'mapping', 'mapper', 'countryball', 'countryballs', 'polandball', 'border', 'borders',
      'geography', 'geographic', 'geopolitic', 'geopolitical', 'atlas', 'territory', 'territorial', 'empire', 'kingdom',
      'province', 'provinces', 'country', 'countries', 'continent', 'flag', 'flags', 'alternate history', 'timeline',
      'cartography', 'historical', 'history', 'europe', 'world war', 'capital', 'population', 'region', 'nation', 'nations'],
    negative: ['vlog', 'gameplay', "let's play", 'lets play', 'walkthrough', 'speedrun', 'fortnite', 'minecraft', 'roblox',
      'unboxing', 'reaction', 'reacts to', 'music video', 'lyrics', 'official audio', 'cover song', 'prank', 'asmr',
      'makeup', 'recipe', 'cooking', 'workout', 'tutorial', 'haul', 'mukbang', 'giveaway', 'podcast', 'meme compilation'],
  },
  uploads: { maxVideoMB: 500 },
  monetization: { enabled: false },
  // Halloween event (src/halloween.js): pumpkin logo + own GIF maker after `goal` views. Runs in
  // October; alwaysOn ignores the dates.
  halloween: { enabled: true, goal: 10, alwaysOn: false },
  // House ads (src/ads.js): befriended YouTube channels. One rotating banner per page; sometimes a
  // pre-roll of prerollMin-prerollMax seconds in videos (never in Shorts), with prerollChance %.
  ads: {
    enabled: true, preroll: true, prerollChance: 50, prerollMin: 5, prerollMax: 10,
    channels: [
      { id: 'belgian_mapper', name: 'Belgian_Mapper', handle: '@Belgian_Mapper-t6z', url: 'https://www.youtube.com/@Belgian_Mapper-t6z', avatar: '/img/ads/Belgian_Mapper-t6z.jpg', tagline: 'Mapping videos from Belgium', subscribers: '46 subscribers', enabled: true },
      { id: 'mapper_from_mars', name: 'Mapper From Mars', handle: '@MapperFromMars', url: 'https://www.youtube.com/@MapperFromMars', avatar: '/img/ads/MapperFromMars.jpg', tagline: 'Mapping and alternate history', subscribers: '766 subscribers', enabled: true },
      { id: 'mapper_from_greece', name: 'Mapper_from.greece', handle: '@mapperfromgreece', url: 'https://www.youtube.com/@mapperfromgreece', avatar: '/img/ads/mapperfromgreece.jpg', tagline: 'Mapping content from Greece', subscribers: '155K subscribers', enabled: true },
      { id: 'bayronplays2', name: 'Bayronplays 2', handle: '@Bayronplays2', url: 'https://www.youtube.com/@Bayronplays2', avatar: '/img/ads/Bayronplays2.jpg', tagline: 'Gaming videos', subscribers: '5.87K subscribers', enabled: true },
      { id: 'belixgaming', name: 'BelixGaming', handle: '@BelixGaming-t2w', url: 'https://www.youtube.com/@BelixGaming-t2w', avatar: '/img/ads/BelixGaming-t2w.jpg', tagline: 'Gaming and fun', subscribers: '407 subscribers', enabled: true },
      { id: 'notnol2', platform: 'TikTok', name: 'notnoël', handle: '@notnol2', url: 'https://www.tiktok.com/@notnol2', avatar: '/img/ads/notnol2.jpg', tagline: 'Short videos on TikTok', subscribers: '20 followers', enabled: true },
    ],
  },
  // YouTube auto-import (src/youtube.js): followed channels are checked every intervalMinutes;
  // new videos are downloaded at most maxHeight pixels on the longest side.
  youtube: { enabled: true, intervalMinutes: 2, maxHeight: 1280 },
  // Sexual-content detector (src/safety.js). One matched term holds a video for moderator review.
  safety: {
    enabled: true,
    terms: ['sex', 'sexy', 'sexual', 'seks', 'seksueel', 'seksuele', 'sexueel', 'sexuele', 'porn', 'porno', 'pornography', 'pornografie', 'xxx', 'nsfw',
      '18+', 'adult only', 'adults only', 'nude', 'nudes', 'nudity', 'naked', 'naakt', 'bloot', 'topless', 'erotic', 'erotica', 'erotisch',
      'hentai', 'onlyfans', 'only fans', 'camgirl', 'cam girl', 'webcam girl', 'stripper', 'striptease', 'strip tease', 'lap dance',
      'escort', 'hooker', 'prostitute', 'prostituee', 'hoer', 'blowjob', 'blow job', 'pijpen', 'handjob', 'anal', 'anaal', 'orgasm', 'orgasme',
      'masturbate', 'masturbation', 'masturberen', 'cumshot', 'penis', 'pussy', 'vagina', 'kut', 'lul', 'boobs',
      'tits', 'tieten', 'titties', 'nipples', 'tepels', 'kont', 'booty', 'twerk', 'twerking', 'milf', 'thot', 'slut', 'slet',
      'whore', 'fuck', 'fucking', 'neuken', 'neuk', 'horny', 'geil', 'fetish', 'bdsm', 'bondage', 'hardcore', 'softcore', 'deepthroat',
      'threesome', 'gangbang', 'lingerie', 'bikini try on', 'try on haul', 'sextape', 'sex tape', 'nsfl', 'rule34', 'rule 34', 'ahegao',
      'lewd', 'ecchi', 'yiff', 'furry porn', 'xvideos', 'pornhub', 'xhamster', 'redtube', 'brazzers', 'chaturbate', 'stripchat', 'fansly'],
  },
};
function getSetting(key) {
  const r = get('SELECT value FROM settings WHERE key=?', key);
  return { ...DEFAULT_SETTINGS[key], ...(r ? json(r.value, {}) : {}) };
}
function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
}

/* ---------- badges ---------- */
// Special badges shown next to a name. "owner" can be held by exactly one account (the site owner);
// "moderator" is given by an administrator to community staff. Pictures live in public/img/badges/.
const BADGES = {
  owner: { label: 'VidTube Owner', description: 'The owner of VidTube. Only one account can have this badge.' },
  moderator: { label: 'VidTube Moderator', description: 'VidTube community staff.' },
};
const BADGES_SQL = userCol => `(SELECT GROUP_CONCAT(b.badge) FROM user_badges b WHERE b.user_id=${userCol})`;
const badgeList = v => (v ? String(v).split(',').filter(b => BADGES[b]) : []);
function badgesOf(userId) { return badgeList(all('SELECT badge FROM user_badges WHERE user_id=?', userId).map(r => r.badge).join(',')); }

/* ---------- listing SQL ---------- */
const CARD = `SELECT v.id, p.platform, p.title, p.category, p.views, p.likes, p.published_at, p.visibility, p.status,
  a.duration, v.is_short, v.thumb, v.is_demo, v.channel_id, c.handle, c.is_verified, ${BADGES_SQL('c.user_id')} AS badges,
  CASE WHEN p.platform='geotube' AND c.geo_separate=1 AND c.geo_name IS NOT NULL AND c.geo_name<>'' THEN c.geo_name ELSE c.name END AS channel_name,
  CASE WHEN p.platform='geotube' AND c.geo_separate=1 AND c.geo_avatar IS NOT NULL THEN c.geo_avatar ELSE c.avatar END AS channel_avatar
  FROM publications p JOIN videos v ON v.id=p.video_id JOIN channels c ON c.id=v.channel_id JOIN media_assets a ON a.id=v.asset_id`;
// A publication appears in feeds/search only when all of these hold.
const LISTED = `p.visibility='public' AND p.status='approved' AND a.status='ready' AND c.suspended=0`;

function subscriberCount(channelId) {
  const ch = get('SELECT demo_subs FROM channels WHERE id=?', channelId);
  return (ch ? ch.demo_subs : 0) + get('SELECT COUNT(*) AS n FROM subscriptions WHERE channel_id=?', channelId).n;
}

/* ---------- analytics events ---------- */
function deviceOf(ua = '') {
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  if (/SmartTV|TV;/i.test(ua)) return 'tv';
  return 'desktop';
}
function countryOf(req) {
  // No geo-IP database is bundled: region is approximated from the browser language (e.g. nl-BE -> BE).
  const m = /^[a-z]{2,3}-([A-Z]{2})/.exec(req.headers['accept-language'] || '');
  return m ? m[1] : 'Unknown';
}
function track(ctx, type, { channelId, videoId = null, platform = 'vidtube', value = 1, source = null, meta = null }) {
  const t = now();
  run(`INSERT INTO analytics_events(channel_id,video_id,platform,type,value,user_id,device,country,source,meta,day,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    channelId, videoId, platform, type, value, ctx.user ? ctx.user.id : null,
    deviceOf(ctx.req.headers['user-agent']), countryOf(ctx.req), source, meta, dayStr(t), t);
}
const viewerKey = ctx => (ctx.user ? 'u' + ctx.user.id : 'a' + sha256(ctx.ip + '|' + (ctx.req.headers['user-agent'] || '')).slice(0, 20));

module.exports = {
  db, get, all, run, tx, HttpError, bad, str, oneOf, platformOf, intOf, json, now, DAY, dayStr, rid, sha256,
  hashPassword, verifyPassword, routes, route, matchRoute, need, needRole, isMod, ROLE_RANK, channelOfUser,
  canManageChannel, studioChannel, limit, streams, pushEvent, notify, audit, getSetting, setSetting, DEFAULT_SETTINGS,
  CARD, LISTED, subscriberCount, track, viewerKey, deviceOf, BADGES, BADGES_SQL, badgeList, badgesOf,
};
