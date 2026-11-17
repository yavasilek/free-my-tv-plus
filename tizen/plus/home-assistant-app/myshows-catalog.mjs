import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const origin = 'https://myshows.me';
const idPattern = /^[1-9][0-9]{0,9}$/;
const moviePageSize = 60;

function validProgress(data) {
  return data && typeof data.title === 'string' && data.title.trim() && data.title.length <= 180 &&
    typeof data.original === 'string' && data.original.length <= 180 &&
    Number.isInteger(data.year) && data.year >= 1888 && data.year <= 2200 &&
    Number.isFinite(data.progress) && data.progress >= 90 && data.progress <= 100 &&
    (data.probe === undefined || data.probe === true);
}

async function readAccount(context, login, task, data) {
  const page = await context.newPage();
  try {
    const response = await page.goto(origin + '/profile/movies/', {waitUntil: 'domcontentloaded', timeout: 12000});
    if (!response?.ok() || new URL(page.url()).origin !== origin) throw new Error('site-unavailable');
    await page.waitForFunction(() => {
      const app = document.querySelector('#__nuxt')?.__vue_app__;
      const nuxt = app?.$nuxt || app?.config.globalProperties.$nuxt;
      return Boolean(nuxt?.$api);
    }, null, {timeout: 8000});
    if (await page.locator('a.SidebarMenuItem[href="/' + login + '"]').count() !== 1) throw new Error('login-required');

    return await page.evaluate(async ({task, data, moviePageSize}) => {
      const app = document.querySelector('#__nuxt').__vue_app__;
      const {$api: api, $apiClient: client} = app.$nuxt || app.config.globalProperties.$nuxt;
      if (task === 'episodes') {
        const result = await client.batch(() => data.map(showId => api.profile.episodes({showId})));
        return data.map((showId, i) => {
          const rows = result[i];
          if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row?.id))) return null;
          return {showId, watched: rows.filter(row => row.watchDate).map(row => row.id)};
        }).filter(Boolean);
      }
      if (task === 'mark') {
        const movie = await api.profile.movie({movieId: data});
        if (movie?.watchStatus === 'finished') return true;
        if (movie?.watchStatus !== 'later') return false;
        await api.manage.setMovieStatus({movieId: data, status: 'finished'});
        return (await api.profile.movie({movieId: data}))?.watchStatus === 'finished';
      }
      if (task === 'movie-progress') {
        const normalize = title => String(title || '').normalize('NFKC').toLowerCase()
          .replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
        const title = normalize(data.title), original = normalize(data.original);
        const pageSize = 50;
        const search = {query: data.title, year: data.year};
        const [rows, total] = await client.batch(() => [
          api.movies.getCatalog({search, page: 0, pageSize}), api.movies.count({search})
        ]);
        if (!Array.isArray(rows) || !Number.isInteger(total) || total > rows.length) return {status: 'unmatched'};
        const matches = new Map();
        for (const row of rows) {
          const movie = row?.movie;
          if (!movie || !Number.isSafeInteger(movie.id) || movie.id <= 0 || Number(movie.year) !== data.year) continue;
          const names = [normalize(movie.title), normalize(movie.titleOriginal)];
          if (!names.includes(title) || (original && !names.includes(original))) continue;
          matches.set(movie.id, movie);
        }
        if (matches.size !== 1) return {status: 'unmatched'};
        const movieId = matches.keys().next().value;
        if (data.probe) return {status: 'matched', movieId};
        const current = await api.profile.movie({movieId});
        if (current?.watchStatus === 'finished') return {status: 'watched', movieId};
        await api.manage.setMovieStatus({movieId, status: 'finished'});
        const saved = await api.profile.movie({movieId});
        if (saved?.watchStatus !== 'finished') throw new Error('unconfirmed');
        return {status: 'marked', movieId};
      }
      const [planned, watched] = await client.batch(() => [
        api.profile.unwatchedMovies({search: {status: 'Released'}, page: data, pageSize: moviePageSize}),
        api.profile.watchedMovies({search: {status: 'Finished'}, page: data, pageSize: moviePageSize})
      ]);
      if (!Array.isArray(planned) || !Array.isArray(watched)) throw new Error('list-unavailable');
      const cards = planned.concat(watched).filter(movie => ['later', 'finished'].includes(movie.userMovie?.watchStatus));
      return {items: cards.map(movie => ({
        id: movie.id, title: movie.title || movie.titleOriginal, year: movie.year,
        poster: movie.image || movie.poster || '', watched: movie.userMovie.watchStatus === 'finished'
      })), more: planned.length === moviePageSize || watched.length === moviePageSize};
    }, {task, data, moviePageSize});
  } finally {
    await page.close();
  }
}

