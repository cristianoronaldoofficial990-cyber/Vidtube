'use strict';
// Sexual-content detector. Scans the text a creator attaches to a video (title, description,
// tags) and to a channel (name, description) for sexual terms. A single hit is enough to hold
// the video for review: it stays invisible to viewers until a moderator or administrator has
// looked at it. The detector only reads metadata, never the video frames, so it can miss things
// and it can be wrong; that is why it never rejects anything by itself and why moderators can
// always overrule it.
const { get, all, run, json, now, notify, audit, getSetting } = require('./core');

const FLAG_CODE = 'sexual_content';

const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalize = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

// Finds configured terms as whole words (with a simple plural). Besides the plain text a copy is
// checked in which punctuation between letters is removed, so "s.e.x" and "p-o-r-n" are caught too.
function findTerms(text, terms) {
  const plain = normalize(text);
  const unmasked = plain.replace(/(?<=[a-z0-9])[.\-_*]+(?=[a-z0-9])/g, '');
  const found = new Set();
  for (const raw of terms) {
    const term = normalize(raw).trim();
    if (!term) continue;
    const rx = new RegExp(`(^|[^a-z0-9])${escapeRx(term)}(s|es|en|e)?([^a-z0-9]|$)`, 'i');
    if (rx.test(plain) || rx.test(unmasked)) found.add(term);
  }
  return [...found];
}

/** Scans one video's metadata. Returns { hits, fields } where fields says where each term was found. */
function scanVideo({ title, description, tags = [] }) {
  const cfg = getSetting('safety');
  if (!cfg.enabled) return { hits: [], fields: {}, enabled: false, checked_at: now() };
  const fields = {};
  for (const [name, text] of [['title', title], ['description', description], ['tags', (tags || []).join(' ')]]) {
    const h = findTerms(text, cfg.terms);
    if (h.length) fields[name] = h;
  }
  const hits = [...new Set(Object.values(fields).flat())];
  return { hits, fields, enabled: true, checked_at: now() };
}

/** Scans a channel's own texts (name and descriptions). */
function scanChannel(ch) {
  const cfg = getSetting('safety');
  if (!cfg.enabled) return [];
  return findTerms(`${ch.name}\n${ch.description}\n${ch.geo_name || ''}\n${ch.geo_description || ''}`, cfg.terms);
}

const sameHits = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

/**
 * Merges the scan into a publication's check and decides whether it must be held.
 * `check` is the existing check object (GeoTube flags etc.) or null; `prev` is the stored
 * publication row (or null for a new one). Returns { check, hold }.
 *
 * A video that a moderator already approved with exactly these hits is not held again;
 * any new or different hit sends it back to the queue.
 */
function applyScan(check, scan, prev, video) {
  const out = { ...(check || { flags: [] }) };
  out.flags = (out.flags || []).filter(f => f.code !== FLAG_CODE && f.code !== FLAG_CODE + '_kids');
  out.safety = scan;
  if (!scan.hits.length) return { check: out, hold: false };
  out.flags.push({ code: FLAG_CODE, message: `Possible sexual content. Matched: ${scan.hits.join(', ')}. A moderator or administrator must check this video.` });
  if (video && video.made_for_kids) out.flags.push({ code: FLAG_CODE + '_kids', message: 'The video is marked "made for kids" while sexual terms were found.' });
  const prevScan = prev ? (json(prev.check_json, {}) || {}).safety : null;
  const clearedBefore = prev && prev.human_reviewed && prev.status === 'approved' && prevScan && sameHits(prevScan.hits, scan.hits);
  return { check: out, hold: !clearedBefore };
}

