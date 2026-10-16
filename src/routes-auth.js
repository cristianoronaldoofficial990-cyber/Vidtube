'use strict';
// Accounts: registration, sign-in, sessions, password reset, preferences, channels, data export and deletion.
const fs = require('fs');
const path = require('path');
const {
  get, all, run, tx, route, HttpError, bad, str, json, now, DAY, rid, sha256, hashPassword, verifyPassword,
  need, limit, notify, audit, channelOfUser, intOf,
} = require('./core');
const media = require('./media');
const mail = require('./mail');
const config = require('./config');

const SESSION_DAYS = 30;
const COOKIE = 'vt_session';
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HANDLE_RX = /^[A-Za-z0-9_.-]{3,30}$/;
const RESERVED = ['admin', 'studio', 'geotube', 'vidtube', 'api', 'watch', 'settings', 'login', 'register', 'help', 'support', 'moderator'];
const devMailbox = process.env.DEV_MAILBOX !== '0';

const cookieOf = (name, value, maxAgeSec) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`;
const readCookie = (req, name) => { const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || ''); return m ? m[1] : null; };
const baseUrl = ctx => config.siteUrl || `${ctx.req.headers['x-forwarded-proto'] || 'http'}://${ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host}`;

function startSession(ctx, userId) {
  const token = rid(32);
  run('INSERT INTO sessions(id,user_id,created_at,expires_at,ip,ua) VALUES(?,?,?,?,?,?)',
    sha256(token), userId, now(), now() + SESSION_DAYS * DAY, ctx.ip, String(ctx.req.headers['user-agent'] || '').slice(0, 200));
  ctx.setCookie(cookieOf(COOKIE, token, SESSION_DAYS * 86400));
}
// Resolves the signed-in user from the session cookie (called by the server for every request).
function loadSession(req) {
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  const id = sha256(raw);
  const s = get('SELECT * FROM sessions WHERE id=?', id);
  if (!s) return null;
  if (s.expires_at < now()) { run('DELETE FROM sessions WHERE id=?', id); return null; }
  const user = get('SELECT id,email,role,status,email_verified,created_at FROM users WHERE id=?', s.user_id);
  if (user) user.sessionId = id;
  return user;
}

/* ---------- password reset tokens ---------- */
function emailToken(userId, kind, ttlMs) {
  const token = rid(24);
  run('DELETE FROM email_tokens WHERE user_id=? AND kind=?', userId, kind);
  run('INSERT INTO email_tokens(token_hash,user_id,kind,expires_at) VALUES(?,?,?,?)', sha256(token), userId, kind, now() + ttlMs);
  return token;
}
function useToken(token, kind) {
  const t = get('SELECT * FROM email_tokens WHERE token_hash=? AND kind=?', sha256(String(token || '')), kind);
  if (!t || t.used || t.expires_at < now()) throw bad('This link is invalid or has expired');
  run('UPDATE email_tokens SET used=1 WHERE token_hash=?', t.token_hash);
  return t.user_id;
}
const password = v => {
  if (typeof v !== 'string' || v.length < 8) throw bad('Password must be at least 8 characters');
  if (v.length > 200) throw bad('Password is too long');
  return v;
};

function meOf(user) {
  const ch = channelOfUser(user.id);
  const p = get('SELECT * FROM user_prefs WHERE user_id=?', user.id) || {};
  return {
    user: { id: user.id, email: user.email, role: user.role, email_verified: !!user.email_verified, created_at: user.created_at },
    channel: ch ? {
      id: ch.id, handle: ch.handle, name: ch.name, avatar: ch.avatar, banner: ch.banner, geo_separate: !!ch.geo_separate,
    } : null,
    managed: all(`SELECT c.id, c.handle, c.name, c.avatar FROM channel_managers m JOIN channels c ON c.id=m.channel_id WHERE m.user_id=?`, user.id),
    prefs: {
      theme: p.theme || 'system', interests: json(p.interests, []), history_paused: !!p.history_paused,
      notif: json(p.notif, {}), privacy: json(p.privacy, {}), onboarded: !!p.onboarded,
    },
    unread: get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read=0', user.id).n,
    badges: require('./core').badgesOf(user.id),
  };
}

/* ---------- register + login ---------- */
route('POST', '/api/auth/register', async ctx => {
  limit(ctx, 'register', 5, 3600000);
  const email = str(ctx.body.email, 'Email', { min: 3, max: 200 }).toLowerCase();
  if (!EMAIL_RX.test(email)) throw bad('Enter a valid email address');
  const pw = password(ctx.body.password);
  if (get('SELECT 1 AS x FROM users WHERE email=?', email)) throw new HttpError(409, 'An account with this email already exists');
  const hash = await hashPassword(pw);
  const id = tx(() => {
    const r = run('INSERT INTO users(email,password_hash,email_verified,created_at) VALUES(?,?,1,?)', email, hash, now());
    run('INSERT INTO user_prefs(user_id) VALUES(?)', r.lastInsertRowid);
    return Number(r.lastInsertRowid);
  });
  startSession(ctx, id);
  audit(id, 'account.register', 'user', id);
  return meOf(get('SELECT * FROM users WHERE id=?', id));
});
route('POST', '/api/auth/login', async ctx => {
  limit(ctx, 'login', 10, 600000);
  const email = str(ctx.body.email, 'Email', { min: 1, max: 200 });
  const user = get('SELECT * FROM users WHERE email=?', email);
  const ok = await verifyPassword(String(ctx.body.password || ''), user ? user.password_hash : 'scrypt$00$00');
  if (!user || !ok) throw new HttpError(401, 'Incorrect email or password');
  if (user.status === 'suspended') throw new HttpError(403, 'This account has been suspended. Contact support to appeal.');
  startSession(ctx, user.id);
  return meOf(user);
});

