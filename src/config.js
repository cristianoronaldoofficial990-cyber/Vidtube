'use strict';
// Server configuration: config.json in the project root (see config.example.json), overridable
// through environment variables. Nothing here is required; without SMTP settings, emails are
// only stored locally and sign-in codes are printed to the server console.
const fs = require('fs');
const path = require('path');

let file = {};
try { file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')); } catch { /* no config.json yet */ }
const env = process.env;
const smtpFile = file.smtp || {};

const config = {
  siteUrl: env.SITE_URL || file.siteUrl || '',
  adminEmail: file.adminEmail || '',
  adminPassword: file.adminPassword || '',
  // GIPHY API key for GIF search in comments and posts (free at developers.giphy.com). Empty = search off, uploads still work.
  giphyApiKey: env.GIPHY_API_KEY || file.giphyApiKey || '',
  // Extra origins allowed to embed the site in an iframe (e.g. "http://localhost:5180" for Pindows1).
  // FRAME_ANCESTORS is a comma-separated list; the file value is an array. Empty = same origin only.
  frameAncestors: (env.FRAME_ANCESTORS ? env.FRAME_ANCESTORS.split(',') : (Array.isArray(file.frameAncestors) ? file.frameAncestors : []))
    .map(s => String(s).trim()).filter(s => /^https?:\/\/[^\s'";]+$/.test(s)),
  smtp: {
    host: env.SMTP_HOST || smtpFile.host || '',
    port: parseInt(env.SMTP_PORT || smtpFile.port || 465, 10),
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === '1' : (smtpFile.secure !== undefined ? !!smtpFile.secure : true),
    user: env.SMTP_USER || smtpFile.user || '',
    pass: env.SMTP_PASS || smtpFile.pass || '',
    from: env.SMTP_FROM || smtpFile.from || '',
  },
};
config.smtp.enabled = !!(config.smtp.host && config.smtp.from);

module.exports = config;
