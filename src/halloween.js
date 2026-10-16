'use strict';
// Halloween event. While it runs (October, or always when the admin says so) the logo turns into
// a pumpkin and every signed-in viewer who starts `goal` videos or Shorts unlocks the GIF maker:
// a short piece of any video is turned into a GIF with FFmpeg. Those GIFs live under "My GIFs"
// in the GIF picker of comments and posts and can only be used by the account that made them.
const fs = require('fs');
const path = require('path');
const { route, HttpError, bad, str, intOf, need, limit, get, all, run, now, rid, notify, audit, getSetting, platformOf, json } = require('./core');
const media = require('./media');
const { loadPublication } = require('./routes-videos');
const safety = require('./safety');

const MAX_GIFS = 30;       // per account
const MAX_LEN = 6;         // seconds
const GIF_WIDTH = 320;

/** Settings + whether the event is running right now. */
function status() {
  const cfg = getSetting('halloween');
  const d = new Date();
  const year = d.getFullYear();
  const start = new Date(year, 9, 1).getTime();           // 1 October, local time
  const end = new Date(year, 10, 2).getTime();            // ends after 1 November
  const inWindow = Date.now() >= start && Date.now() < end;
  return { enabled: !!cfg.enabled, active: !!cfg.enabled && (cfg.alwaysOn || inWindow), goal: cfg.goal, start: cfg.alwaysOn ? new Date(year, 0, 1).getTime() : start };
}

/** How many videos/Shorts this user started since the event began. */
function watched(userId, st) {
  return get('SELECT COUNT(*) AS n FROM video_views WHERE user_id=? AND created_at>=?', userId, st.start).n;
}

function gifOut(g) { return { id: g.id, title: g.title, url: '/files/' + g.file, preview: '/files/' + g.file, kind: 'gif', source: 'mygif', video_id: g.video_id, created_at: g.created_at }; }

function myGifs(userId) { return all('SELECT * FROM user_gifs WHERE user_id=? ORDER BY created_at DESC', userId).map(gifOut); }

function progress(userId) {
  const st = status();
  if (!userId) return { active: st.active, goal: st.goal, watched: 0, unlocked: false, gifs: [] };
  const n = watched(userId, st);
  return { active: st.active, goal: st.goal, watched: n, unlocked: st.active && n >= st.goal, gifs: myGifs(userId) };
}

/** Called after a view was counted: tells the viewer once when the GIF maker unlocks. */
function onView(userId) {
  if (!userId) return;
  const st = status();
  if (!st.active) return;
  if (watched(userId, st) !== st.goal) return;
  notify(userId, 'event', 'Halloween: your GIF maker is unlocked!', `You watched ${st.goal} videos. Press the GIF button under a comment and open "My GIFs" to make your own GIFs from any video.`, '/');
}

route('GET', '/api/event/halloween', ctx => progress(ctx.user ? ctx.user.id : null));

route('POST', '/api/event/halloween/gifs', async ctx => {
  const u = need(ctx);
  limit(ctx, 'gifmake', 20, 600000);
  const p = progress(u.id);
  if (!p.active) throw new HttpError(403, 'The Halloween event is not running');
  if (!p.unlocked) throw new HttpError(403, `Watch ${p.goal} videos or Shorts first (${p.watched}/${p.goal})`);
  if (!media.hasFfmpeg) throw new HttpError(503, 'FFmpeg is not installed on this server, so GIFs cannot be made');
  if (get('SELECT COUNT(*) AS n FROM user_gifs WHERE user_id=?', u.id).n >= MAX_GIFS) throw bad(`You can keep at most ${MAX_GIFS} GIFs. Delete one first.`);
  const platform = platformOf(ctx.body.platform);
  const { pub } = loadPublication(ctx, str(ctx.body.video_id, 'Video', { min: 1, max: 40 }), platform);
  const asset = get('SELECT * FROM media_assets WHERE id=?', pub.asset_id);
  const q = asset && json(asset.qualities, [])[0];
  if (!asset || asset.status !== 'ready' || !q) throw bad('This video is not ready yet');
  const duration = Number(asset.duration) || 0;
  const start = Math.max(0, Math.min(Number(ctx.body.start) || 0, Math.max(0, duration - 0.5)));
  const len = Math.max(1, Math.min(MAX_LEN, Number(ctx.body.duration) || 3, duration ? duration - start : MAX_LEN));
  const title = str(ctx.body.title, 'Title', { max: 80 }) || pub.title.slice(0, 80);
  if (safety.scanVideo({ title, description: '', tags: [] }).hits.length) throw bad('That title is not allowed');

  const src = path.join(media.MEDIA_DIR, asset.id, q.file);
  const name = `g_${rid(12)}.gif`;
  const out = path.join(media.FILES_DIR, name);
  const filter = `fps=12,scale=${GIF_WIDTH}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
  const r = await media.runFf(media.FFMPEG, ['-y', '-v', 'error', '-ss', start.toFixed(2), '-t', len.toFixed(2), '-i', src, '-an', '-vf', filter, '-loop', '0', out], { signal: AbortSignal.timeout(90000) });
  let size = 0; try { size = fs.statSync(out).size; } catch {}
  if (r.code !== 0 || !size) { fs.rm(out, { force: true }, () => {}); throw new HttpError(500, 'The GIF could not be made' + (r.err ? ': ' + r.err.split('\n').filter(Boolean).pop() : '')); }
  const t = now();
  run('INSERT INTO files(name,user_id,kind,created_at) VALUES(?,?,?,?)', name, u.id, 'halloween', t);
  const id = rid(9);
  run('INSERT INTO user_gifs(id,user_id,title,file,video_id,start,duration,created_at) VALUES(?,?,?,?,?,?,?,?)', id, u.id, title, name, pub.video_id, start, len, t);
  audit(u.id, 'event.gif_create', 'user_gif', id, { video_id: pub.video_id, start, len, size });
  return gifOut(get('SELECT * FROM user_gifs WHERE id=?', id));
});

route('DELETE', '/api/event/halloween/gifs/:id', ctx => {
  const u = need(ctx);
  const g = get('SELECT * FROM user_gifs WHERE id=? AND user_id=?', ctx.params.id, u.id);
  if (!g) throw new HttpError(404, 'GIF not found');
  run('DELETE FROM user_gifs WHERE id=?', g.id);
  media.deleteFile(g.file);
  return { ok: true };
});

/** The stored form of a "my GIF" attachment; only the account that made the GIF may use it. */
function attachment(input, userId) {
  const g = get('SELECT * FROM user_gifs WHERE id=?', String(input.id || ''));
  if (!g) throw bad('Unknown GIF');
  if (g.user_id !== userId) throw bad('This GIF can only be used by the account that made it');
  return { kind: 'gif', source: 'mygif', file: g.file, title: g.title };
}

module.exports = { status, progress, onView, attachment };
