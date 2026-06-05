'use strict';
const fs   = require('fs');
const path = require('path');

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>YAZAKI — CTMB</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: #080808;
  color: #e0e0e0;
  font-family: 'Segoe UI', system-ui, monospace;
  height: 100vh; width: 100vw;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  user-select: none;
}

/* info bar */
#info-bar {
  position: fixed;
  top: 0; left: 0; right: 0;
  display: flex;
  align-items: center;
  padding: 0 16px;
  height: 36px;
  background: rgba(0,0,0,.55);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .06em;
  color: #444;
  z-index: 10;
}
#post-label { color: #666; }
#ct-label   { margin-left: auto; color: #555; }

/* connection dot */
#conn-dot {
  position: fixed; bottom: 10px; right: 12px;
  width: 8px; height: 8px; border-radius: 50%;
  background: #2a2a2a; z-index: 10;
}
#conn-dot.ok   { background: #43a047; box-shadow: 0 0 6px #43a04780; }
#conn-dot.fail { background: #e53935; }

/* center */
.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  gap: 0;
  margin-bottom: 8px;
}

/* reference */
#ref-val {
  font-size: clamp(22px, 4vw, 40px);
  font-weight: 900;
  letter-spacing: .1em;
  color: #333;
  text-align: center;
  margin-bottom: 4px;
  opacity: 0;
  transform: translateY(-12px);
  transition: opacity .4s, transform .4s, color .5s;
}
#ref-val.visible { opacity: 1; transform: translateY(0); }
#ref-val.idle    { color: #333; }
#ref-val.active  { color: #eeeeee; }

/* countdown */
#countdown {
  font-size: clamp(72px, 18vw, 160px);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  letter-spacing: .02em;
  color: #4caf50;
  line-height: 1;
  text-align: center;
  transition: color .4s;
  margin-bottom: 10px;
}
#countdown.warn { color: #ffc107; }
#countdown.red  { color: #f44336; }
#countdown.late { color: #ff6400; }
@keyframes pulse-scale {
  0%,100% { transform: scale(1); }
  50%      { transform: scale(1.04); }
}
#countdown.pulse { animation: pulse-scale .9s ease-in-out infinite; }

/* LED band */
#led-band {
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  gap: 3px;
  width: 100vw;
  padding: 0 6px;
}
.seg {
  height: clamp(40px, 8vh, 80px);
  border-radius: 4px;
  background: #111;
  transform: scaleY(0);
  transform-origin: bottom;
  transition: background .25s;
}
.seg.alive { transform: scaleY(1); transition: background .25s, transform .2s ease-out; }

@keyframes seg-pulse {
  0%,100% { opacity: 1; }
  50%      { opacity: .5; }
}
.seg.pulsing { animation: seg-pulse .55s ease-in-out infinite; }

/* marquee */
#marquee-wrap {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  overflow: hidden;
  height: 36px;
  display: none;
  align-items: center;
  background: rgba(255,100,0,.12);
}
#marquee-wrap.show { display: flex; }
#marquee-inner {
  display: inline-block;
  white-space: nowrap;
  animation: marquee 10s linear infinite;
  font-size: 15px;
  font-weight: 800;
  color: #ff6400;
  letter-spacing: .06em;
}
@keyframes marquee {
  from { transform: translateX(110vw); }
  to   { transform: translateX(-100%); }
}
</style>
</head>
<body>

<div id="info-bar">
  <span id="post-label">POSTE —</span>
  <span id="ct-label"></span>
</div>

<div class="center">
  <div id="ref-val" class="idle">EN ATTENTE</div>
  <div id="countdown">—:——</div>
</div>

<div id="led-band"></div>

<div id="marquee-wrap">
  <div id="marquee-inner">
    RETARD &nbsp;·&nbsp; RETARD &nbsp;·&nbsp; RETARD &nbsp;·&nbsp;
    RETARD &nbsp;·&nbsp; RETARD &nbsp;·&nbsp; RETARD &nbsp;·&nbsp;
    RETARD &nbsp;·&nbsp; RETARD &nbsp;·&nbsp; RETARD
  </div>
</div>

<div id="conn-dot"></div>

<script src="/socket.io/socket.io.js"><\/script>
<script>
'use strict';
const TOTAL_SEGS    = 24;
const LATE_REF_SEGS = 3;
const ACTIVE_SEGS   = 21;