route('POST', '/api/auth/logout', ctx => {
  if (ctx.user) run('DELETE FROM sessions WHERE id=?', ctx.user.sessionId);
  ctx.setCookie(cookieOf(COOKIE, '', 0));
  return { ok: true };
});
route('GET', '/api/me', ctx => (ctx.user ? meOf(ctx.user) : { user: null, mail: mail.enabled }));

/* ---------- password reset + change ---------- */
route('POST', '/api/auth/forgot', async ctx => {
  limit(ctx, 'forgot', 5, 3600000);
  const email = str(ctx.body.email, 'Email', { min: 1, max: 200 });
  const user = get('SELECT id,email FROM users WHERE email=?', email);
  if (user) {
    const token = emailToken(user.id, 'reset', 3600000);
    await mail.sendLink(user.email, 'Reset your VidTube password', 'Click the button to choose a new password. The link expires in one hour.', `${baseUrl(ctx)}/reset-password?token=${token}`, 'Choose a new password');
  }
  return { ok: true }; // identical response whether or not the account exists
});
route('POST', '/api/auth/reset', async ctx => {
  limit(ctx, 'reset', 10, 3600000);
  const pw = password(ctx.body.password);
  const userId = useToken(ctx.body.token, 'reset');
  run('UPDATE users SET password_hash=?, email_verified=1 WHERE id=?', await hashPassword(pw), userId);
  run('DELETE FROM sessions WHERE user_id=?', userId);
  notify(userId, 'security', 'Your password was reset', 'All devices were signed out. If this was not you, contact support.', '/settings');
  return { ok: true };
});
route('POST', '/api/auth/change-password', async ctx => {
  const u = need(ctx);
  limit(ctx, 'chpw', 5, 600000);
  const row = get('SELECT password_hash FROM users WHERE id=?', u.id);
  if (!(await verifyPassword(String(ctx.body.current || ''), row.password_hash))) throw new HttpError(403, 'Current password is incorrect');
  run('UPDATE users SET password_hash=? WHERE id=?', await hashPassword(password(ctx.body.password)), u.id);
  run('DELETE FROM sessions WHERE user_id=? AND id<>?', u.id, u.sessionId);
  notify(u.id, 'security', 'Your password was changed', 'Other devices were signed out.', '/settings');
  return { ok: true };
});

route('GET', '/api/auth/sessions', ctx => {
  const u = need(ctx);
  return all('SELECT id,created_at,ip,ua FROM sessions WHERE user_id=? ORDER BY created_at DESC', u.id)
    .map(s => ({ current: s.id === u.sessionId, created_at: s.created_at, ip: s.ip, ua: s.ua }));
});
route('POST', '/api/auth/sessions/revoke-others', ctx => {
  const u = need(ctx);
  const r = run('DELETE FROM sessions WHERE user_id=? AND id<>?', u.id, u.sessionId);
  return { revoked: Number(r.changes) };
});

// Development mailbox: without SMTP, messages are stored locally and can be read here.
route('GET', '/api/dev/mailbox', ctx => {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ctx.req.socket.remoteAddress);
  if (!devMailbox || !local) throw new HttpError(404, 'Not found');
  return all('SELECT id,to_email,subject,body,link,created_at FROM outbox ORDER BY id DESC LIMIT 50');
});

route('PATCH', '/api/prefs', ctx => {
  const u = need(ctx);
  const b = ctx.body;
  const cur = get('SELECT * FROM user_prefs WHERE user_id=?', u.id);
  const next = {
    theme: ['system', 'light', 'dark'].includes(b.theme) ? b.theme : cur.theme,
    interests: Array.isArray(b.interests) ? JSON.stringify(b.interests.filter(x => typeof x === 'string').slice(0, 30)) : cur.interests,
    history_paused: typeof b.history_paused === 'boolean' ? (b.history_paused ? 1 : 0) : cur.history_paused,
    notif: b.notif && typeof b.notif === 'object' ? JSON.stringify(cleanFlags(b.notif)) : cur.notif,
    privacy: b.privacy && typeof b.privacy === 'object' ? JSON.stringify(cleanFlags(b.privacy)) : cur.privacy,
    onboarded: typeof b.onboarded === 'boolean' ? (b.onboarded ? 1 : 0) : cur.onboarded,
  };
  run('UPDATE user_prefs SET theme=?, interests=?, history_paused=?, notif=?, privacy=?, onboarded=? WHERE user_id=?',
    next.theme, next.interests, next.history_paused, next.notif, next.privacy, next.onboarded, u.id);
  return meOf(u).prefs;
});
function cleanFlags(o) {
  const out = {};
  for (const [k, v] of Object.entries(o).slice(0, 40)) if (/^[a-z_]{1,30}$/.test(k) && typeof v === 'boolean') out[k] = v;
  return out;
}

