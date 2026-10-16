'use strict';
// Outgoing email. A minimal SMTP client (SMTPS on 465 or STARTTLS on 587/25, AUTH PLAIN/LOGIN)
// so no external packages are needed. Every message is also kept in the local outbox table.
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const config = require('./config');
const { run, now } = require('./core');

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const encHeader = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const addrOnly = s => { const m = /<([^>]+)>/.exec(s); return m ? m[1] : s.trim(); };

function smtpSend({ to, subject, text, html }) {
  const { host, port, secure, user, pass, from } = config.smtp;
  return new Promise((resolve, reject) => {
    let socket, buf = '', waiters = [], done = false;
    const fail = e => { if (done) return; done = true; try { socket.destroy(); } catch {} reject(e instanceof Error ? e : new Error(String(e))); };
    const timer = setTimeout(() => fail(new Error('SMTP timeout')), 30000);
    const attach = s => {
      socket = s;
      s.setEncoding('utf8');
      s.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (/^\d{3} /.test(line) || !/^\d{3}-/.test(line)) { const w = waiters.shift(); if (w) w(line); }
        }
      });
      s.on('error', fail);
      s.on('close', () => { if (!done) fail(new Error('SMTP connection closed')); });
    };
    const expect = (okPrefix) => new Promise((ok, bad) => waiters.push(line => (line.startsWith(okPrefix) ? ok(line) : bad(new Error('SMTP: ' + line)))));
    const cmd = (c, okPrefix) => { socket.write(c + '\r\n'); return expect(okPrefix); };
    const upgrade = () => new Promise((ok, bad) => {
      const old = socket; old.removeAllListeners('data'); old.removeAllListeners('close');
      const t = tls.connect({ socket: old, servername: host }, () => { attach(t); ok(); });
      t.on('error', bad);
    });
    const ehlo = async () => { socket.write('EHLO vidtube\r\n'); const lines = []; for (;;) { const l = await new Promise(ok => waiters.push(ok)); lines.push(l); if (/^250 /.test(l)) break; if (!/^250/.test(l)) throw new Error('SMTP: ' + l); } return lines.join('\n'); };
    (async () => {
      attach(secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port }));
      await expect('220');
      let caps = await ehlo();
      if (!secure && /STARTTLS/i.test(caps)) { await cmd('STARTTLS', '220'); await upgrade(); caps = await ehlo(); }
      if (user) {
        if (/AUTH[^\n]*PLAIN/i.test(caps)) await cmd('AUTH PLAIN ' + b64(`\0${user}\0${pass}`), '235');
        else { await cmd('AUTH LOGIN', '334'); await cmd(b64(user), '334'); await cmd(b64(pass), '235'); }
      }
      await cmd(`MAIL FROM:<${addrOnly(from)}>`, '250');
      await cmd(`RCPT TO:<${addrOnly(to)}>`, '250');
      await cmd('DATA', '354');
      const boundary = 'b' + crypto.randomBytes(8).toString('hex');
      const msg = [
        `From: ${from}`, `To: ${to}`, `Subject: ${encHeader(subject)}`, `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${host}>`, 'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
        `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(text).replace(/.{76}/g, '$&\r\n'), '',
        `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(html).replace(/.{76}/g, '$&\r\n'), '',
        `--${boundary}--`, '',
      ].join('\r\n');
      await cmd(msg + '\r\n.', '250');
      socket.write('QUIT\r\n');
      done = true; clearTimeout(timer); socket.end(); resolve();
    })().catch(e => { clearTimeout(timer); fail(e); });
  });
}

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f7;font-family:Segoe UI,Arial,sans-serif;color:#15161a"><div style="max-width:480px;margin:32px auto;background:#fff;border-radius:14px;padding:32px;border:1px solid #e3e5ea">
<div style="font-size:20px;font-weight:700;margin-bottom:16px">Vid<span style="color:#e6b400">Tube</span></div><h2 style="margin:0 0 12px;font-size:18px">${title}</h2>${bodyHtml}
<p style="color:#8a90a0;font-size:12px;margin-top:24px">If you did not request this, you can ignore this email.</p></div></body></html>`;
}

// Sends an email (SMTP when configured) and always records it in the outbox.
async function send({ to, subject, text, html, code = null }) {
  run('INSERT INTO outbox(to_email,subject,body,link,created_at) VALUES(?,?,?,?,?)', to, subject, text, code, now());
  // Without SMTP (or for placeholder addresses such as admin@vidtube.local) the message is only logged.
  if (!config.smtp.enabled || /\.(local|test|invalid)$/i.test(to)) {
    console.log(`[mail] ${config.smtp.enabled ? '(local address)' : '(no SMTP configured)'} to=${to} "${subject}"${code ? `  CODE: ${code}` : ''}`);
    return { delivered: false };
  }
  try { await smtpSend({ to, subject, text, html: html || layout(subject, `<p>${text}</p>`) }); return { delivered: true }; }
  catch (e) { console.error(`[mail] SMTP failed for ${to}: ${e.message}`); if (code) console.log(`[mail] fallback, CODE for ${to}: ${code}`); return { delivered: false, error: e.message }; }
}
function sendLink(to, subject, text, url, button) {
  return send({ to, subject, text: `${text}\n\n${url}`, html: layout(subject, `<p>${text}</p><p style="margin:20px 0"><a href="${url}" style="background:#e6b400;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${button}</a></p><p style="color:#8a90a0;font-size:12px">${url}</p>`) });
}

module.exports = { send, sendLink, enabled: config.smtp.enabled };