const lineMatch = location.pathname.match(/\\/line\\/(\\d+)\\//);
const lineId    = lineMatch ? lineMatch[1] : '1';
const params    = new URLSearchParams(location.search);
const postId    = +(params.get('post') ?? '1');

document.getElementById('post-label').textContent = 'POSTE ' + postId;

// Build LED segments
const band = document.getElementById('led-band');
const segs  = [];
for (let i = 0; i < TOTAL_SEGS; i++) {
  const s = document.createElement('div');
  s.className = 'seg';
  band.appendChild(s);
  segs.push(s);
}

let ctPost = 0, ctGlobal = 0, startedAt = 0, running = false, rafId = null, wasLate = false;

const socket = io();
socket.emit('join:post', { lineId, postId });
socket.on('connect',    () => dot('ok'));
socket.on('disconnect', () => dot('fail'));

socket.on('harness:new', data => {
  ctPost    = data.ctPost    ?? 0;
  ctGlobal  = data.ctGlobal  ?? 0;
  startedAt = data.startedAt ?? Date.now();
  running   = true;
  wasLate   = false;
  document.getElementById('ct-label').textContent = ctGlobal ? ('CT ' + ctGlobal + 's') : '';
  showRef(data.reference ?? '—');
  document.getElementById('marquee-wrap').classList.remove('show');
  cascadeIn();
  if (rafId) cancelAnimationFrame(rafId);
  rafLoop();
});

socket.on('harness:done', () => {
  running = false; ctPost = 0; startedAt = 0; wasLate = false;
  if (rafId) cancelAnimationFrame(rafId);
  cascadeOut(() => {
    showRef('EN ATTENTE');
    document.getElementById('ref-val').classList.remove('active');
    document.getElementById('ref-val').classList.add('idle');
    document.getElementById('countdown').textContent = '—:——';
    document.getElementById('countdown').className   = '';
    document.getElementById('ct-label').textContent  = '';
    document.getElementById('marquee-wrap').classList.remove('show');
  });
});

function dot(cls) { document.getElementById('conn-dot').className = cls; }

function showRef(text) {
  const el = document.getElementById('ref-val');
  el.classList.remove('visible');
  el.classList.toggle('active', text !== 'EN ATTENTE');
  el.classList.toggle('idle',   text === 'EN ATTENTE');
  setTimeout(() => { el.textContent = text; el.classList.add('visible'); }, 80);
}

function cascadeIn() {
  segs.forEach((s, i) => {
    s.classList.remove('pulsing', 'alive');
    s.style.background = '#111';
    setTimeout(() => s.classList.add('alive'), i * 14);
  });
}

function cascadeOut(cb) {
  const rev = [...segs].reverse();
  rev.forEach((s, i) => {
    setTimeout(() => {
      s.classList.remove('alive', 'pulsing');
      s.style.background = '#111';
    }, i * 12);
  });
  setTimeout(cb, segs.length * 12 + 200);
}

function rafLoop() {
  rafId = requestAnimationFrame(rafLoop);
  if (!running || !ctPost) return;

  const elapsed   = (Date.now() - startedAt) / 1000;
  const ratio     = elapsed / ctPost;
  const remaining = Math.max(0, ctPost - elapsed);
  const cd        = document.getElementById('countdown');

  if (ratio > 1) {
    const over = elapsed - ctPost;
    const oM   = Math.floor(over / 60);
    const oS   = Math.floor(over % 60);
    cd.textContent = '+' + oM + ':' + String(oS).padStart(2, '0');
    cd.className   = 'late';
    document.getElementById('marquee-wrap').classList.add('show');
    paintBand(ratio, true);
    if (!wasLate) {
      wasLate = true;
      segs.slice(LATE_REF_SEGS).forEach(s => s.classList.add('pulsing'));
    }
  } else {
    if (wasLate) { wasLate = false; segs.forEach(s => s.classList.remove('pulsing')); }
    document.getElementById('marquee-wrap').classList.remove('show');
    paintBand(ratio, false);
    const remS = Math.ceil(remaining);
    cd.textContent = Math.floor(remS / 60) + ':' + String(remS % 60).padStart(2, '0');
    if      (ratio < 0.52) cd.className = '';
    else if (ratio < 0.81) cd.className = 'warn';
    else                   cd.className = 'red pulse';
  }
}

function paintBand(ratio, late) {
  const lit = late
    ? ACTIVE_SEGS
    : Math.min(ACTIVE_SEGS, Math.round(Math.max(0, ratio) * ACTIVE_SEGS));

  for (let i = 0; i < TOTAL_SEGS; i++) {
    const posFromRight = TOTAL_SEGS - 1 - i;
    if (i < LATE_REF_SEGS) {
      segs[i].style.background = '#642800';
    } else {
      const active = posFromRight < lit;
      if (!active)      segs[i].style.background = '#111';
      else if (late)    segs[i].style.background = '#ff6400';
      else if (i >= 13) segs[i].style.background = '#4caf50';
      else if (i >= 7)  segs[i].style.background = '#ffc107';
      else              segs[i].style.background = '#f44336';
    }
  }
}

// Restore on reload
(async () => {
  try {
    const state = await fetch('/api/lines/' + lineId + '/posts/' + postId).then(r => r.json());
    if (state.status !== 'active') return;
    ctPost    = state.harness?.ct_post    ?? 0;
    ctGlobal  = state.harness?.ct_global  ?? 0;
    startedAt = state.started_at ?? Date.now();
    running   = true;
    document.getElementById('ct-label').textContent = ctGlobal ? ('CT ' + ctGlobal + 's') : '';
    showRef(state.reference ?? '—');
    segs.forEach(s => s.classList.add('alive'));
    rafLoop();
  } catch (e) {}
})();
<\/script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'public', 'led.html'), html, 'utf8');
console.log('led.html written:', html.length, 'chars');
