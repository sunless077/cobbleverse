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
const ANY_TIMER = process.env.ALLOW_ANY_TIMER === '1';
const SNIPE = Number(process.env.SNIPE_MS) || 10000;

const blank = () => ({ room: { status: 'lobby', stage: 1, timer: 30, mode: 'A', auto: false, bb: null },
  players: [], pool: null, auction: null, bids: [], results: [] });
let G = blank();
try { G = Object.assign(blank(), JSON.parse(fs.readFileSync(DATA, 'utf8'))); } catch {}
let saveT; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(DATA, JSON.stringify(G), () => {}), 400); };
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/* ---------- game logic ---------- */
const stageRes = st => G.results.filter(r => r.stage === st && r.winner);
const elig = st => { const w = new Set(stageRes(st).map(r => r.winner)); return G.players.filter(p => !w.has(p.id)); };
const bal = id => 1000 - G.results.filter(r => r.winner === id).reduce((a, r) => a + r.price, 0);
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
  const pool = G.pool.items.filter(i => i.stage === r.stage && !i.used);
  if (!pool.length) return 'The pool for this stage is empty.';
  const it = pick(pool); it.used = true;
  const seq = (G.auction ? G.auction.seq : 0) + 1;
  G.auction = { seq, stage: r.stage, state: 'live', name: it.name, img: it.image ? it.id : null, endsAt: Date.now() + r.timer * 1000, bb: r.bb };
  if (e.length === 1) settle(e[0].id);
}

function bid(c, amount) {
  const L = lot(), r = G.room;
  if (!L) return 'No auction is live.';
  if (!c.id || !G.players.some(p => p.id === c.id)) return 'Join the room first.';
  if (Date.now() > L.end) return 'Time’s up.';
  if (stageRes(r.stage).some(x => x.winner === c.id)) return 'You already won this stage.';
  amount = Math.floor(Number(amount));
  const min = L.high ? L.high.amount + 1 : 1;
  if (!Number.isFinite(amount) || amount < min) return 'Minimum bid is ' + min + '.';
  const mx = bal(c.id) - (3 - r.stage);
  if (amount > mx) return 'Max bid is ' + mx + ' (you must reserve coins for later stages).';
  G.bids.push({ seq: L.a.seq, bidder: c.id, amount, ts: Date.now() });
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
      return;
    case 'start':
      if (r.status !== 'lobby') return 'Already started.';
      if (G.players.length !== 10) return 'Exactly 10 trainers are required.';
      if (!G.pool) return 'The pool list hasn’t been submitted yet.';
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
      if (G.pool) G.pool.items.forEach(i => i.used = false); return;
    case 'wipepool': if (r.status !== 'lobby') return 'Reset the draft first.'; G.pool = null; return;
  }
  return 'Unknown action.';
}

/* ---------- http ---------- */
const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_, res) => res.send('ok'));

app.get('/img/:id', (req, res) => {
  const id = req.params.id;
  const shown = G.results.some(r => r.img === id) || (G.auction && G.auction.img === id);
  const it = shown && G.pool && G.pool.items.find(i => i.id === id);
  const m = it && /^data:(image\/[a-z]+);base64,(.*)$/.exec(it.image);
  if (!m) return res.sendStatus(404);
  res.set('Content-Type', m[1]).set('Cache-Control', 'public,max-age=31536000,immutable').send(Buffer.from(m[2], 'base64'));
});

const IMG = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
app.post('/api/pool', (req, res) => {
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
      let image = '';
      if (i.image) { if (!IMG.test(i.image) || i.image.length > 600000) return res.status(400).json({ error: 'Bad image for ' + name }); image = i.image; }
      out.push({ id: crypto.randomUUID(), stage: s, name, image, used: false });
    }
  }
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
      if (p) p.name = name;
      else if (G.room.status !== 'lobby') return fail('The draft has already started.');
      else if (G.players.length >= 10) return fail('The room is full.');
      else G.players.push({ id: c.id, name });
    }
    else if (m.t === 'bid') fail(bid(c, m.amount));
    else if (m.t === 'host') { if (!c.isHost) return fail('Host only.'); fail(host(c, m)); }
    broadcast();
  });
});
setInterval(() => { const L = lot(); if (L && G.room.auto && Date.now() >= L.end) { settle(); broadcast(); } }, 500);
server.listen(PORT, () => console.log('Auction running on port ' + PORT));