/* ---------- channel creation ---------- */
function validHandle(h, exceptChannelId = 0) {
  h = str(h, 'Handle', { min: 3, max: 30 }).replace(/^@/, '');
  if (!HANDLE_RX.test(h)) throw bad('Handles may only contain letters, numbers, dots, dashes and underscores (3-30 characters)');
  if (RESERVED.includes(h.toLowerCase())) throw bad('That handle is reserved');
  const taken = get('SELECT id FROM channels WHERE handle=?', h);
  if (taken && taken.id !== exceptChannelId) throw new HttpError(409, 'That handle is already taken');
  return h;
}
route('GET', '/api/handles/check', ctx => {
  try { validHandle(ctx.query.handle, intOf(ctx.query.except, 0)); return { available: true }; }
  catch (e) { return { available: false, reason: e.message }; }
});
route('POST', '/api/channels', ctx => {
  const u = need(ctx);
  limit(ctx, 'mkchannel', 5, 3600000);
  if (channelOfUser(u.id)) throw new HttpError(409, 'You already have a channel');
  const name = str(ctx.body.name, 'Channel name', { min: 2, max: 50 });
  const handle = validHandle(ctx.body.handle);
  tx(() => {
    const r = run('INSERT INTO channels(user_id,handle,name,created_at) VALUES(?,?,?,?)', u.id, handle, name, now());
    run('INSERT INTO monetization(channel_id) VALUES(?)', r.lastInsertRowid);
    if (u.role === 'user') run("UPDATE users SET role='creator' WHERE id=?", u.id);
  });
  return meOf(get('SELECT * FROM users WHERE id=?', u.id));
});

/* ---------- data export + account deletion ---------- */
route('GET', '/api/account/export', ctx => {
  const u = need(ctx);
  limit(ctx, 'export', 5, 3600000);
  const ch = channelOfUser(u.id);
  return {
    exported_at: new Date().toISOString(),
    account: { email: u.email, role: u.role, created_at: u.created_at },
    preferences: meOf(u).prefs,
    channel: ch || null,
    videos: ch ? all('SELECT * FROM videos WHERE channel_id=?', ch.id).map(v => ({
      ...v, publications: all('SELECT * FROM publications WHERE video_id=?', v.id),
    })) : [],
    comments: all('SELECT id,video_id,platform,body,created_at FROM comments WHERE user_id=?', u.id),
    playlists: all('SELECT * FROM playlists WHERE user_id=?', u.id).map(p => ({
      ...p, items: all('SELECT video_id,platform,position FROM playlist_items WHERE playlist_id=? ORDER BY position', p.id),
    })),
    subscriptions: all('SELECT channel_id,notify,created_at FROM subscriptions WHERE user_id=?', u.id),
    watch_history: all('SELECT video_id,platform,watched_at FROM watch_history WHERE user_id=?', u.id),
    search_history: all('SELECT query,scope,created_at FROM search_history WHERE user_id=?', u.id),
    reactions: all('SELECT video_id,platform,value FROM reactions WHERE user_id=?', u.id),
  };
});

function deleteUserData(userId) {
  const ch = channelOfUser(userId);
  const assets = all('SELECT id FROM media_assets WHERE owner_id=?', userId).map(a => a.id);
  const files = all('SELECT name FROM files WHERE user_id=?', userId).map(f => f.name);
  tx(() => {
    if (ch) run('DELETE FROM videos WHERE channel_id=?', ch.id);
    run('DELETE FROM videos WHERE asset_id IN (SELECT id FROM media_assets WHERE owner_id=?)', userId);
    run('DELETE FROM media_assets WHERE owner_id=?', userId);
    run('DELETE FROM users WHERE id=?', userId);
  });
  for (const id of assets) fs.rm(path.join(media.MEDIA_DIR, id), { recursive: true, force: true }, () => {});
  for (const f of files) fs.rm(path.join(media.FILES_DIR, f), { force: true }, () => {});
}
route('POST', '/api/account/delete', async ctx => {
  const u = need(ctx);
  limit(ctx, 'delacct', 5, 3600000);
  const row = get('SELECT password_hash FROM users WHERE id=?', u.id);
  if (!(await verifyPassword(String(ctx.body.password || ''), row.password_hash))) throw new HttpError(403, 'Password is incorrect');
  if (u.role === 'admin' && get("SELECT COUNT(*) AS n FROM users WHERE role='admin'").n <= 1)
    throw bad('You are the only administrator. Promote another administrator before deleting this account.');
  deleteUserData(u.id);
  audit(u.id, 'account.delete', 'user', u.id);
  ctx.setCookie(cookieOf(COOKIE, '', 0));
  return { ok: true };
});

module.exports = { loadSession, validHandle, deleteUserData, meOf };
