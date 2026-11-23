// Whatnot "best times to stream" dashboard. Zero dependencies, Node 18+.
// Fetches YOUR ended shows + analytics from the Whatnot Seller API, saves them to
// data/shows.json, and serves a dashboard that graphs the saved data.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.WHATNOT_API || 'https://api.whatnot.com/seller-api/rest/v2';
const PORT = Number(process.env.PORT || 3000);
const DEMO = process.argv.includes('--demo');
const STORE = path.join(__dirname, 'data', DEMO ? 'demo.json' : 'shows.json');
let token = process.env.WHATNOT_TOKEN || ''; // kept in memory only, never written to disk

const money = (m) => (m && m.amount != null ? Number(m.amount) : null);

async function readStore() {
  try { return JSON.parse(await fs.readFile(STORE, 'utf8')); }
  catch { return { updatedAt: null, shows: [] }; }
}
async function writeStore(s) {
  await fs.mkdir(path.dirname(STORE), { recursive: true });
  await fs.writeFile(STORE, JSON.stringify(s, null, 2));
}

async function wn(pathname, params = {}) {
  const url = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (r.status === 429) { await new Promise(res => setTimeout(res, 1000 * 2 ** attempt)); continue; }
    if (!r.ok) throw Object.assign(new Error(`Whatnot API ${r.status} on ${pathname}: ${(await r.text()).slice(0, 200)}`), { status: r.status });
    return r.json();
  }
  throw new Error('Rate limited by Whatnot API; try again shortly.');
}

// Pull every ended show, then analytics for any show we don't already have final numbers for.
async function sync() {
  if (!token) throw Object.assign(new Error('No token. Paste one in the dashboard or set WHATNOT_TOKEN.'), { status: 401 });
  const store = await readStore();
  const byId = new Map(store.shows.map(s => [s.id, s]));
  let cursor = null, listed = 0;
  do {
    const page = await wn('/shows', { status: 'ended', limit: 50, cursor, reverse: true });
    for (const sh of page.data) {
      listed++;
      const have = byId.get(sh.id);
      if (have && have.calculation_status === 'GENERATED') continue; // final, skip
      let a = null;
      try { a = await wn(`/analytics/shows/${sh.id}`); } catch (e) { if (e.status !== 404) throw e; }
      byId.set(sh.id, {
        id: sh.id, title: sh.title, visibility: sh.visibility,
        start: a?.start_time || sh.scheduled_start_at || sh.created_at, ended: sh.ended_at,
        calculation_status: a?.calculation_status ?? null,
        sales: money(a?.sales), earnings: money(a?.estimated_earnings), orders: a?.orders_count ?? null,
        aov: money(a?.average_order_value), buyers: a?.buyers_count ?? null,
        firstTimeBuyers: a?.first_time_buyers_count ?? null,
        impressions: a?.show_impression_count ?? null, ctr: a?.show_clickthrough_rate ?? null,
        peakViewers: a?.max_concurrent_viewers ?? null, views: a?.total_views ?? null,
        distinctViewers: a?.distinct_viewers_count ?? null, minutes: a?.stream_minutes ?? null,
        rating: a?.average_rating ?? null,
      });
    }
    cursor = page.next_cursor;
  } while (cursor);
  const out = { updatedAt: new Date().toISOString(), shows: [...byId.values()].sort((a, b) => (b.start || '').localeCompare(a.start || '')) };
  await writeStore(out);
  return { listed, saved: out.shows.length, updatedAt: out.updatedAt };
}

// Deterministic fake data so the dashboard can be tried without a token.
async function demo() {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const shows = [];
  for (let d = 1; d <= 120; d++) {
    if (rnd() < 0.45) continue;
    const day = new Date(Date.now() - d * 864e5);
    const hour = [11, 14, 18, 19, 20, 21, 22][Math.floor(rnd() * 7)];
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour + 4, Math.floor(rnd() * 4) * 15));
    const wk = [0, 6].includes(start.getUTCDay()) ? 1.3 : 1;
    const eve = hour >= 19 ? 1.6 : 1;
    const peak = Math.round((15 + rnd() * 40) * wk * eve), orders = Math.round(peak * (0.3 + rnd() * 0.5));
    const sales = +(orders * (14 + rnd() * 20)).toFixed(2);
    shows.push({ id: 'demo' + d, title: 'Demo show ' + d, visibility: 'public', start: start.toISOString(),
      ended: new Date(start.getTime() + 2 * 36e5).toISOString(), calculation_status: 'GENERATED', sales,
      earnings: +(sales * 0.8).toFixed(2), orders, aov: +(sales / orders).toFixed(2), buyers: Math.round(orders * 0.8),
      firstTimeBuyers: Math.round(orders * 0.3), impressions: peak * 40, ctr: +(2 + rnd() * 3).toFixed(2),
      peakViewers: peak, views: peak * 5, distinctViewers: peak * 4, minutes: 120, rating: 4.5 });
  }
  const out = { updatedAt: new Date().toISOString(), shows };
  await writeStore(out); return { listed: shows.length, saved: shows.length, updatedAt: out.updatedAt };
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/data') return json(res, 200, { ...(await readStore()), demo: DEMO, hasToken: !!token });
    if (u.pathname === '/api/sync' && req.method === 'POST') {
      let body = ''; for await (const c of req) body += c;
      const t = body ? JSON.parse(body).token : '';
      if (t) token = String(t).trim();
      return json(res, 200, DEMO ? await demo() : await sync());
    }
    const file = path.join(__dirname, 'public', u.pathname === '/' ? 'index.html' : u.pathname);
    if (!file.startsWith(path.join(__dirname, 'public'))) return json(res, 403, { error: 'forbidden' });
    const buf = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(buf);
  } catch (e) {
    if (e.code === 'ENOENT') return json(res, 404, { error: 'not found' });
    json(res, e.status && e.status < 600 ? e.status : 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}${DEMO ? '  (DEMO data)' : ''}`));
