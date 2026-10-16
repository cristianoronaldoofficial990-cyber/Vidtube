'use strict';
// First-run data: categories, the administrator account and the generated audio library.
const path = require('path');
const { get, run, tx, now, rid, hashPassword } = require('./core');
const media = require('./media');
const config = require('./config');

const CATEGORIES = {
  vidtube: ['Gaming', 'Music', 'Education', 'Entertainment', 'Technology', 'Sports', 'News', 'Vlogs', 'Comedy', 'Film & Animation', 'How-to & Style', 'Science', 'Travel', 'Food', 'Animals'],
  geotube: [['mapping', 'Mapping'], ['mapping-alternate-history', 'Alternate history mapping'], ['mapping-future', 'Future mapping'], ['mapping-tutorials', 'Mapping tutorials'],
    ['mapping-timelapse', 'Timelapses'], ['countryballs', 'Countryballs'], ['countryballs-comics', 'Countryball comics'], ['countryballs-animations', 'Countryball animations'],
    ['geography', 'Geography'], ['history', 'History'], ['flags', 'Flags & symbols']],
};
const slugOf = s => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function seedCategories() {
  if (get('SELECT 1 AS x FROM categories LIMIT 1')) return;
  tx(() => {
    CATEGORIES.vidtube.forEach((n, i) => run('INSERT INTO categories(platform,slug,name,sort) VALUES(?,?,?,?)', 'vidtube', slugOf(n), n, i));
    CATEGORIES.geotube.forEach(([s, n], i) => run('INSERT INTO categories(platform,slug,name,sort) VALUES(?,?,?,?)', 'geotube', s, n, i));
  });
  console.log('[seed] categories created');
}

async function seedAdmin() {
  if (get("SELECT 1 AS x FROM users WHERE role='admin' LIMIT 1")) return;
  const email = (process.env.ADMIN_EMAIL || config.adminEmail || 'admin@vidtube.local').toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || config.adminPassword || 'admin12345';
  const hash = await hashPassword(pw);
  tx(() => {
    const r = run("INSERT INTO users(email,password_hash,role,email_verified,created_at) VALUES(?,?,'admin',1,?)", email, hash, now());
    run('INSERT INTO user_prefs(user_id,onboarded) VALUES(?,1)', r.lastInsertRowid);
  });
  console.log(`[seed] administrator created: ${email} / ${pw}  (change this in Settings)`);
}

/* ---------- audio library ---------- */
const TRACKS = [
  ['Sunrise Pad', 'calm', 'sine=frequency=261.63:beep_factor=2', 30], ['Night Drive', 'chill', 'sine=frequency=196:beep_factor=4', 30],
  ['Pixel Run', 'upbeat', 'sine=frequency=329.63:beep_factor=8', 30], ['Deep Focus', 'ambient', 'anoisesrc=color=brown:amplitude=0.2', 30],
  ['Victory Theme', 'epic', 'sine=frequency=392:beep_factor=3', 30], ['Rainy Window', 'ambient', 'anoisesrc=color=pink:amplitude=0.15', 30],
];
async function seedAudio() {
  if (get('SELECT 1 AS x FROM audio_tracks LIMIT 1') || !media.hasFfmpeg) return;
  for (const [title, mood, src, dur] of TRACKS) {
    const file = `a_${rid(8)}.mp3`;
    const r = await media.runFf(media.FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `${src}:sample_rate=44100`, '-t', String(dur), '-af', 'volume=0.3,afade=t=in:d=1,afade=t=out:st=28:d=2', '-c:a', 'libmp3lame', '-b:a', '96k', path.join(media.FILES_DIR, file)]);
    if (r.code === 0) run('INSERT INTO audio_tracks(title,mood,duration,file) VALUES(?,?,?,?)', title, mood, dur, file);
  }
  console.log('[seed] audio library generated');
}

async function ensure() {
  seedCategories();
  await seedAdmin();
  seedAudio().catch(e => console.error('[seed] audio failed:', e.message));
}
module.exports = { ensure };
