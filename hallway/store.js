// Storage layer: Supabase when SUPABASE_URL + SUPABASE_SERVICE_KEY are set, in-memory otherwise.
const crypto = require('crypto');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const DAY = 864e5;

function memoryStore() {
  const otps = new Map(), sessions = new Map(), reports = new Map(), bans = new Set();
  return {
    kind: 'memory',
    async getOtp(e) { return otps.get(e) || null; },
    async putOtp(e, r) { otps.set(e, r); },
    async delOtp(e) { otps.delete(e); },
    async createSession(h, email, uni) { sessions.set(h, { email, uni, exp: Date.now() + 30 * DAY }); },
    async getSession(h) { const s = sessions.get(h); return s && s.exp > Date.now() ? { email: s.email, uni: s.uni } : null; },
    async isBanned(e) { return bans.has(e); },
    async ban(e) { bans.add(e); },
    async addReport(reported, reporter) {
      const set = reports.get(reported) || new Set(); set.add(reporter); reports.set(reported, set); return set.size;
    },
  };
}

function supabaseStore(url, key) {
  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false } });
  const ok = ({ error, data }) => { if (error) throw error; return data; };
  return {
    kind: 'supabase',
    async getOtp(email) {
      const d = ok(await db.from('otps').select('*').eq('email', email).maybeSingle());
      return d && { code_hash: d.code_hash, exp: Date.parse(d.expires_at), tries: d.tries, last: Date.parse(d.last_sent) };
    },
    async putOtp(email, r) {
      ok(await db.from('otps').upsert({ email, code_hash: r.code_hash, expires_at: new Date(r.exp).toISOString(), tries: r.tries, last_sent: new Date(r.last).toISOString() }));
    },
    async delOtp(email) { ok(await db.from('otps').delete().eq('email', email)); },
    async createSession(hash, email, uni) {
      ok(await db.from('sessions').insert({ token_hash: hash, email, uni, expires_at: new Date(Date.now() + 30 * DAY).toISOString() }));
    },
    async getSession(hash) {
      const d = ok(await db.from('sessions').select('email,uni,expires_at').eq('token_hash', hash).maybeSingle());
      return d && Date.parse(d.expires_at) > Date.now() ? { email: d.email, uni: d.uni } : null;
    },
    async isBanned(email) { return !!ok(await db.from('bans').select('email').eq('email', email).maybeSingle()); },
    async ban(email) { ok(await db.from('bans').upsert({ email })); },
    async addReport(reported, reporter) {
      ok(await db.from('reports').upsert({ reported_email: reported, reporter_email: reporter }));
      const { count, error } = await db.from('reports').select('*', { count: 'exact', head: true }).eq('reported_email', reported);
      if (error) throw error; return count;
    },
  };
}

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const store = SUPABASE_URL && SUPABASE_SERVICE_KEY ? supabaseStore(SUPABASE_URL, SUPABASE_SERVICE_KEY) : memoryStore();
module.exports = { store, sha };
