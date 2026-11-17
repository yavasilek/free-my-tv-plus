import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { startCatalogServer } from './myshows-catalog.mjs';

const origin = 'https://myshows.me';
const selector = '.EpisodeDetails__watch-label.WatchCheckbox';
const checked = selector + '.WatchCheckbox--checked';
const unchecked = selector + ':not(.WatchCheckbox--checked)';
const timeout = 8000;

export function validEpisode(payload) {
  return payload?.source === 'fmtv-vokino-v1' &&
    ['show_id', 'episode_id', 'season', 'number'].every(key =>
      Number.isSafeInteger(payload[key]) && payload[key] > 0 && payload[key] <= 999999999) &&
    Number.isFinite(payload.progress) && payload.progress >= 90 && payload.progress <= 100;
}

export async function processEpisode(page, login, episode, apply) {
  const url = origin + '/view/episode/' + episode.episode_id + '/';
  const heading = 's' + String(episode.season).padStart(2, '0') + 'e' + String(episode.number).padStart(2, '0');
  const account = page.locator('a.SidebarMenuItem[href="/' + login + '"]');
  const control = page.locator(selector);
  const showPath = '/view/' + episode.show_id + '/';
  const showLink = page.locator('a[href="' + showPath + '"], a[href="' + origin + showPath + '"]');

  async function read() {
    const response = await page.goto(url, {waitUntil: 'domcontentloaded', timeout});
    const final = new URL(page.url());
    if (!response?.ok() || final.origin + final.pathname !== url) {
      console.warn('Episode navigation failed. HTTP: ' + (response?.status() || 'none') + ', expected path: ' + (final.origin + final.pathname === url));
      return 'episode-unavailable';
    }
    await account.waitFor({state: 'attached', timeout}).catch(() => {});
    if (await account.count() !== 1) return 'login-required';
    await control.waitFor({state: 'visible', timeout}).catch(() => {});
    const canonical = page.locator('link[rel="canonical"]');
    const matches = await Promise.all([
      canonical.getAttribute('href', {timeout}),
      page.locator('h1').innerText({timeout}),
      showLink.count(),
      control.count()
    ]);
    const headingMatches = matches[1].toLowerCase().startsWith(heading + ' ');
    if (matches[0] !== url || !headingMatches || !matches[2] || matches[3] !== 1) {
      console.warn('Episode controls did not match. Canonical: ' + (matches[0] === url) +
        ', heading: ' + headingMatches + ', series link: ' + Boolean(matches[2]) + ', controls: ' + matches[3]);
      return 'episode-unavailable';
    }
    if (await page.locator(checked).isVisible()) return 'watched';
    return await page.locator(unchecked).isVisible() ? 'unwatched' : 'episode-unavailable';
  }

  const current = await read();
  if (current !== 'unwatched' || !apply) return current;
  await page.locator(unchecked).click({timeout});
  await page.locator(checked).waitFor({state: 'visible', timeout}).catch(() => {});
  await page.waitForLoadState('networkidle', {timeout: 4000}).catch(() => {});
  // The second read confirms the server retained the mark after navigation.
  return await read() === 'watched' ? 'marked' : 'unconfirmed';
}

async function main() {
  const [mode] = process.argv.slice(2);
  const profile = process.env.FMTV_MYSHOWS_PROFILE_DIR || '';
  const login = process.env.FMTV_MYSHOWS_LOGIN || '';
  if (!['--setup', '--serve'].includes(mode) ||
      !isAbsolute(profile) || !/^[a-zA-Z0-9_.-]{1,64}$/.test(login)) {
    throw new Error('Set FMTV_MYSHOWS_PROFILE_DIR and FMTV_MYSHOWS_LOGIN and choose a relay mode.');
  }

  const host = process.env.FMTV_MYSHOWS_BIND || '127.0.0.1';
  const allowed = process.env.FMTV_MYSHOWS_ALLOW || '127.0.0.1';
  const port = Number(process.env.FMTV_MYSHOWS_PORT || 8767);
  const secret = process.env.FMTV_MYSHOWS_RELAY_KEY || '';
  const container = process.env.FMTV_MYSHOWS_CONTAINER === '1';
  if (mode === '--serve' && (!isIP(host) || (!container && host === '0.0.0.0') || host === '::' ||
      !isIP(allowed) || !/^[a-zA-Z0-9_-]{32,128}$/.test(secret) || !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('Set a specific bind IP, the allowed Home Assistant IP and a long random relay key');
  }

  accessSync(profile, constants.R_OK | constants.W_OK | constants.X_OK);
  console.log('Starting Chromium in ' + (mode === '--setup' ? 'login' : 'relay') + ' mode.');
  const context = await chromium.launchPersistentContext(profile, {
    channel: process.env.FMTV_MYSHOWS_CHROME || 'chrome',
    headless: !process.env.DISPLAY && mode !== '--setup',
    viewport: {width: 1280, height: 900},
    acceptDownloads: false
  });
  const page = context.pages()[0] || await context.newPage();
  if (mode === '--setup') {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => context.close());
    await page.goto(origin + '/', {waitUntil: 'domcontentloaded', timeout: 15000}).catch(error => {
      console.error('Initial MyShows navigation: ' + String(error.message).split('\n')[0]);
    });
    await new Promise(resolve => context.once('close', resolve));
    return;
  }
  const expected = Buffer.from('Bearer ' + secret);
  let busy = false;
  const server = createServer({requestTimeout: 5000}, async (req, res) => {
    function reply(status, result) {
      res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify({result}));
    }
    if (req.method !== 'POST' || req.url !== '/myshows/episode') return reply(404, 'not-found');
    const auth = Buffer.from(req.headers.authorization || '');
    if (req.socket.remoteAddress !== allowed || auth.length !== expected.length ||
        !timingSafeEqual(auth, expected)) return reply(403, 'forbidden');
    if (busy) return reply(429, 'busy');
    busy = true;
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1024) return reply(413, 'invalid-episode');
      }
      const episode = JSON.parse(body);
      if (!validEpisode(episode)) return reply(400, 'invalid-episode');
      const result = await processEpisode(page, login, episode, episode.probe !== true);
      reply(['marked', 'watched', 'unwatched'].includes(result) ? 200 : 409, result);
    } catch (error) {
      if (error instanceof SyntaxError) reply(400, 'invalid-episode');
      else reply(502, 'browser-error');
    } finally { busy = false; }
  });
  server.on('error', () => { console.error('Cannot listen on the configured address.'); process.exitCode = 1; context.close(); });
  server.listen(port, host, () => console.log('MyShows browser relay listening on the configured address.'));
  const catalogKey = process.env.FMTV_MYSHOWS_CATALOG_KEY || '';
  const catalog = /^[a-zA-Z0-9_-]{32,128}$/.test(catalogKey)
    ? startCatalogServer(context, login, host, catalogKey, process.env.FMTV_MYSHOWS_AUTO_MOVIES === 'true') : null;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { server.close(); if (catalog) catalog.close(); context.close(); });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('MyShows relay startup: ' + String(error.message).split('\n')[0]);
    const diagnostic = String(error.message).split('\n').find(line => /FATAL|Permission denied|Missing X server|failed to create|ERR_/.test(line));
    if (diagnostic) console.error(diagnostic.trim());
    process.exitCode = 1;
  });
}
