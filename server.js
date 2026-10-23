'use strict';
const express = require('express'), http = require('http'), { WebSocketServer } = require('ws');
const crypto = require('crypto'), fs = require('fs'), path = require('path');

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const rand = () => crypto.randomBytes(6).toString('hex');
const HOST_KEY = process.env.HOST_KEY || rand();
const CREATOR_KEY = process.env.CREATOR_KEY || rand();
if (!process.env.HOST_KEY || !process.env.CREATOR_KEY)
  console.log(`[keys] HOST_KEY=${HOST_KEY}  CREATOR_KEY=${CREATOR_KEY}  (set them as environment variables to keep them stable)`);
let TRN = [];
try { TRN = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'trainers.json'), 'utf8')).map(t => t.id); } catch {}
const TRS = new Set(TRN);
const ANY_TIMER = process.env.ALLOW_ANY_TIMER === '1';
const SNIPE = Number(process.env.SNIPE_MS) || 10000;

const blank = () => ({ room: { status: 'lobby', stage: 1, timer: 30, mode: 'A', auto: false, bb: null, test: false, botplay: true },
  players: [], pool: null, tpool: null, auction: null, bids: [], results: [] });
let G = blank();
try { G = Object.assign(blank(), JSON.parse(fs.readFileSync(DATA, 'utf8'))); } catch {}
let saveT; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(DATA, JSON.stringify(G), () => {}), 400); };
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/* ---------- game logic ---------- */
const stageRes = st => G.results.filter(r => r.stage === st && r.winner);
const elig = st => { const w = new Set(stageRes(st).map(r => r.winner)); return G.players.filter(p => !w.has(p.id)); };
const bal = id => 1000 - G.results.filter(r => r.winner === id).reduce((a, r) => a + r.price, 0);
const mkTpool = () => ({ items: [1, 2, 3].flatMap(s => Array.from({ length: 10 }, (_, i) => ({
  id: crypto.randomUUID(), stage: s, name: 'Test ' + ['', 'Legendary', 'Mega', 'Uber'][s] + ' ' + (i + 1), image: '', used: false }))) });
const pick = arr => arr[crypto.randomInt(arr.length)];

function lot() {
  const a = G.auction; if (!a || a.state !== 'live') return null;
  const own = G.bids.filter(b => b.seq === a.seq), bs = own.slice();
  if (G.room.mode === 'B' && a.bb) bs.push({ bidder: a.bb, amount: 1, ts: 0, blind: true });
  bs.sort((x, y) => y.amount - x.amount || x.ts - y.ts);
  const last = own.reduce((m, b) => Math.max(m, b.ts), 0);
  return { a, bs, high: bs[0] || null, end: Math.max(a.endsAt, last ? last + SNIPE : 0) };
}

function settle(forced) {
  const a = G.auction, L = lot(); if (!L) return 'No live auction.';
  if (!forced && Date.now() < L.end) return 'The timer is still running.';
  let w, price, byBlind = false;
  if (forced) { w = forced; price = 1; byBlind = true; }
  else if (L.high && !L.high.blind) { w = L.high.bidder; price = L.high.amount; }
  else { w = a.bb; price = 1; byBlind = true; }
  if (!w) return 'No winner could be determined.';
  G.results.push({ seq: a.seq, stage: a.stage, name: a.name, img: a.img, winner: w, price, byBlind, ts: Date.now() });
  Object.assign(a, { state: 'sold', winner: w, price, byBlind });
  const ex = new Set(stageRes(a.stage).map(r => r.winner)), ps = G.players, n = ps.length;
  const i = ps.findIndex(p => p.id === a.bb); G.room.bb = null;
  for (let k = 1; k <= n; k++) { const p = ps[(i + k + n) % n]; if (!ex.has(p.id)) { G.room.bb = p.id; break; } }
}

function reveal() {
  const r = G.room;
  if (r.status !== 'live') return 'The draft isn’t running.';
  if (G.auction && G.auction.state === 'live') return 'An auction is already live.';
  const e = elig(r.stage); if (!e.length) return 'Everyone has a Pokémon for this stage.';
  const pool = (r.test ? G.tpool : G.pool).items.filter(i => i.stage === r.stage && !i.used);
  if (!pool.length) return 'The pool for this stage is empty.';
  const it = pick(pool); it.used = true;
  const seq = (G.auction ? G.auction.seq : 0) + 1;
  G.auction = { seq, stage: r.stage, state: 'live', name: it.name, img: it.image ? it.id : null, endsAt: Date.now() + r.timer * 1000, bb: r.bb };
  if (e.length === 1) settle(e[0].id);
}

