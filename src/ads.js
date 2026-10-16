'use strict';
// House ads for befriended YouTube channels. One banner ad per page, rotating: the browser sends the
// id of the ad it showed last and gets a different one back (so a refresh or going from a video to
// the home page shows another channel). On the watch page (never in Shorts) there is sometimes a
// pre-roll: an overlay with one channel for 5-10 seconds before the video starts.
const { route, get, run, now, getSetting, intOf, HttpError, audit, needRole, DEFAULT_SETTINGS } = require('./core');

// The channel list lives in DEFAULT_SETTINGS.ads (so newly added channels always show up); the
// admin only stores which ones are switched off.
function allAds() {
  const stored = getSetting('ads').channels || [];
  return DEFAULT_SETTINGS.ads.channels.map(c => { const s = stored.find(x => x.id === c.id); return { ...c, enabled: s ? s.enabled !== false : c.enabled !== false }; });
}
function activeAds() { return allAds().filter(c => c.enabled !== false); }

function pick(list, excludeIds) {
  const pool = list.filter(a => !excludeIds.includes(a.id));
  const from = pool.length ? pool : list;
  return from.length ? from[Math.floor(Math.random() * from.length)] : null;
}

const adOut = a => a && ({ id: a.id, platform: a.platform || 'YouTube', name: a.name, handle: a.handle, url: a.url, avatar: a.avatar, tagline: a.tagline || '', subscribers: a.subscribers || '' });

function bump(id, col) {
  run(`INSERT INTO ad_stats(ad_id,impressions,clicks) VALUES(?,?,?) ON CONFLICT(ad_id) DO UPDATE SET ${col}=${col}+1`, id, col === 'impressions' ? 1 : 0, col === 'clicks' ? 1 : 0);
}

/** GET /api/ads?place=feed|watch&exclude=<last banner id> */
route('GET', '/api/ads', ctx => {
  const cfg = getSetting('ads');
  const list = activeAds();
  if (!cfg.enabled || !list.length) return { banner: null, preroll: null, seconds: 0 };
  const exclude = String(ctx.query.exclude || '');
  const banner = pick(list, [exclude]);
  let preroll = null, seconds = 0;
  if (ctx.query.place === 'watch' && cfg.preroll && Math.random() * 100 < cfg.prerollChance) {
    preroll = pick(list, [banner ? banner.id : '']);
    const lo = Math.min(cfg.prerollMin, cfg.prerollMax), hi = Math.max(cfg.prerollMin, cfg.prerollMax);
    seconds = lo + Math.floor(Math.random() * (hi - lo + 1));
  }
  if (banner) bump(banner.id, 'impressions');
  if (preroll) bump(preroll.id, 'impressions');
  return { banner: adOut(banner), preroll: adOut(preroll), seconds };
});

route('POST', '/api/ads/:id/click', ctx => {
  const a = activeAds().find(x => x.id === ctx.params.id);
  if (!a) throw new HttpError(404, 'Unknown ad');
  bump(a.id, 'clicks');
  return { ok: true };
});

/** Admin: settings + stats in one call. */
route('GET', '/api/admin/ads', ctx => {
  needRole(ctx, 'admin');
  const cfg = getSetting('ads');
  return { ...cfg, channels: allAds().map(c => ({ ...c, ...(get('SELECT impressions, clicks FROM ad_stats WHERE ad_id=?', c.id) || { impressions: 0, clicks: 0 }) })) };
});

module.exports = { activeAds };
