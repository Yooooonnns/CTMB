'use strict';
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const fs      = require('fs');
const { spawn } = require('child_process');


const PORT    = process.env.PORT || 8080;
const DB_FILE = path.join(__dirname, 'yazaki-db.json');

let STATE;
try { STATE = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
catch { STATE = { lines: {}, harnesses: {}, queues: {}, sessions: {} }; }

if (!STATE.lines)      STATE.lines      = {};
if (!STATE.harnesses)  STATE.harnesses  = {};
if (!STATE.queues)     STATE.queues     = {};
if (!STATE.sessions)   STATE.sessions   = {};
if (!STATE.lateStats)  STATE.lateStats  = {};
if (!STATE.history)    STATE.history    = {};
if (!STATE.lineAlerts) STATE.lineAlerts = {}; // { [lineId]: { status:'normal'|'yellow'|'red' } } 


if (STATE.queue) {
  if (!STATE.queues['1']) STATE.queues['1'] = STATE.queue;
  delete STATE.queue;
}
const sKeys = Object.keys(STATE.sessions);
if (sKeys.length && !sKeys[0].includes(':')) {
  const old = { ...STATE.sessions };
  STATE.sessions = {};
  for (const [pid, s] of Object.entries(old)) {
    STATE.sessions[`1:${pid}`] = { ...s, line_id: 1 };
  }
}

function persist() { fs.writeFile(DB_FILE, JSON.stringify(STATE, null, 2), 'utf8', err => { if (err) console.error('[persist] write error:', err); }); }

// ── MISTAKE_DB: load per-reference mistake details from Classeur2.xlsx ────────
const MISTAKE_DB = {};
try {
  const XLSX = require('xlsx');
  const xlPath = 'C:/Users/youne/Desktop/projects/YAZAKI/commandeChaine/Yazaki.CommandeChaine/publish-desktop/Classeur2.xlsx';
  const wb = XLSX.readFile(xlPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const ref = row[0];
    if (!ref) continue;
    const key = String(ref).trim().toUpperCase();
    if (!MISTAKE_DB[key]) MISTAKE_DB[key] = [];
    MISTAKE_DB[key].push({
      type:  String(row[2] || '').trim(),
      wire1: String(row[3] || '').trim(),
      wire2: String(row[4] || '').trim(),
      con1:  String(row[5] || '').trim(),
      con2:  String(row[6] || '').trim(),
      con3:  String(row[7] || '').trim(),
      con4:  String(row[8] || '').trim()
    });
  }
  console.log(`MISTAKE_DB: ${Object.keys(MISTAKE_DB).length} references chargees`);
} catch (e) {
  console.warn('MISTAKE_DB non chargee:', e.message);
}


function mqttPublishCT(lineId, ctGlobal, active) {}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.json());