function bid(c, amount, as) {
  const L = lot(), r = G.room; let who = c.id;
  if (as) {
    const p = G.players.find(p => p.id === as);
    if (!c.isHost || !r.test || !p || !p.bot) return 'You can only bid for dummy trainers in a test run.';
    who = as;
  }
  if (!L) return 'No auction is live.';
  if (!who || !G.players.some(p => p.id === who)) return 'Join the room first.';
  if (Date.now() > L.end) return 'Time’s up.';
  if (stageRes(r.stage).some(x => x.winner === who)) return as ? 'That dummy already won this stage.' : 'You already won this stage.';
  amount = Math.floor(Number(amount));
  const min = L.high ? L.high.amount + 1 : 1;
  if (!Number.isFinite(amount) || amount < min) return 'Minimum bid is ' + min + '.';
  const mx = bal(who) - (3 - r.stage);
  if (amount > mx) return 'Max bid is ' + mx + ' (must reserve coins for later stages).';
  G.bids.push({ seq: L.a.seq, bidder: who, amount, ts: Date.now() });
}

function host(c, m) {
  const r = G.room, a = G.auction;
  const sold = !a || a.state === 'sold';
  switch (m.act) {
    case 'config':
      if (r.status !== 'lobby' && m.timer !== undefined) return 'Settings are locked after the start.';
      if (m.timer !== undefined && (ANY_TIMER ? m.timer > 0 : [20, 30, 45, 60].includes(m.timer))) r.timer = m.timer;
      if (m.mode === 'A' || m.mode === 'B') { if (r.status !== 'lobby') return 'Locked after the start.'; r.mode = m.mode; }
      if (typeof m.auto === 'boolean') r.auto = m.auto;
      if (typeof m.botplay === 'boolean') r.botplay = m.botplay;
      return;
    case 'start':
      if (r.status !== 'lobby') return 'Already started.';
      if (G.players.length !== 10) return 'Exactly 10 trainers are required.';
      if (!r.test && !G.pool) return 'The pool list hasn’t been submitted yet.';
      if (r.test) G.tpool = mkTpool();
      r.status = 'live'; r.stage = 1; r.bb = pick(G.players).id; return;
    case 'reveal': return reveal();
    case 'settle': return settle();
    case 'advance':
      if (r.status !== 'live' || !sold || elig(r.stage).length || r.stage >= 3) return 'Can’t advance yet.';
      r.stage++; r.bb = pick(G.players).id; return;
    case 'finish':
      if (r.status !== 'live' || !sold || elig(r.stage).length || r.stage !== 3) return 'Can’t finish yet.';
      r.status = 'done'; r.bb = null; return;
    case 'kick':
      if (r.status !== 'lobby') return 'Only in the lobby.';
      G.players = G.players.filter(p => p.id !== m.id); return;
    case 'reset':
      G.results = []; G.bids = []; G.auction = null; r.status = 'lobby'; r.stage = 1; r.bb = null;
      if (G.pool) G.pool.items.forEach(i => i.used = false);
      if (r.test) G.tpool = mkTpool();
      return;
    case 'test':
      if (r.status !== 'lobby') return 'Only in the lobby.';
      r.test = !!m.on;
      if (!r.test) { G.players = G.players.filter(p => !p.bot); G.tpool = null; }
      return;
    case 'addbots': {
      if (!r.test) return 'Turn on the test run first.';
      if (r.status !== 'lobby') return 'Only in the lobby.';
      let k = G.players.filter(p => p.bot).length;
      while (G.players.length < 10) { k++; G.players.push({ id: 'bot-' + crypto.randomBytes(3).toString('hex'), name: 'Bot ' + k, bot: true, av: TRN.length ? pick(TRN) : undefined }); }
      return;
    }
    case 'rmbots':
      if (r.status !== 'lobby') return 'Only in the lobby.';
      G.players = G.players.filter(p => !p.bot); return;
    case 'endtest':
      G.results = []; G.bids = []; G.auction = null; r.status = 'lobby'; r.stage = 1; r.bb = null;
      r.test = false; G.players = G.players.filter(p => !p.bot); G.tpool = null; return;
    case 'wipepool': if (r.status !== 'lobby') return 'Reset the draft first.'; G.pool = null; return;
  }
  return 'Unknown action.';
}


