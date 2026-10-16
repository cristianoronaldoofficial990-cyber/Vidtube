'use strict';
// GIF search (GIPHY, proxied through the server so the API key stays private) and validation of
// the image / GIF attachments users add to comments and community posts.
const { route, HttpError, bad, str, intOf, need, limit, json } = require('./core');
const media = require('./media');
const config = require('./config');

const GIPHY = 'https://api.giphy.com/v1/gifs';
const GIPHY_URL = /^https:\/\/([a-z0-9-]+\.)*giphy\.com\/[^\s"'<>]+$/i;
const cache = new Map(); // query -> { at, items }
const CACHE_MS = 5 * 60000;

function giphyOut(g) {
  const pick = (...keys) => { for (const k of keys) if (g.images && g.images[k] && g.images[k].url) return g.images[k]; return null; };
  const full = pick('downsized_medium', 'downsized', 'original');
  const prev = pick('fixed_width_small', 'preview_gif', 'fixed_width');
  if (!full) return null;
  return { id: g.id, title: g.title || '', url: full.url, preview: prev ? prev.url : full.url, width: Number(full.width) || 0, height: Number(full.height) || 0 };
}

async function giphy(endpoint, params) {
  if (!config.giphyApiKey) throw new HttpError(503, 'GIF search is not set up on this server. Add "giphyApiKey" to config.json (free key at developers.giphy.com).');
  const key = endpoint + '?' + new URLSearchParams(params).toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
  const url = `${GIPHY}/${endpoint}?${new URLSearchParams({ api_key: config.giphyApiKey, rating: 'pg-13', ...params })}`;
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(8000) }); } catch { throw new HttpError(502, 'GIPHY could not be reached'); }
  if (res.status === 401 || res.status === 403) throw new HttpError(502, 'GIPHY rejected the API key configured on this server');
  if (res.status === 429) throw new HttpError(429, 'GIF search limit reached, try again in a minute');
  if (!res.ok) throw new HttpError(502, 'GIF search failed');
  const data = await res.json();
  const items = (data.data || []).map(giphyOut).filter(Boolean);
  cache.set(key, { at: Date.now(), items });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return items;
}

route('GET', '/api/gifs/status', () => ({ configured: !!config.giphyApiKey }));
route('GET', '/api/gifs/search', async ctx => {
  need(ctx);
  limit(ctx, 'gifsearch', 120, 600000);
  const q = str(ctx.query.q, 'Search', { max: 100 });
  const offset = intOf(ctx.query.offset, 0, 0, 4999);
  const items = q ? await giphy('search', { q, limit: 24, offset, lang: 'en' }) : await giphy('trending', { limit: 24, offset });
  return { items, offset: offset + items.length, powered_by: 'GIPHY' };
});

/**
 * Checks one attachment sent by the browser. Returns the stored form or throws.
 *   { kind: 'gif', source: 'giphy', url, preview, width, height }      a GIPHY GIF (https://*.giphy.com only)
 *   { kind: 'image'|'gif', source: 'upload', file }                   a file the same user uploaded via /api/uploads/image
 *   { kind: 'gif', source: 'mygif', file, title }                      a Halloween GIF the same user made (src/halloween.js)
 */
function parseAttachment(input, userId) {
  if (!input || typeof input !== 'object') return null;
  if (input.source === 'giphy') {
    const url = String(input.url || '');
    const preview = String(input.preview || url);
    if (!GIPHY_URL.test(url) || !GIPHY_URL.test(preview) || url.length > 500 || preview.length > 500) throw bad('Only GIFs from GIPHY can be attached by link');
    return { kind: 'gif', source: 'giphy', url, preview, width: intOf(input.width, 0, 0, 4000), height: intOf(input.height, 0, 0, 4000), title: str(input.title, 'Title', { max: 200 }) };
  }
  if (input.source === 'mygif') return require('./halloween').attachment(input, userId);
  if (input.source === 'upload') {
    const file = media.ownFile(userId, input.file, null);
    if (!file) throw bad('Unknown uploaded file');
    return { kind: file.endsWith('.gif') ? 'gif' : 'image', source: 'upload', file };
  }
  throw bad('Unknown attachment type');
}

/** Adds the URL the browser needs to a stored attachment. */
function attachmentOut(a) {
  if (!a) return null;
  if (a.source === 'upload' || a.source === 'mygif') return { ...a, url: '/files/' + a.file, preview: '/files/' + a.file };
  return a;
}

const attachmentFromRow = v => attachmentOut(typeof v === 'string' ? json(v, null) : v);
const attachmentsFromRow = v => (json(v, []) || []).map(attachmentOut);

// Any signed-in user can upload a picture or GIF for a comment or a post (5 MB, PNG/JPG/WebP/GIF).
route('POST', '/api/uploads/image', async ctx => {
  need(ctx);
  limit(ctx, 'img', 60, 3600000);
  const kind = ctx.query.kind === 'post' ? 'post' : 'comment';
  const name = await media.saveImage(ctx, kind);
  return { file: name, url: '/files/' + name, kind: name.endsWith('.gif') ? 'gif' : 'image' };
}, { raw: true });

module.exports = { parseAttachment, attachmentOut, attachmentFromRow, attachmentsFromRow };