// Serve /line/:lineId/operator.html and /line/:lineId/led.html
app.get('/line/:lineId/:page', (req, res) => {
  const allowed = ['operator.html', 'led.html'];
  if (!allowed.includes(req.params.page)) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', req.params.page));
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Lines ─────────────────────────────────────────────────────────────────────
app.get('/api/lines', (_, res) =>
  res.json(Object.values(STATE.lines).sort((a, b) => a.id - b.id)));

app.post('/api/lines', (req, res) => {
  const { id, name, posts } = req.body;
  const lid = id ? String(+id) : String(Math.max(0, ...Object.keys(STATE.lines).map(Number)) + 1);
  STATE.lines[lid] = { id: +lid, name: (name || '').trim() || `Ligne ${lid}`, posts: +posts || 4 };
  if (!STATE.queues[lid]) STATE.queues[lid] = [];
  persist();
  io.emit('lines:updated');
  res.json({ ok: true, line: STATE.lines[lid] });
});

app.put('/api/lines/:id', (req, res) => {
  const lid = String(+req.params.id);
  if (!STATE.lines[lid]) return res.status(404).json({ error: 'Line not found' });
  const { name, posts } = req.body;
  if (name !== undefined) STATE.lines[lid].name  = (name || '').trim() || STATE.lines[lid].name;
  if (posts !== undefined) STATE.lines[lid].posts = +posts || STATE.lines[lid].posts;
  persist();
  io.emit('lines:updated');
  res.json({ ok: true, line: STATE.lines[lid] });
});

app.delete('/api/lines/:id', (req, res) => {
  const lid = String(+req.params.id);
  delete STATE.lines[lid];
  delete STATE.queues[lid];
  for (const k of Object.keys(STATE.sessions)) {
    if (k.startsWith(`${lid}:`)) delete STATE.sessions[k];
  }
  persist();
  io.emit('lines:updated');
  res.json({ ok: true });
});

// ── Harness library ───────────────────────────────────────────────────────────
app.get('/api/harnesses', (_, res) =>
  res.json(Object.values(STATE.harnesses).sort((a, b) => a.reference.localeCompare(b.reference))));

app.post('/api/harnesses', (req, res) => {
  const { reference, ct_global, ct_post, mistakes } = req.body;
  if (!reference?.trim()) return res.status(400).json({ error: 'reference required' });
  const ref = reference.trim().toUpperCase();
  const randCt = () => Math.floor(Math.random() * 21) + 60; // 60–80s
  STATE.harnesses[ref] = { reference: ref, ct_global: +ct_global || randCt(), ct_post: +ct_post || randCt(), mistakes: Array.isArray(mistakes) ? mistakes : [] };
  persist();
  res.json({ ok: true });
});

app.delete('/api/harnesses/:ref', (req, res) => {
  delete STATE.harnesses[req.params.ref];
  persist();
  res.json({ ok: true });
});

// ── Import harnesses from Excel ───────────────────────────────────────────────
app.post('/api/import-excel', (req, res) => {
  try {
    const XLSX = require('xlsx');
    const xlFile = 'C:/Users/youne/Desktop/projects/YAZAKI/commandeChaine/publish-desktop/Classeur2.xlsx';
    const wb = XLSX.readFile(xlFile);
    const ws = wb.Sheets['Feuil1'];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // Group by reference — collect CT values and mistakes
    const harnesses = {};
    for (let i = 1; i < rows.length; i++) {
      const ref        = rows[i][0];
      const incident   = rows[i][1];
      const ctGlobal   = rows[i][2];
      const ctPost     = rows[i][3];
      if (!ref) continue;
      const key = String(ref).trim().toUpperCase();
      if (!harnesses[key]) {
        harnesses[key] = {
          reference: key,
          ct_global: +ctGlobal || (Math.floor(Math.random() * 21) + 60),
          ct_post:   +ctPost   || (Math.floor(Math.random() * 21) + 60),
          mistakes:  []
        };
      }
      if (incident && incident !== 'Incident Type') {
        harnesses[key].mistakes.push(String(incident));
      }
    }

    let created = 0;
    let updated  = 0;
    for (const [key, data] of Object.entries(harnesses)) {
      if (STATE.harnesses[key]) updated++; else created++;
      STATE.harnesses[key] = data;
    }
    persist();
    io.emit('supervision:update');
    res.json({ ok: true, total: Object.keys(harnesses).length, created, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Queue (per line) ──────────────────────────────────────────────────────────
function enrich(queue) {
  return queue.slice().sort((a, b) => a.position - b.position).map(q => {
    const h = STATE.harnesses[q.reference];
    return { ...q, ct_global: h?.ct_global ?? null, ct_post: h?.ct_post ?? null, mistakes: h?.mistakes ?? [] };
  });
}

app.get('/api/lines/:lid/queue', (req, res) => {
  const lid = String(+req.params.lid);
  res.json(enrich(STATE.queues[lid] || []));
});

app.post('/api/lines/:lid/queue', (req, res) => {
  const lid = String(+req.params.lid);
  // Preserve active/done items — only replace pending ones
  const preserved = (STATE.queues[lid] || []).filter(q => q.status !== 'pending');
  const newPending = (req.body.items || []).map((item, i) => ({
    position: item.position ?? i, reference: item.reference, status: 'pending'
  }));
  STATE.queues[lid] = [...preserved, ...newPending];
  persist();
  io.emit(`queue:updated:${lid}`);
  io.emit('supervision:update');
  res.json({ ok: true });
});

app.delete('/api/lines/:lid/queue', (req, res) => {
  const lid = String(+req.params.lid);
  if (STATE.queues[lid]) STATE.queues[lid] = STATE.queues[lid].filter(q => q.status !== 'pending');
  persist();
  io.emit(`queue:updated:${lid}`);
  res.json({ ok: true });
});

// Legacy global queue (still used by old admin if no lineId)
app.get('/api/queue', (_, res) => res.json(enrich(STATE.queues['1'] || [])));
app.post('/api/queue', (req, res) => {
  STATE.queues['1'] = (req.body.items || []).map((item, i) => ({ position: item.position ?? i, reference: item.reference, status: 'pending' }));
  persist();
  io.emit('queue:updated:1');
  io.emit('supervision:update');
  res.json({ ok: true });
});
app.delete('/api/queue', (_, res) => {
  if (STATE.queues['1']) STATE.queues['1'] = STATE.queues['1'].filter(q => q.status !== 'pending');
  persist();
  io.emit('queue:updated:1');
  res.json({ ok: true });
});

// ── Post sessions ─────────────────────────────────────────────────────────────
const sk = (lid, pid) => `${lid}:${pid}`;

app.get('/api/lines/:lid/posts/:pid', (req, res) => {
  const lid = String(+req.params.lid), pid = String(+req.params.pid);
  const s = STATE.sessions[sk(lid, pid)] ?? { line_id: +lid, post_id: +pid, status: 'idle', reference: null, operator_id: null, started_at: null };
  const h = s.reference ? (STATE.harnesses[s.reference] ?? null) : null;
  const mistakeDetails = s.reference ? (MISTAKE_DB[s.reference] || []) : [];
  const elapsedMs = s.started_at ? Math.max(0, Date.now() - s.started_at) : 0;
  res.json({ ...s, harness: h, mistakeDetails, elapsedMs });
});

app.post('/api/lines/:lid/posts/:pid/accept', (req, res) => {
  const lid = String(+req.params.lid), pid = String(+req.params.pid);
  const key = sk(lid, pid);
  const operatorId = req.body.operator_id || null;
  if (STATE.sessions[key]?.status === 'active') return res.status(400).json({ error: 'Harnais deja en cours' });
  const queue = STATE.queues[lid] || [];
  const next  = queue.filter(q => q.status === 'pending').sort((a, b) => a.position - b.position)[0];
  if (!next) return res.status(404).json({ error: 'Aucun harnais disponible' });
  const h = STATE.harnesses[next.reference];
  const now = Date.now();
  next.status = 'active';
  STATE.sessions[key] = { line_id: +lid, post_id: +pid, operator_id: operatorId, reference: next.reference, queue_pos: next.position, started_at: now, status: 'active' };
  persist();
  const payload = { lineId: +lid, postId: +pid, reference: next.reference, ctGlobal: h?.ct_global ?? 60, ctPost: h?.ct_post ?? 60, mistakes: h?.mistakes ?? [], mistakeDetails: MISTAKE_DB[next.reference] || [], startedAt: now, elapsedMs: 0 };
  io.to(`line:${lid}:post:${pid}`).emit('harness:new', payload);
  io.emit('raspberry:target', { ctGlobal: payload.ctGlobal });
  mqttPublishCT(+lid, payload.ctGlobal, true);
  io.emit('supervision:update');
  res.json(payload);
});

app.post('/api/lines/:lid/posts/:pid/done', (req, res) => {
  const lid = String(+req.params.lid), pid = String(+req.params.pid);
  const key = sk(lid, pid);
  const s   = STATE.sessions[key];
  if (!s || s.status !== 'active') return res.status(400).json({ error: 'Aucun harnais actif' });

  const lineObj  = STATE.lines[lid];
  const numPosts = lineObj ? lineObj.posts : 1;
  const curPost  = +pid;
  const nextPost = curPost + 1;
  const isLast   = nextPost > numPosts;

  // Track late stats + history
  const finishedH = STATE.harnesses[s.reference];
  const now       = Date.now();
  if (finishedH && s.started_at) {
    if (!STATE.lateStats[key]) STATE.lateStats[key] = { late: 0, total: 0 };
    const duration = (now - s.started_at) / 1000;
    STATE.lateStats[key].total++;
    if (duration > finishedH.ct_post) STATE.lateStats[key].late++;
    if (!STATE.history[lid]) STATE.history[lid] = [];
    STATE.history[lid].push({ postId: curPost, reference: s.reference, ct_post: finishedH.ct_post, duration: Math.round(duration * 10) / 10, ts: now });
    if (STATE.history[lid].length > 2000) STATE.history[lid].splice(0, STATE.history[lid].length - 2000);
  }

  const doneRef      = s.reference;
  const doneQueuePos = s.queue_pos;
  const doneOpId     = s.operator_id;

  // Clear current post
  STATE.sessions[key] = { line_id: +lid, post_id: curPost, status: 'idle', reference: null, operator_id: null, started_at: null };
  io.to(`line:${lid}:post:${pid}`).emit('harness:done', { lineId: +lid, postId: curPost });

  if (isLast) {
    // Harness completed the full line — mark queue item done
    const queue = STATE.queues[lid] || [];
    const qItem = queue.find(q => q.position === doneQueuePos);
    if (qItem) qItem.status = 'done';
  } else {
    // JIG moves to next post — auto-start session there
    const nextKey = sk(lid, String(nextPost));
    STATE.sessions[nextKey] = { line_id: +lid, post_id: nextPost, operator_id: null, reference: doneRef, queue_pos: doneQueuePos, started_at: now, status: 'active' };
    const h = STATE.harnesses[doneRef];
    const nextPayload = { lineId: +lid, postId: nextPost, reference: doneRef, ctGlobal: h?.ct_global ?? 60, ctPost: h?.ct_post ?? 60, mistakes: h?.mistakes ?? [], mistakeDetails: MISTAKE_DB[doneRef] || [], startedAt: now, elapsedMs: 0 };
    io.to(`line:${lid}:post:${String(nextPost)}`).emit('harness:new', nextPayload);
  }

  persist();
  io.emit('supervision:update');
  const queue = STATE.queues[lid] || [];
  res.json({ ok: true, hasNext: queue.some(q => q.status === 'pending') });
});

// Legacy post routes (for backward compat)
app.get('/api/posts/:pid', (req, res) => {
  const pid = String(+req.params.pid);
  const s = STATE.sessions[sk('1', pid)] ?? { post_id: +pid, status: 'idle', reference: null, operator_id: null, started_at: null };
  const h = s.reference ? (STATE.harnesses[s.reference] ?? null) : null;
  res.json({ ...s, harness: h });
});
app.post('/api/posts/:pid/accept', (req, res) => {
  req.params.lid = '1'; req.params.pid = req.params.pid;
  const lid = '1', pid = String(+req.params.pid), key = sk(lid, pid);
  const operatorId = req.body.operator_id || null;
  if (STATE.sessions[key]?.status === 'active') return res.status(400).json({ error: 'Harnais deja en cours' });
  const queue = STATE.queues[lid] || [];
  const next  = queue.filter(q => q.status === 'pending').sort((a, b) => a.position - b.position)[0];
  if (!next) return res.status(404).json({ error: 'Aucun harnais disponible' });
  const h = STATE.harnesses[next.reference]; const now = Date.now();
  next.status = 'active';
  STATE.sessions[key] = { line_id: 1, post_id: +pid, operator_id: operatorId, reference: next.reference, queue_pos: next.position, started_at: now, status: 'active' };
  persist();
  const payload = { lineId: 1, postId: +pid, reference: next.reference, ctGlobal: h?.ct_global ?? 60, ctPost: h?.ct_post ?? 60, mistakes: h?.mistakes ?? [], mistakeDetails: MISTAKE_DB[next.reference] || [], startedAt: now };
  io.to(`line:${lid}:post:${pid}`).emit('harness:new', payload);
  io.to(`post:${pid}`).emit('harness:new', payload);
  io.emit('raspberry:target', { ctGlobal: payload.ctGlobal });
  mqttPublishCT(1, payload.ctGlobal, true);
  io.emit('supervision:update');
  res.json(payload);
});
app.post('/api/posts/:pid/done', (req, res) => {
  const lid = '1', pid = String(+req.params.pid), key = sk(lid, pid);
  const s = STATE.sessions[key];
  if (!s || s.status !== 'active') return res.status(400).json({ error: 'Aucun harnais actif' });

  const lineObj  = STATE.lines[lid];
  const numPosts = lineObj ? lineObj.posts : 1;
  const curPost  = +pid;
  const nextPost = curPost + 1;
  const isLast   = nextPost > numPosts;

  const finishedH = STATE.harnesses[s.reference];
  const now = Date.now();
  if (finishedH && s.started_at) {
    if (!STATE.lateStats[key]) STATE.lateStats[key] = { late: 0, total: 0 };
    const duration = (now - s.started_at) / 1000;
    STATE.lateStats[key].total++;
    if (duration > finishedH.ct_post) STATE.lateStats[key].late++;
    if (!STATE.history[lid]) STATE.history[lid] = [];
    STATE.history[lid].push({ postId: curPost, reference: s.reference, ct_post: finishedH.ct_post, duration: Math.round(duration * 10) / 10, ts: now });
    if (STATE.history[lid].length > 2000) STATE.history[lid].splice(0, STATE.history[lid].length - 2000);
  }

  const doneRef = s.reference, doneQueuePos = s.queue_pos, doneOpId = s.operator_id;

  STATE.sessions[key] = { line_id: 1, post_id: curPost, status: 'idle', reference: null, operator_id: null, started_at: null };
  io.to(`line:${lid}:post:${pid}`).emit('harness:done', { lineId: 1, postId: curPost });
  io.to(`post:${pid}`).emit('harness:done', { postId: curPost });

  if (isLast) {
    const queue = STATE.queues[lid] || [];
    const qItem = queue.find(q => q.position === doneQueuePos);
    if (qItem) qItem.status = 'done';
  } else {
    const nextKey = sk(lid, String(nextPost));
    STATE.sessions[nextKey] = { line_id: 1, post_id: nextPost, operator_id: null, reference: doneRef, queue_pos: doneQueuePos, started_at: now, status: 'active' };
    const h = STATE.harnesses[doneRef];
    const nextPayload = { lineId: 1, postId: nextPost, reference: doneRef, ctGlobal: h?.ct_global ?? 60, ctPost: h?.ct_post ?? 60, mistakes: h?.mistakes ?? [], mistakeDetails: MISTAKE_DB[doneRef] || [], startedAt: now };
    io.to(`line:${lid}:post:${String(nextPost)}`).emit('harness:new', nextPayload);
    io.to(`post:${String(nextPost)}`).emit('harness:new', nextPayload);
  }

  persist();
  io.emit('supervision:update');
  const queue = STATE.queues[lid] || [];
  res.json({ ok: true, hasNext: queue.some(q => q.status === 'pending') });
});

// ── Supervision snapshot ──────────────────────────────────────────────────────
app.get('/api/supervision', (_, res) => {
  const lines = Object.values(STATE.lines).sort((a, b) => a.id - b.id).map(line => {
    const lid   = String(line.id);
    const queue = STATE.queues[lid] || [];
    const posts = [];
    for (let p = 1; p <= line.posts; p++) {
      const s = STATE.sessions[sk(lid, String(p))] ?? { status: 'idle' };
      const h = s.reference ? STATE.harnesses[s.reference] : null;
      posts.push({ post_id: p, status: s.status || 'idle', reference: s.reference || null, started_at: s.started_at || null, operator_id: s.operator_id || null, ct_post: h?.ct_post ?? null, ct_global: h?.ct_global ?? null, lateStats: STATE.lateStats[sk(lid, String(p))] ?? { late: 0, total: 0 } });
    }
    const activePost = posts.find(p => p.status === 'active');
    const activeCt   = activePost ? { ct_global: activePost.ct_global, ct_post: activePost.ct_post, started_at: activePost.started_at, reference: activePost.reference } : null;
    return { ...line, posts, stats: { total: queue.length, done: queue.filter(q => q.status === 'done').length, active: queue.filter(q => q.status === 'active').length, pending: queue.filter(q => q.status === 'pending').length }, activeCt };
  });
  res.json(lines);
});

// ── Raspberry target ──────────────────────────────────────────────────────────
app.get('/api/raspberry/target', (_, res) => {
  let ctGlobal = 0;
  for (const q of Object.values(STATE.queues)) {
    const a = q.find(i => i.status === 'active');
    if (a) { ctGlobal = STATE.harnesses[a.reference]?.ct_global ?? 0; break; }
  }
  res.json({ ctGlobal });
});

// ── Dashboard ───────────────────────────────────────────────────────────────
app.get('/api/lines/:lid/dashboard', (req, res) => {
  const lid  = String(+req.params.lid);
  const line = STATE.lines[lid];
  if (!line) return res.status(404).json({ error: 'Line not found' });

  const history = STATE.history[lid] || [];
  const numPosts = line.posts;

  // Build per-post stats
  const posts = [];
  for (let p = 1; p <= numPosts; p++) {
    const cycles = history.filter(h => h.postId === p);
    const late   = cycles.filter(h => h.duration > h.ct_post);
    const avgCt  = cycles.length ? Math.round(cycles.reduce((s, h) => s + h.duration, 0) / cycles.length * 10) / 10 : null;
    const avgRef = cycles.length ? Math.round(cycles.reduce((s, h) => s + h.ct_post,  0) / cycles.length * 10) / 10 : null;
    const avgDelay = late.length ? Math.round(late.reduce((s, h) => s + (h.duration - h.ct_post), 0) / late.length * 10) / 10 : 0;
    // Last 50 for evolution chart
    const evolution = cycles.slice(-50).map(h => ({ ts: h.ts, duration: h.duration, ct_post: h.ct_post, reference: h.reference }));
    posts.push({
      postId: p,
      total: cycles.length,
      lateCount: late.length,
      lateRate: cycles.length ? Math.round(late.length / cycles.length * 1000) / 10 : 0,
      avgCt,
      avgRef,
      avgDelay,
      evolution
    });
  }

  // Global evolution (last 200, all posts)
  const globalEvolution = history.slice(-200);

  res.json({ lineId: +lid, lineName: line.name, posts, globalEvolution });
});

app.get('/api/lines/:lid/history', (req, res) => {
  const lid = String(+req.params.lid);
  if (!STATE.lines[lid]) return res.status(404).json({ error: 'Line not found' });
  const postId = req.query.post ? +req.query.post : null;
  let history = STATE.history[lid] || [];
  if (postId) history = history.filter(h => h.postId === postId);
  res.json(history);
});

// ── Line alert (ampoules) ─────────────────────────────────────────────────────
app.get('/api/lines/:lid/alert', (req, res) => {
  const lid = String(+req.params.lid);
  res.json(STATE.lineAlerts[lid] || { status: 'normal' });
});

app.post('/api/lines/:lid/alert', (req, res) => {
  const lid    = String(+req.params.lid);
  const status = ['normal', 'yellow', 'red'].includes(req.body.status) ? req.body.status : 'normal';
  STATE.lineAlerts[lid] = { status };
  persist();
  io.emit('line:alert', { lineId: +lid, status });
  res.json({ ok: true, status });
});

app.get('/api/stats', (_, res) => {
  let total = 0, done = 0, active = 0, pending = 0;
  for (const q of Object.values(STATE.queues)) {
    total   += q.length;
    done    += q.filter(i => i.status === 'done').length;
    active  += q.filter(i => i.status === 'active').length;
    pending += q.filter(i => i.status === 'pending').length;
  }
  res.json({ total, done, active, pending });
});

// ── CTMB: open WPF window from browser ──────────────────────────────────────
// The browser POSTs here; we relay via Socket.io to any connected WPF app.
app.post('/api/ctmb/open', (req, res) => {
  const { lineId, postId } = req.body;
  const room = io.sockets.adapter.rooms.get('wpf-managers');
  if (!room || room.size === 0) {
    return res.status(503).json({ ok: false });
  }
  io.to('wpf-managers').emit('ctmb:open', { lineId: +lineId, postId: +postId });
  res.json({ ok: true });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  // New line-aware room join
  socket.on('join:post',  ({ lineId, postId }) => socket.join(`line:${+lineId}:post:${+postId}`));
  socket.on('leave:post', ({ lineId, postId }) => socket.leave(`line:${+lineId}:post:${+postId}`));
  // Legacy (no lineId) — assume line 1
  socket.on('join:post:legacy',  postId => { socket.join(`post:${+postId}`); socket.join(`line:1:post:${+postId}`); });
  socket.on('leave:post:legacy', postId => { socket.leave(`post:${+postId}`); socket.leave(`line:1:post:${+postId}`); });
  socket.on('join:supervision',  () => socket.join('supervision'));
  socket.on('leave:supervision', () => socket.leave('supervision'));
  // WPF desktop app registers here to receive ctmb:open commands
  socket.on('join:wpf-manager', () => socket.join('wpf-managers'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nYAZAKI System running on port ${PORT}`);
  console.log(`  Local   : http://localhost:${PORT}`);
  console.log(`  Réseau  : http://172.18.64.1:${PORT}`);
  console.log('');

  const ctmbDir = path.join(__dirname, 'ctmb-display');
  const electronBin = path.join(ctmbDir, 'node_modules', '.bin', 'electron.cmd');
  const electron = spawn(electronBin, ['.'], {
    cwd: ctmbDir,
    shell: true,
    detached: true,
    stdio: 'ignore'
  });
  electron.unref();
  console.log('CTMB Display launched.');
});