/* ---------- image search (PokéAPI) ---------- */
const API = 'https://pokeapi.co/api/v2';
const deburr = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const slugify = t => deburr(String(t).toLowerCase()).replace(/[.’'`:]/g, '').replace(/♀/g, '-f').replace(/♂/g, '-m').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function formSlugs(q) {            // "Mega Charizard Y" -> charizard-mega-y
  const t = deburr(String(q).toLowerCase()).replace(/[’'`]/g, '').trim().split(/\s+/);
  if (t[0] === 'mega' && t.length > 1) {
    const last = t.length > 2 && /^[xyz]$/.test(t[t.length - 1]) ? t.pop() : null;
    const base = slugify(t.slice(1).join(' '));
    return last ? [base + '-mega-' + last] : [base + '-mega'];
  }
  if (/^(primal|alolan|galarian|hisuian|paldean)$/.test(t[0]) && t.length > 1) {
    const r = { alolan: 'alola', galarian: 'galar', hisuian: 'hisui', paldean: 'paldea', primal: 'primal' }[t[0]];
    return [slugify(t.slice(1).join(' ')) + '-' + r];
  }
  return [slugify(q)];
}
async function jget(url) {
  try { const r = await fetch(url, { headers: { 'User-Agent': 'cobbleverse-auction' }, signal: AbortSignal.timeout(8000) }); return r.ok ? await r.json() : null; }
  catch { return null; }
}
const okHost = u => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'raw.githubusercontent.com' && x.pathname.startsWith('/PokeAPI/sprites/'); } catch { return false; } };
function spriteList(p) {
  const o = (p.sprites && p.sprites.other) || {}, a = o['official-artwork'] || {}, h = o.home || {}, sh = o.showdown || {};
  return [['Official artwork', a.front_default], ['HOME render', h.front_default], ['Shiny artwork', a.front_shiny], ['Shiny HOME', h.front_shiny],
    ['Animated', sh.front_default], ['Pixel sprite', p.sprites && p.sprites.front_default]]
    .filter(([, u]) => u && okHost(u) && !/\.svg$/i.test(u)).map(([label, url]) => ({ label, url }));
}
const searchCache = new Map();
async function searchImages(q) {
  const key = String(q).toLowerCase().trim(); if (searchCache.has(key)) return searchCache.get(key);
  let list = [];
  for (const s of formSlugs(q)) { const p = await jget(`${API}/pokemon/${s}`); if (p) { list = spriteList(p); break; } }
  if (!list.length) { // fall back to the species' default form
    const base = slugify(String(q).replace(/^mega\s+/i, '').replace(/\s+[xyz]$/i, ''));
    const p = await jget(`${API}/pokemon/${base}`); if (p) list = spriteList(p);
  }
  if (list.length) searchCache.set(key, list);
  return list;
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
async function downloadImage(u) {
  if (!okHost(u)) throw new Error('That picture source isn’t allowed.');
  const ext = new URL(u).pathname.split('.').pop().toLowerCase(), mime = MIME[ext];
  if (!mime) throw new Error('Unsupported picture type.');
  const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('Couldn’t download the picture.');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 1500000) throw new Error('Picture is too large.');
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/* ---------- http ---------- */
const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_, res) => res.send('ok'));
const MUSIC = path.join(__dirname, 'public', 'music');
const audioFiles = d => { try { return fs.readdirSync(d).filter(x => /\.(mp3|ogg|wav|m4a)$/i.test(x)); } catch { return []; } };
app.get('/api/music', (_, res) =>
  res.json({ files: audioFiles(MUSIC), pokemon: audioFiles(path.join(MUSIC, 'pokemon')) }));
app.get('/api/search', async (req, res) => {
  const k = req.get('x-creator-key') || '';
  if (!same(k, CREATOR_KEY)) return res.status(403).json({ error: 'Wrong creator key.' });
  const q = String(req.query.q || '').trim().slice(0, 40);
  if (q.length < 2) return res.json({ results: [] });
  res.json({ results: await searchImages(q) });
});

app.get('/img/:id', (req, res) => {
  const id = req.params.id;
  const shown = G.results.some(r => r.img === id) || (G.auction && G.auction.img === id);
  const it = shown && G.pool && G.pool.items.find(i => i.id === id);
  const m = it && /^data:(image\/[a-z]+);base64,(.*)$/.exec(it.image);
  if (!m) return res.sendStatus(404);
  res.set('Content-Type', m[1]).set('Cache-Control', 'public,max-age=31536000,immutable').send(Buffer.from(m[2], 'base64'));
});

