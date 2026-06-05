'use strict';
const fs   = require('fs');
const path = require('path');

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YAZAKI \u2014 Accueil</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #f5f5f5;
      font-family: 'Segoe UI', system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 40px;
      padding: 40px 20px;
    }

    header { text-align: center; }
    .logo { font-size: 28px; font-weight: 900; color: #b71c1c; letter-spacing: .1em; }
    .sub  { font-size: 13px; color: #757575; margin-top: 4px; letter-spacing: .04em; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 280px));
      gap: 20px;
      justify-content: center;
      width: 100%;
      max-width: 1200px;
    }

    .screen-card {
      background: #fff;
      border-radius: 14px;
      border: 1px solid #e0e0e0;
      padding: 28px 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .screen-card .title { font-size: 15px; font-weight: 700; color: #212121; }
    .screen-card .desc  { font-size: 13px; color: #757575; line-height: 1.5; flex: 1; }

    .btn-open {
      display: inline-block;
      margin-top: 8px;
      padding: 9px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      text-align: center;
      cursor: pointer;
      border: none;
      font-family: inherit;
    }
    .btn-blue   { background: #1565c0; color: #fff; }
    .btn-dark   { background: #212121; color: #fff; }
    .btn-green  { background: #2e7d32; color: #fff; }
    .btn-purple { background: #6a1b9a; color: #fff; }

    .sel-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .sel-row label {
      font-size: 12px;
      color: #757575;
      font-weight: 600;
      white-space: nowrap;
      min-width: 36px;
    }
    .sel-row select {
      flex: 1;
      padding: 7px 10px;
      border: 1px solid #e0e0e0;
      border-radius: 7px;
      font-size: 13px;
      font-family: inherit;
      background: #fafafa;
      color: #212121;
    }

    .url-hint {
      font-size: 11px;
      color: #bdbdbd;
      font-family: monospace;
      word-break: break-all;
    }
  </style>
</head>
<body>

  <header>
    <div class="logo">YAZAKI</div>
    <div class="sub">Commande Cha\u00eene \u2014 S\u00e9lectionnez un \u00e9cran \u00e0 ouvrir</div>
  </header>

  <div class="grid">

    <!-- Supervision -->
    <div class="screen-card">
      <div class="title">Supervision</div>
      <div class="desc">Vue globale de toutes les lignes, postes et avancements en temps r\u00e9el. Cr\u00e9ation et \u00e9dition des lignes.</div>
      <div class="url-hint" id="url-sup"></div>
      <a href="/supervision.html" target="_blank" class="btn-open btn-purple">Ouvrir</a>
    </div>

    <!-- Administration -->
    <div class="screen-card">
      <div class="title">Administration</div>
      <div class="desc">Biblioth\u00e8que de harnais, file d'attente par ligne, import CSV.</div>
      <div class="url-hint" id="url-admin"></div>
      <a href="/admin.html" target="_blank" class="btn-open btn-blue">Ouvrir</a>
    </div>

    <!-- Operator -->
    <div class="screen-card">
      <div class="title">\u00c9cran op\u00e9rateur</div>
      <div class="desc">Scan badge \u2192 accepter \u2192 travailler \u2192 terminer. Un \u00e9cran par poste.</div>
      <div class="sel-row">
        <label>Ligne</label>
        <select id="sel-op-line">
          <option value="">Chargement\u2026</option>
        </select>
      </div>
      <div class="sel-row">
        <label>Poste</label>
        <select id="sel-op-post">
          <option value="1">1</option><option value="2">2</option>
          <option value="3">3</option><option value="4">4</option>
          <option value="5">5</option><option value="6">6</option>
          <option value="7">7</option><option value="8">8</option>
        </select>
      </div>
      <div class="url-hint" id="url-op"></div>
      <button class="btn-open btn-dark" onclick="openScreen('op')">Ouvrir</button>
    </div>

    <!-- LED CTMB -->
    <div class="screen-card">
      <div class="title">Afficheur LED (CTMB)</div>
      <div class="desc">Bandeau de progression du caden\u00e7age. Plein \u00e9cran, un afficheur par poste.</div>
      <div class="sel-row">
        <label>Ligne</label>
        <select id="sel-led-line">
          <option value="">Chargement\u2026</option>
        </select>
      </div>
      <div class="sel-row">
        <label>Poste</label>
        <select id="sel-led-post">
          <option value="1">1</option><option value="2">2</option>
          <option value="3">3</option><option value="4">4</option>
          <option value="5">5</option><option value="6">6</option>
          <option value="7">7</option><option value="8">8</option>
        </select>
      </div>
      <div class="url-hint" id="url-led"></div>
      <button class="btn-open btn-green" onclick="openScreen('led')">Ouvrir</button>
    </div>

  </div>

  <script>
    const HOST  = window.location.host;
    const PROTO = window.location.protocol;

    document.getElementById('url-sup').textContent   = PROTO + '//' + HOST + '/supervision.html';
    document.getElementById('url-admin').textContent = PROTO + '//' + HOST + '/admin.html';

    // Load lines into both selectors
    async function loadLines() {
      try {
        const lines = await fetch('/api/lines').then(r => r.json());
        ['sel-op-line', 'sel-led-line'].forEach(id => {
          const sel = document.getElementById(id);
          sel.innerHTML = lines.map(l =>
            '<option value="' + l.id + '">' + l.name + '</option>'
          ).join('') || '<option value="1">Ligne 1</option>';
          if (lines.length) sel.value = lines[0].id;
        });
        updateHints();
      } catch {
        ['sel-op-line', 'sel-led-line'].forEach(id => {
          document.getElementById(id).innerHTML = '<option value="1">Ligne 1</option>';
        });
        updateHints();
      }
    }

    function getOpUrl() {
      const line = document.getElementById('sel-op-line').value  || '1';
      const post = document.getElementById('sel-op-post').value  || '1';
      return PROTO + '//' + HOST + '/line/' + line + '/operator.html?post=' + post;
    }

    function getLedUrl() {
      const line = document.getElementById('sel-led-line').value || '1';
      const post = document.getElementById('sel-led-post').value || '1';
      return PROTO + '//' + HOST + '/line/' + line + '/led.html?post=' + post;
    }

    function updateHints() {
      document.getElementById('url-op').textContent  = getOpUrl();
      document.getElementById('url-led').textContent = getLedUrl();
    }

    ['sel-op-line','sel-op-post','sel-led-line','sel-led-post'].forEach(id => {
      document.getElementById(id).addEventListener('change', updateHints);
    });

    function openScreen(type) {
      if (type === 'op') {
        window.open(getOpUrl(), '_blank', 'noopener');
      } else {
        window.open(getLedUrl(), '_blank', 'noopener');
      }
    }

    loadLines();
  </script>

</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), html, 'utf8');
console.log('index.html written:', html.length, 'chars');
