'use strict';
/**
 * seed-history.js
 * Injects realistic cycle history into yazaki-db.json using real harnesses and real line/post structure.
 * Run once: node seed-history.js
 * Then restart the server for the data to be picked up.
 */
const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'yazaki-db.json');
const STATE   = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

if (!STATE.history) STATE.history = {};

const harnesses = Object.values(STATE.harnesses);
if (!harnesses.length) { console.error('No harnesses found in DB — import data first.'); process.exit(1); }

const lines = Object.values(STATE.lines);
if (!lines.length)    { console.error('No lines found in DB.'); process.exit(1); }

/** Seeded deterministic-ish random based on a counter */
let _seed = 42;
function rng() { _seed = (_seed * 1664525 + 1013904223) & 0xffffffff; return ((_seed >>> 0) / 0xffffffff); }
function randInt(min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

/**
 * Generate a realistic duration around ct_post.
 * ~70% on time (0.65x–1.0x), ~30% late (1.01x–1.6x).
 */
function randomDuration(ct) {
  const late = rng() < 0.30;
  const ratio = late
    ? 1.01 + rng() * 0.59   // 1.01 → 1.60
    : 0.65 + rng() * 0.35;  // 0.65 → 1.00
  return Math.round(ct * ratio * 10) / 10;
}

const CYCLES_PER_POST = 80; // generates 80 cycles per post spread over last 8 hours
const now = Date.now();
const span = 8 * 60 * 60 * 1000; // 8 hours in ms

let totalInjected = 0;

for (const line of lines) {
  const lid = String(line.id);
  if (!STATE.history[lid]) STATE.history[lid] = [];

  for (let postId = 1; postId <= line.posts; postId++) {
    for (let i = 0; i < CYCLES_PER_POST; i++) {
      const h   = pick(harnesses);
      const ts  = now - span + Math.floor((i / CYCLES_PER_POST) * span) + randInt(0, 60000);
      const dur = randomDuration(h.ct_post);
      STATE.history[lid].push({
        postId,
        reference: h.reference,
        ct_post:   h.ct_post,
        duration:  dur,
        ts
      });
    }
  }

  // Sort by timestamp
  STATE.history[lid].sort((a, b) => a.ts - b.ts);
  // Cap at 2000
  if (STATE.history[lid].length > 2000) STATE.history[lid].splice(0, STATE.history[lid].length - 2000);

  totalInjected += line.posts * CYCLES_PER_POST;
  console.log(`Line "${line.name}" (id=${lid}): injected ${line.posts * CYCLES_PER_POST} cycles across ${line.posts} posts`);
}

fs.writeFileSync(DB_FILE, JSON.stringify(STATE, null, 2), 'utf8');
console.log(`\nDone. Total cycles injected: ${totalInjected}`);
console.log('Now restart the server: node server.js');