function notifyHold(video, pub, channelUserId) {
  const where = pub.platform === 'geotube' ? 'GeoTube' : 'VidTube';
  notify(channelUserId, 'moderation', 'Your video is being checked', `"${pub.title}" was held because it may contain sexual content. A moderator will review it before it appears on ${where}. You will be notified.`, `/studio/video/${video.id}`);
  for (const m of all("SELECT id FROM users WHERE role IN ('moderator','admin')")) notify(m.id, 'moderation', 'Possible sexual content to check', pub.title, '/admin/queue?filter=safety');
}

/**
 * Re-scans one stored publication (used after tag edits, setting changes and the full rescan).
 * Holds it when needed and returns true if it was newly held.
 */
function rescanPublication(videoId, platform) {
  const pub = get('SELECT * FROM publications WHERE video_id=? AND platform=?', videoId, platform);
  const video = pub && get('SELECT * FROM videos WHERE id=?', videoId);
  if (!pub || !video) return false;
  const scan = scanVideo({ title: pub.title, description: pub.description, tags: json(video.tags, []) });
  const { check, hold } = applyScan(json(pub.check_json, null), scan, pub, video);
  const mustHold = hold && pub.visibility !== 'draft' && !['pending', 'removed', 'rejected'].includes(pub.status);
  // Held only by the detector and now clean (e.g. the tag was removed): release it.
  const prevFlags = (json(pub.check_json, {}) || {}).flags || [];
  const release = !hold && pub.status === 'pending' && prevFlags.length > 0 && prevFlags.every(f => String(f.code).startsWith(FLAG_CODE));
  run('UPDATE publications SET check_json=?, status=?, published_at=COALESCE(published_at, ?), updated_at=? WHERE video_id=? AND platform=?',
    JSON.stringify(check), mustHold ? 'pending' : release ? 'approved' : pub.status, release && pub.visibility === 'public' ? now() : null,
    mustHold || release ? now() : pub.updated_at, videoId, platform);
  if (mustHold) {
    const ch = get('SELECT user_id FROM channels WHERE id=?', video.channel_id);
    if (ch) notifyHold(video, pub, ch.user_id);
    audit(null, 'safety.hold', 'video', videoId, { platform, hits: scan.hits });
  }
  return mustHold;
}

/** Scans every publication. Returns how many videos were newly held for review. */
function rescanAll() {
  let held = 0;
  for (const p of all("SELECT video_id, platform FROM publications WHERE status<>'removed'")) if (rescanPublication(p.video_id, p.platform)) held++;
  return held;
}

/**
 * A channel whose own name or description trips the detector gets an automatic report so it
 * shows up in the moderators' report queue (one open report per channel at a time).
 */
function reportChannel(ch, hits) {
  if (!hits.length) return false;
  if (get("SELECT 1 AS x FROM reports WHERE target_type='channel' AND target_id=? AND reason='sexual' AND reporter_id IS NULL AND status='open'", String(ch.id))) return false;
  run('INSERT INTO reports(reporter_id,target_type,target_id,platform,reason,details,status,created_at) VALUES(NULL,\'channel\',?,NULL,\'sexual\',?,\'open\',?)',
    String(ch.id), `Automatic detector: the channel name or description contains: ${hits.join(', ')}.`, now());
  for (const m of all("SELECT id FROM users WHERE role IN ('moderator','admin')")) notify(m.id, 'moderation', 'Channel flagged for possible sexual content', '@' + ch.handle, '/admin/reports');
  audit(null, 'safety.channel_report', 'channel', ch.id, { hits });
  return true;
}

/** Channels with at least one video the detector flagged and nobody has reviewed yet. */
const FLAGGED_CHANNEL_SQL = `(SELECT COUNT(*) FROM publications p JOIN videos v ON v.id=p.video_id
  WHERE v.channel_id=c.id AND p.check_json LIKE '%"${FLAG_CODE}"%' AND (p.status='pending' OR p.human_reviewed=0))`;

module.exports = { FLAG_CODE, scanVideo, scanChannel, applyScan, rescanPublication, rescanAll, reportChannel, notifyHold, FLAGGED_CHANNEL_SQL };
