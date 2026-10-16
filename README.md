# VidTube + GeoTube

Self-hosted video platform. VidTube is the general platform; GeoTube (`/geotube`) is the moderated corner for mapping and Countryballs videos.

Requirements: Node.js 22.5 or newer (no npm packages needed) and FFmpeg on the PATH for transcoding and thumbnails.

## Start

Double-click `start.cmd`, or run:

```
npm start
```

The site runs on http://localhost:4321. Data (database, uploaded media, thumbnails) lives in `data/`.

## Configuration (`config.json`)

Copy `config.example.json` to `config.json` and fill it in. Nothing in it is required, but **without SMTP settings no real email is sent**: password-reset messages are then only listed under Moderation → Mail outbox.

| Key | Meaning |
|---|---|
| `siteUrl` | Public address of the site, used in email links (e.g. `https://vidtube.lucasswebsite.be`). |
| `adminEmail`, `adminPassword` | The first administrator account, created on the first start only. Use a real mailbox so password resets can reach you. |
| `smtp.host`, `smtp.port`, `smtp.secure` | Your mail server. Port 465 with `secure: true` (SMTPS) or port 587 with `secure: false` (STARTTLS). |
| `smtp.user`, `smtp.pass` | Mailbox login. |
| `smtp.from` | Sender shown to users, e.g. `VidTube <noreply@lucasswebsite.be>`. |
| `giphyApiKey` | GIPHY API key (free at developers.giphy.com) for GIF search in comments and posts. Without it the GIF search button says it is not set up; uploading your own pictures and GIFs always works. |

Environment variables override the file: `PORT`, `GIPHY_API_KEY`, `DATA_DIR`, `SITE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `FFMPEG_PATH`, `COOKIE_SECURE=1` (behind HTTPS), `TRUST_PROXY=1` (behind a reverse proxy).

## Email

Email is only used for password resets. Sign-in and registration work without it.

## Layout

- `src/` server: `server.js` (HTTP), `db.js` (migrations), `core.js` (helpers), `mail.js` (SMTP client), `routes-*.js` (API), `media.js` (uploads + FFmpeg queue), `geo.js` (GeoTube eligibility check), `seed.js` (first-run data).
- `public/` front-end: a dependency-free single-page app (`js/app.js`, `views.js`, `studio.js`, `admin.js`).

## Views

A view is counted the moment a video or Short starts playing, every time: the same person watching three times is three views, playing a video again after it ended is a new view, and the channel owner's own plays count too. A Short counts each time it scrolls onto the screen; it always restarts from the beginning. Videos start playing automatically when the watch page opens. Watch time and the resume position keep being reported while the video plays.

## Ads

House ads for befriended YouTube channels (`src/ads.js`, list in `DEFAULT_SETTINGS.ads`, avatars in `public/img/ads/`). Every feed page and watch page shows one banner, and the browser remembers which channel it showed last so a refresh or the next page gets a different one. On the watch page (never in Shorts) there is a pre-roll with a given chance: the player is covered by one channel for 5–10 seconds, then the video starts. Moderation → Settings → "Ads for friendly YouTube channels" has the switches, chance, durations, per-channel on/off and how often each ad was shown and clicked.

## YouTube import

Every check reads the channel's RSS feed and the Shorts and Videos tabs of the channel page, because the feed can lag a quarter of an hour or more behind an upload.

`src/youtube.js` follows YouTube channels and puts every new video or Short on VidTube automatically. No YouTube API key is needed: the public RSS feed of each channel is read every few minutes (Moderation → YouTube import, default every 2 minutes), a new video is downloaded with [yt-dlp](https://github.com/yt-dlp/yt-dlp) and then goes through the normal FFmpeg queue like any upload. The YouTube thumbnail, title, description and tags come along, the publish date is the moment of import (so it shows at the top of the feeds), and anything shorter than 1:30 becomes a Short while longer videos become normal videos; the owner can switch that in Studio under Options. The sexual-content detector applies to imported videos as well.

- Followed from the first start: @Belgian_Mapper-t6z, @MapperFromMars and @mapperfromgreece, all into the VidTube channel @Belgian_Mapper. Administrators add or remove channels and choose the VidTube channel per source; "auto" gives a YouTube channel its own VidTube channel at the first import (with the house-ad picture as avatar).
- Only videos uploaded after a channel was followed are imported by themselves. Older videos in the feed are listed as "not imported" with an Import button.
- yt-dlp is looked for in `YTDLP_PATH`, in `data/tools/` and on the PATH; when it is missing the server downloads it from GitHub into `data/tools/`. "Update yt-dlp" on the page runs its self-update, which is needed now and then because YouTube changes.
- A failed download is retried up to 5 times with a growing wait (a premiere or a video YouTube is still processing works later).

## Install as an app

VidTube is a Progressive Web App: `public/manifest.webmanifest` + `public/sw.js`. In Chrome or Edge, open **Get the app** in the sidebar (or `/download`) and click **Install VidTube on this computer**. It then runs in its own window with a desktop and Start-menu shortcut. The service worker caches nothing but an offline page, so the app always shows the latest code; it does need the server to be running.

## Special badges

Two picture badges (`public/img/badges/`) appear next to a name on video cards, the watch page, comments, search and the channel page: **VidTube Owner** (held by exactly one account; giving it to someone else moves it) and **VidTube Moderator**. Administrators give or remove them in Moderation → Users (`PUT /api/admin/users/:id/badges`).

## Halloween event

From 1 October to 1 November (or all year with "Ignore the dates" in Moderation → Settings) the logo becomes a jack-o'-lantern (on VidTube and GeoTube) and the home page shows the event banner. A signed-in viewer who starts 10 videos or Shorts (the number is a setting) unlocks the **GIF maker**: press **GIF** under a comment or in a post, open the **My GIFs** tab, pick a video (the one you are watching, or one from your history), a start time and a length of 1–6 seconds, and FFmpeg turns it into a GIF (`src/halloween.js`). GIFs made this way are tied to the account that made them: nobody else can attach them, and they can be deleted from the same tab. At most 30 per account.



Every video's title, description and tags (and every channel's name and description) are checked against a list of sexual terms (`src/safety.js`). **One match is enough**: the video is held with status `pending` and nobody can watch it until a moderator or administrator approves, restricts or rejects it in Moderation → Review queue (filter "Sexual-content flags"). The creator is told the video is being checked; the moderators get a notification.

- Works on VidTube and GeoTube alike, next to the existing GeoTube topic check.
- Runs when a video is published or edited, when tags change, on every server start and when the term list changes. Moderators can also press "Rescan all videos now" under Platform settings.
- A video a moderator approved stays live as long as its matched terms do not change; a new term sends it back to the queue.
- A channel whose name or description matches gets an automatic report in Moderation → Reports. Channels with unreviewed flagged videos are listed under Channels → "Flagged for sexual content".
- Administrators edit the term list and can switch the detector off under Platform settings. The list contains English and Dutch terms; masked spellings such as `s.e.x` are caught too.
- The detector reads text only. It cannot see what is in the video itself, so it can miss things and it can be wrong; that is why it never rejects anything by itself.
