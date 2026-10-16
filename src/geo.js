'use strict';
// GeoTube eligibility: automated pre-checks that decide whether a submission can be
// published directly or must wait for a human moderator. These checks only look at
// metadata, so they never have the final word: moderators can overrule them and
// creators can appeal.
const { get, getSetting } = require('./core');

const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function hits(text, terms) {
  const found = [];
  for (const t of terms) {
    const term = String(t).trim().toLowerCase();
    if (!term) continue;
    if (new RegExp(`(^|[^a-z0-9])${escapeRx(term)}(s|es)?([^a-z0-9]|$)`, 'i').test(text)) found.push(term);
  }
  return found;
}

function checkEligibility({ title, description, tags = [], category, channelId }) {
  const cfg = getSetting('geotube');
  const flags = [];
  const text = `${title}\n${description}\n${tags.join(' ')}`.toLowerCase();
  const pos = hits(text, cfg.positive);
  const neg = hits(text, cfg.negative);
  const cat = get("SELECT 1 AS x FROM categories WHERE platform='geotube' AND slug=? AND active=1", category);
  if (!cat) flags.push({ code: 'invalid_category', message: 'The selected category is not a valid GeoTube category.' });
  if (pos.length === 0) flags.push({ code: 'no_niche_terms', message: 'Title, description and tags do not mention any mapping or Countryballs topic.' });
  if (neg.length > 0 && pos.length < neg.length * 2)
    flags.push({ code: 'unrelated_terms', message: `Contains terms that usually indicate unrelated content: ${neg.join(', ')}.` });
  if (String(description || '').trim().length < 30)
    flags.push({ code: 'thin_description', message: 'The description is too short to judge whether the video fits GeoTube.' });
  if (cfg.reviewFirstUpload && channelId &&
      !get(`SELECT 1 AS x FROM publications p JOIN videos v ON v.id=p.video_id
            WHERE v.channel_id=? AND p.platform='geotube' AND p.status='approved' AND p.human_reviewed=1 LIMIT 1`, channelId))
    flags.push({ code: 'first_upload', message: 'First GeoTube upload from this channel: reviewed by a moderator.' });
  return { flags, positive: pos, negative: neg, mode: cfg.mode, checked_at: Date.now() };
}

// 'approved' only when automated checks are clean, the configuration allows auto-publishing,
// and no human moderator has previously rejected or removed this submission.
function initialStatus(check, humanReviewed) {
  if (check.flags.some(f => f.code === 'invalid_category')) return 'pending';
  if (humanReviewed) return 'pending';
  if (check.mode === 'review_all') return 'pending';
  return check.flags.length ? 'pending' : 'approved';
}

const isCountryball = slug => /countryball/.test(slug || '');
// "Mapping" and "Countryballs" are umbrella chips covering their sub-categories.
function categoryFilter(platform, slug) {
  if (!slug || slug === 'all') return { sql: '', args: [] };
  if (platform === 'geotube' && slug === 'mapping') return { sql: " AND p.category NOT LIKE '%countryball%'", args: [] };
  if (platform === 'geotube' && slug === 'countryballs') return { sql: " AND p.category LIKE '%countryball%'", args: [] };
  return { sql: ' AND p.category=?', args: [slug] };
}

module.exports = { checkEligibility, initialStatus, isCountryball, categoryFilter };
