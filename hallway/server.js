// Hallway: signaling + matching + email-domain verification
require('dotenv').config();
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { store, sha } = require('./store');
const { sendOtp } = require('./mailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());
app.use(express.static('public'));

const PROD = process.env.NODE_ENV === 'production';
// Accepts .edu, *.ac.xx, *.edu.xx. Add more with EXTRA_DOMAINS=indusuni.ac.in,foo.org
const DOMAIN_OK = /\.(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/i;
const EXTRA = (process.env.EXTRA_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean);
const okDomain = d => DOMAIN_OK.test(d) || EXTRA.includes(d);


// ---------- Auth ----------
app.post('/api/otp', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
    if (!okDomain(email.split('@')[1])) return res.status(403).json({ error: 'Use your university email (.edu, .ac.in, etc.).' });
    if (await store.isBanned(email)) return res.status(403).json({ error: 'This account is banned.' });
    const prev = await store.getOtp(email);
    if (prev && Date.now() - prev.last < 30000) return res.status(429).json({ error: 'Wait 30s before asking for a new code.' });
    const code = String(crypto.randomInt(100000, 999999));
    await store.putOtp(email, { code_hash: sha(code), exp: Date.now() + 10 * 60000, tries: 0, last: Date.now() });
    const r = await sendOtp(email, code);
    res.json({ ok: true, dev: r.dev });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not send the email. Try again in a minute.' }); }
});

app.post('/api/verify', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const rec = await store.getOtp(email);
    if (!rec || rec.exp < Date.now()) return res.status(400).json({ error: 'Code expired. Ask for a new one.' });
    if (rec.tries >= 5) { await store.delOtp(email); return res.status(429).json({ error: 'Too many tries. Ask for a new code.' }); }
    if (sha(String(req.body.code)) !== rec.code_hash) {
      await store.putOtp(email, { ...rec, tries: rec.tries + 1 });
      return res.status(400).json({ error: 'Wrong code.' });
    }
    await store.delOtp(email);
    const token = crypto.randomBytes(24).toString('hex');
    const uni = email.split('@')[1];
    await store.createSession(sha(token), email, uni);
    res.json({ token, uni });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error. Try again.' }); }
});

// STUN is free. For reliable calls add a TURN server (coturn / Metered / Twilio).
app.get('/api/ice', (_req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) iceServers.push({ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  res.json({ iceServers });
});

// ---------- Matching + signaling ----------
io.use(async (s, next) => {
  try {
    const t = s.handshake.auth && s.handshake.auth.token;
    const u = t && await store.getSession(sha(t));
    if (!u) return next(new Error('auth'));
    if (await store.isBanned(u.email)) return next(new Error('banned'));
    s.user = u; next();
  } catch (e) { console.error(e); next(new Error('server')); }
});

let queue = [];
const online = () => io.emit('online', io.engine.clientsCount);

function allows(a, b) {
  const same = a.user.uni === b.user.uni;
  const ok = x => x.scope === 'any' || (x.scope === 'same' && same) || (x.scope === 'other' && !same);
  return a.user.email !== b.user.email && ok(a) && ok(b);
}
const overlap = (a, b) => a.interests.filter(i => b.interests.includes(i)).length;

function leave(s) {
  queue = queue.filter(q => q !== s);
  const p = s.partner;
  if (p) { p.partner = null; p.wants = false; p.emit('partner-left'); }
  s.partner = null; s.wants = false;
}

function find(s) {
  leave(s);
  const cands = queue.filter(q => allows(s, q)).sort((a, b) => overlap(s, b) - overlap(s, a));
  const p = cands[0];
  if (!p) { queue.push(s); return s.emit('searching'); }
  queue = queue.filter(q => q !== p);
  s.partner = p; p.partner = s;
  const info = x => ({ uni: x.user.uni, interests: x.interests });
  s.emit('matched', { initiator: true, peer: info(p) });
  p.emit('matched', { initiator: false, peer: info(s) });
}

io.on('connection', s => {
  s.interests = []; s.scope = 'any'; s.handle = '';
  online();

  s.on('find', ({ scope, interests, handle } = {}) => {
    s.scope = ['same', 'other', 'any'].includes(scope) ? scope : 'any';
    s.interests = (interests || []).slice(0, 5).map(i => String(i).toLowerCase().slice(0, 20));
    s.handle = String(handle || '').slice(0, 40);
    find(s);
  });
  s.on('signal', d => s.partner && s.partner.emit('signal', d));
  s.on('chat', m => s.partner && s.partner.emit('chat', String(m).slice(0, 500)));
  s.on('skip', () => leave(s));

  s.on('connect-me', () => {
    const p = s.partner; if (!p) return;
    s.wants = true;
    if (p.wants) {
      s.emit('connected', { handle: p.handle || '(no handle shared)' });
      p.emit('connected', { handle: s.handle || '(no handle shared)' });
    } else p.emit('partner-wants-connect');
  });

  s.on('report', async () => {
    const p = s.partner; if (!p) return;
    leave(s);
    try {
      const n = await store.addReport(p.user.email, s.user.email);
      if (n >= 3) { await store.ban(p.user.email); p.emit('banned'); p.disconnect(true); }
    } catch (e) { console.error(e); }
  });

  s.on('disconnect', () => { leave(s); online(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Hallway on http://localhost:${PORT} (storage: ${store.kind})`));