const IMG = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
app.post('/api/pool', async (req, res) => {
  const { key, items } = req.body || {};
  if (typeof key !== 'string' || !same(key, CREATOR_KEY)) return res.status(403).json({ error: 'Wrong creator key.' });
  if (G.pool) return res.status(409).json({ error: 'The list is already locked.' });
  if (G.room.status !== 'lobby') return res.status(409).json({ error: 'The draft has started.' });
  if (!Array.isArray(items) || items.length !== 30) return res.status(400).json({ error: 'Exactly 30 Pokémon are required.' });
  const out = [];
  for (const s of [1, 2, 3]) {
    const g = items.filter(i => i && i.stage === s);
    if (g.length !== 10) return res.status(400).json({ error: 'Stage ' + s + ' needs exactly 10 Pokémon.' });
    for (const i of g) {
      const name = String(i.name || '').trim().slice(0, 30);
      if (!name) return res.status(400).json({ error: 'Every Pokémon needs a name.' });
      out.push({ id: crypto.randomUUID(), stage: s, name, image: '', src: i, used: false });
    }
  }
  try {
    await Promise.all(out.map(async it => {
      const i = it.src; delete it.src;
      if (i.image) { if (!IMG.test(i.image) || i.image.length > 600000) throw new Error('Bad image for ' + it.name); it.image = i.image; }
      else if (i.imageUrl) { try { it.image = await downloadImage(i.imageUrl); } catch (e) { throw new Error(it.name + ': ' + e.message); } }
    }));
  } catch (e) { return res.status(400).json({ error: e.message }); }
  G.pool = { items: out }; save(); broadcast(); res.json({ ok: true });
});

/* ---------- websocket ---------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const hid = t => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 10);

function view(c) {
  const a = G.auction, L = lot(), r = G.room, balMap = {};
  G.players.forEach(p => balMap[p.id] = bal(p.id));
  return { now: Date.now(), room: r, players: G.players, bal: balMap, eligible: elig(r.stage).map(p => p.id),
    auction: a && { seq: a.seq, stage: a.stage, state: a.state, name: a.name, img: a.img, bb: a.bb,
      endsAt: L ? L.end : a.endsAt, winner: a.winner, price: a.price, byBlind: a.byBlind },
    high: L && L.high ? { bidder: L.high.bidder, amount: L.high.amount, blind: !!L.high.blind } : null,
    bids: a ? G.bids.filter(b => b.seq === a.seq).slice(-12).reverse() : [],
    results: G.results, locked: !!G.pool,
    you: { id: c.id, isHost: c.isHost, joined: G.players.some(p => p.id === c.id) } };
}
function broadcast() { for (const ws of wss.clients) if (ws.readyState === 1 && ws.c) ws.send(JSON.stringify({ t: 'state', s: view(ws.c) })); save(); }

wss.on('connection', ws => {
  ws.c = { id: null, isHost: false };
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const c = ws.c, fail = e => e && ws.send(JSON.stringify({ t: 'err', m: e }));
    if (m.t === 'hello' && typeof m.token === 'string' && m.token.length >= 16) c.id = hid(m.token);
    else if (m.t === 'auth' && typeof m.key === 'string') {
      if (same(m.key, HOST_KEY)) c.isHost = true; else ws.send(JSON.stringify({ t: 'authfail' }));
    }
    else if (!c.id) return;
    else if (m.t === 'join') {
      const name = String(m.name || '').trim().slice(0, 20); if (!name) return fail('Enter a name.');
      const p = G.players.find(p => p.id === c.id);
      if (p) { p.name = name; if (TRS.has(m.av)) p.av = m.av; }
      else if (G.room.status !== 'lobby') return fail('The draft has already started.');
      else if (G.players.length >= 10) return fail('The room is full.');
      else G.players.push({ id: c.id, name, av: TRS.has(m.av) ? m.av : undefined });
    }
    else if (m.t === 'avatar') { const p = G.players.find(p => p.id === c.id); if (p && TRS.has(m.av)) p.av = m.av; }
    else if (m.t === 'bid') fail(bid(c, m.amount, m.as));
    else if (m.t === 'host') { if (!c.isHost) return fail('Host only.'); fail(host(c, m)); }
    broadcast();
  });
});
setInterval(() => { const L = lot(); if (L && G.room.auto && Date.now() >= L.end) { settle(); broadcast(); } }, 500);
setInterval(() => {                       // dummy trainers bid on their own during a test run
  const L = lot(), r = G.room; if (!L || !r.test || !r.botplay || Date.now() >= L.end) return;
  const mine = G.bids.filter(b => b.seq === L.a.seq && String(b.bidder).startsWith('bot-')).length;
  if (mine >= 5 || Math.random() > 0.35) return;
  const e = elig(r.stage).filter(p => p.bot && !(L.high && L.high.bidder === p.id)); if (!e.length) return;
  const p = pick(e), min = L.high ? L.high.amount + 1 : 1, mx = bal(p.id) - (3 - r.stage); if (mx < min) return;
  if (!bid({ id: p.id }, Math.min(mx, min + crypto.randomInt(25)))) broadcast();
}, 1200);
server.listen(PORT, () => console.log('Auction running on port ' + PORT));
