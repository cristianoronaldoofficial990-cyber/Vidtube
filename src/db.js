'use strict';
// Database bootstrap + migrations (SQLite via Node's built-in node:sqlite).
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
for (const d of ['', 'media', 'files', 'tmp']) fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'vidtube.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');

// Each entry runs exactly once, in order. Never edit an applied migration; append a new one.
const MIGRATIONS = [
  /* 1: core schema */ `
  CREATE TABLE users(
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','creator','moderator','admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
    email_verified INTEGER NOT NULL DEFAULT 0,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL);
  CREATE TABLE sessions(
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT, ua TEXT);
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE TABLE email_tokens(
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('verify','reset')),
    expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE outbox(
    id INTEGER PRIMARY KEY, to_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
    link TEXT, created_at INTEGER NOT NULL);
  CREATE TABLE user_prefs(
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'system',
    interests TEXT NOT NULL DEFAULT '[]',
    history_paused INTEGER NOT NULL DEFAULT 0,
    notif TEXT NOT NULL DEFAULT '{}',
    privacy TEXT NOT NULL DEFAULT '{}',
    onboarded INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE channels(
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    avatar TEXT, banner TEXT, country TEXT,
    links TEXT NOT NULL DEFAULT '[]',
    featured_video_id TEXT, trailer_video_id TEXT,
    sections TEXT NOT NULL DEFAULT '["featured","recent","popular","shorts","playlists"]',
    watermark TEXT,
    geo_separate INTEGER NOT NULL DEFAULT 0,
    geo_name TEXT, geo_description TEXT, geo_avatar TEXT, geo_banner TEXT,
    is_verified INTEGER NOT NULL DEFAULT 0,
    suspended INTEGER NOT NULL DEFAULT 0,
    demo_subs INTEGER NOT NULL DEFAULT 0,
    is_demo INTEGER NOT NULL DEFAULT 0,
    moderation TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL);
  CREATE TABLE channel_managers(
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, PRIMARY KEY(channel_id, user_id));
  CREATE TABLE media_assets(
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name TEXT, ext TEXT, size INTEGER NOT NULL DEFAULT 0,
    duration REAL NOT NULL DEFAULT 0, width INTEGER, height INTEGER,
    qualities TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK(status IN ('uploading','processing','ready','failed')),
    error TEXT, is_demo INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE TABLE upload_jobs(
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id TEXT, status TEXT NOT NULL, bytes_received INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER,
    error TEXT, created_at INTEGER NOT NULL, finished_at INTEGER);
  CREATE TABLE processing_jobs(
    id INTEGER PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('queued','running','done','failed')),
    error TEXT, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER);
  CREATE TABLE categories(
    id INTEGER PRIMARY KEY, platform TEXT NOT NULL CHECK(platform IN ('vidtube','geotube')),
    slug TEXT NOT NULL, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(platform, slug));
  CREATE TABLE videos(
    id TEXT PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES media_assets(id),
    thumb TEXT, captions TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    is_short INTEGER NOT NULL DEFAULT 0,
    made_for_kids INTEGER NOT NULL DEFAULT 0,
    allow_comments INTEGER NOT NULL DEFAULT 1,
    allow_download INTEGER NOT NULL DEFAULT 0,
    sponsored INTEGER NOT NULL DEFAULT 0,
    monetized INTEGER NOT NULL DEFAULT 0,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL);
  CREATE INDEX idx_videos_channel ON videos(channel_id);
  -- One media asset / video can be published separately on each platform.
  CREATE TABLE publications(
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK(platform IN ('vidtube','geotube')),
    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    category TEXT,
    visibility TEXT NOT NULL DEFAULT 'draft' CHECK(visibility IN ('public','unlisted','private','draft','scheduled')),
    status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','pending','rejected','restricted','removed')),
    publish_at INTEGER, published_at INTEGER,
    review_note TEXT, check_json TEXT,
    human_reviewed INTEGER NOT NULL DEFAULT 0,
    notified INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, dislikes INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(video_id, platform));
  CREATE INDEX idx_pub_listing ON publications(platform, visibility, status, published_at);
  CREATE INDEX idx_pub_category ON publications(platform, category);
  CREATE TABLE subscriptions(
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    notify TEXT NOT NULL DEFAULT 'personalized' CHECK(notify IN ('all','personalized','none')),
    created_at INTEGER NOT NULL, PRIMARY KEY(user_id, channel_id));
  CREATE INDEX idx_subs_channel ON subscriptions(channel_id);
  CREATE TABLE reactions(
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    platform TEXT NOT NULL, value INTEGER NOT NULL CHECK(value IN (1,-1)), created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, video_id, platform));
  CREATE TABLE comments(
    id INTEGER PRIMARY KEY,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','held','removed','hidden')),
    pinned INTEGER NOT NULL DEFAULT 0, hearted INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0,
    edited_at INTEGER, created_at INTEGER NOT NULL);
  CREATE INDEX idx_comments_video ON comments(video_id, platform, parent_id);
  CREATE TABLE comment_likes(
    comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(comment_id, user_id));
  CREATE TABLE hidden_users(
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL,
    PRIMARY KEY(channel_id, user_id));
  CREATE TABLE playlists(
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('public','unlisted','private')),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE playlist_items(
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    platform TEXT NOT NULL DEFAULT 'vidtube',
    position INTEGER NOT NULL, added_at INTEGER NOT NULL,
    PRIMARY KEY(playlist_id, video_id, platform));
  CREATE TABLE watch_history(
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    platform TEXT NOT NULL, position REAL NOT NULL DEFAULT 0, pct REAL NOT NULL DEFAULT 0,
    watched_at INTEGER NOT NULL, UNIQUE(user_id, video_id, platform));
  CREATE TABLE video_views(
    id INTEGER PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    platform TEXT NOT NULL, viewer_key TEXT NOT NULL, user_id INTEGER,
    max_decile INTEGER NOT NULL DEFAULT -1, created_at INTEGER NOT NULL);
  CREATE INDEX idx_views_lookup ON video_views(video_id, platform, viewer_key, created_at);
  -- Every analytics number in Studio is aggregated from this table. Rows hold a count in value
  -- (real events are value=1; seeded demo rows are daily aggregates flagged is_demo=1).
  CREATE TABLE analytics_events(
    id INTEGER PRIMARY KEY, channel_id INTEGER NOT NULL, video_id TEXT, platform TEXT NOT NULL,
    type TEXT NOT NULL, value REAL NOT NULL DEFAULT 1, user_id INTEGER,
    device TEXT, country TEXT, source TEXT, meta TEXT,
    day TEXT NOT NULL, created_at INTEGER NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX idx_ev_channel ON analytics_events(channel_id, day, type);
  CREATE INDEX idx_ev_video ON analytics_events(video_id, platform, type, day);
  CREATE TABLE notifications(
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', link TEXT,
    read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE INDEX idx_notif_user ON notifications(user_id, read, created_at);
  CREATE TABLE reports(
    id INTEGER PRIMARY KEY, reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('video','comment','channel')),
    target_id TEXT NOT NULL, platform TEXT, reason TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
    resolution TEXT, resolved_by INTEGER, created_at INTEGER NOT NULL, resolved_at INTEGER);
  CREATE TABLE moderation_decisions(
    id INTEGER PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL, platform TEXT,
    moderator_id INTEGER, action TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
  CREATE TABLE appeals(
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE, platform TEXT NOT NULL,
    text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','granted','denied')),
    response TEXT, resolved_by INTEGER, created_at INTEGER NOT NULL, resolved_at INTEGER);
  CREATE TABLE audit_logs(
    id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, target_type TEXT, target_id TEXT,
    details TEXT, created_at INTEGER NOT NULL);
  CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE announcements(
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER, created_at INTEGER NOT NULL);
  CREATE TABLE search_history(
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query TEXT NOT NULL, scope TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE not_interested(
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE, PRIMARY KEY(user_id, video_id));
  CREATE TABLE copyright_claims(
    id INTEGER PRIMARY KEY, claimant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    work TEXT NOT NULL, details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','upheld','rejected')),
    response TEXT, resolved_by INTEGER, created_at INTEGER NOT NULL, resolved_at INTEGER);
  CREATE TABLE community_posts(
    id INTEGER PRIMARY KEY, channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    body TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE monetization(
    channel_id INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'not_applied' CHECK(status IN ('not_applied','applied','approved','rejected')),
    applied_at INTEGER, payment TEXT NOT NULL DEFAULT '{}');
  CREATE TABLE files(
    name TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE audio_tracks(
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, mood TEXT NOT NULL, duration REAL NOT NULL, file TEXT NOT NULL);
  `,
  /* 2: email sign-in codes + trusted devices */ `
  CREATE TABLE auth_codes(
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK(purpose IN ('login','verify')),
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    trust INTEGER NOT NULL DEFAULT 0,
    ip TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE trusted_devices(
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ua TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  `,
  /* 3: pictures and GIFs in comments and community posts */ `
  ALTER TABLE comments ADD COLUMN attachment TEXT;
  ALTER TABLE community_posts ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
  `,
  /* 4: Halloween event - GIFs people make themselves (usable only by their own account) */ `
  CREATE TABLE user_gifs(
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '', file TEXT NOT NULL, video_id TEXT,
    start REAL NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE INDEX idx_user_gifs_user ON user_gifs(user_id, created_at);
  `,
  /* 5: special badges (owner / moderator) shown next to a name */ `
  CREATE TABLE user_badges(
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, badge));
  `,
  /* 6: how often each house ad was shown / clicked */ `
  CREATE TABLE ad_stats(ad_id TEXT PRIMARY KEY, impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0);
  `,
  /* 7: YouTube auto-import (src/youtube.js): followed channels + every video seen in their feeds */ `
  CREATE TABLE youtube_channels(
    handle TEXT PRIMARY KEY COLLATE NOCASE,
    channel_id TEXT, title TEXT,
    target TEXT NOT NULL DEFAULT 'auto',
    target_channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    added_at INTEGER NOT NULL, last_checked_at INTEGER, last_error TEXT);
  CREATE TABLE youtube_imports(
    yt_id TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '', published_at INTEGER,
    status TEXT NOT NULL CHECK(status IN ('seen','queued','downloading','done','failed')),
    video_id TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE INDEX idx_yt_imports_handle ON youtube_imports(handle, status);
  `,
];

db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
MIGRATIONS.forEach((sql, i) => {
  const version = i + 1;
  if (applied.has(version)) return;
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)').run(version, Date.now());
    db.exec('COMMIT');
    console.log(`[db] applied migration ${version}`);
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});

module.exports = { db, DATA_DIR };