export function startCatalogServer(context, login, host, secret, autoMovies) {
  const expected = Buffer.from('Bearer ' + secret);
  let active = 0;
  let activePosters = 0;
  const posters = new Map();
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type'
  };

  async function moviePoster(path) {
    if (posters.has(path)) return posters.get(path);
    const response = await fetch('https://media.myshows.me' + path, {
      redirect: 'error', signal: AbortSignal.timeout(5000)
    });
    const type = response.headers.get('content-type') || '';
    const length = Number(response.headers.get('content-length'));
    if (!response.ok || !/^image\/(?:jpeg|png|webp)$/.test(type) || length < 1 || length > 500000) {
      await response.body?.cancel();
      return null;
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length !== length) return null;
    if (posters.size >= 96) posters.delete(posters.keys().next().value);
    const poster = {type, data};
    posters.set(path, poster);
    return poster;
  }
  const server = createServer({requestTimeout: 5000}, async (req, res) => {
    function reply(status, body) {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...cors
      });
      res.end(body === undefined ? '' : JSON.stringify(body));
    }
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return reply(400); }
    const task = url.pathname.split('/').pop();
    if (!['episodes', 'movies', 'mark', 'poster', 'movie-progress'].includes(task) || url.pathname !== '/myshows/' + task) return reply(404);
    if (req.method === 'OPTIONS') return reply(204);
    if (req.method !== (['mark', 'movie-progress'].includes(task) ? 'POST' : 'GET')) return reply(405);
    const auth = Buffer.from(req.headers.authorization || '');
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected) ||
        url.searchParams.get('login')?.toLowerCase() !== login.toLowerCase()) return reply(403);
    if (task === 'poster') {
      const path = url.searchParams.get('path') || '';
      if (!/^\/movies\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(path) || path.length > 200) return reply(400);
      if (activePosters >= 4) return reply(429);
      activePosters++;
      try {
        const poster = await moviePoster(path);
        if (!poster) return reply(404);
        res.writeHead(200, {'Content-Type': poster.type, 'Cache-Control': 'private, max-age=3600', ...cors});
        res.end(poster.data);
      } catch {
        reply(502);
      } finally {
        activePosters--;
      }
      return;
    }
    let data;
    if (task === 'episodes') {
      const ids = [...new Set((url.searchParams.get('ids') || '').split(','))];
      if (ids.length > 18 || ids.some(id => !idPattern.test(id))) return reply(400);
      data = ids.map(Number);
    } else if (task === 'mark') {
      const id = url.searchParams.get('id');
      if (!id || !idPattern.test(id)) return reply(400);
      data = Number(id);
    } else if (task === 'movie-progress') {
      try {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) return reply(413);
        }
        data = JSON.parse(body);
        if (!validProgress(data)) return reply(400);
        if (!data.probe && !autoMovies) return reply(200, {result: {status: 'disabled'}});
      } catch {
        return reply(400);
      }
    } else {
      const page = url.searchParams.get('page') || '0';
      if (!/^\d{1,3}$/.test(page)) return reply(400);
      data = Number(page);
    }
    if (active >= 2) return reply(429);
    active++;
    try {
      const result = await readAccount(context, login, task, data);
      return task === 'mark' && result !== true ? reply(409) : reply(200, {result});
    } catch (error) {
      return reply(502, {error: error.message === 'login-required' ? 'login-required' : 'myshows-unavailable'});
    } finally {
      active--;
    }
  });
  server.on('error', () => console.error('MyShows catalog port is unavailable.'));
  server.listen(8768, host, () => console.log('MyShows catalog is ready.'));
  return server;
}
