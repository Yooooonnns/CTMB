'use strict';

const { app, BrowserWindow } = require('electron');
const { io }                  = require('socket.io-client');

const SERVER_URL = process.env.YAZAKI_NODE_SERVER_URL || 'http://localhost:8080';

let win = null;

// ── Window ────────────────────────────────────────────────────────────────────

function createOrUpdateWindow(lineId, postId) {
  const url = `${SERVER_URL}/line/${lineId}/led.html?post=${postId}`;

  // Already open → just navigate and bring to front
  if (win && !win.isDestroyed()) {
    win.loadURL(url);
    if (win.isMinimized()) win.restore();
    win.focus();
    return;
  }

  win = new BrowserWindow({
    width:           900,
    height:          700,
    frame:           false,   // borderless — no OS title bar
    resizable:       true,
    show:            false,   // reveal only when ready (avoids white flash)
    backgroundColor: '#111111',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  win.loadURL(url);

  // Show as soon as content is painted
  win.once('ready-to-show', () => win.show());

  win.webContents.on('did-finish-load', () => {
    // Make the background draggable so the user can reposition the window,
    // but keep all interactive elements (buttons, canvas, etc.) clickable.
    win.webContents.insertCSS(
      'body { -webkit-app-region: drag; }' +
      'button, input, select, a, canvas, svg,' +
      '[onclick], [role="button"], [tabindex] { -webkit-app-region: no-drag; }'
    );

  });

  win.on('closed', () => { win = null; });
}

// ── Socket.io ─────────────────────────────────────────────────────────────────

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  const socket = io(SERVER_URL, {
    reconnection:         true,
    reconnectionAttempts: Infinity,
    reconnectionDelay:    2000,
  });

  socket.on('connect', () => {
    console.log(`[CTMB] Connected to ${SERVER_URL} — joining wpf-managers`);
    socket.emit('join:wpf-manager');
  });

  socket.on('ctmb:open', ({ lineId, postId }) => {
    console.log(`[CTMB] ctmb:open  line=${lineId}  post=${postId}`);
    createOrUpdateWindow(lineId, postId);
  });

  socket.on('disconnect', reason => {
    console.log(`[CTMB] Disconnected (${reason}) — will reconnect automatically`);
  });

  console.log(`[CTMB] Waiting for ctmb:open events from ${SERVER_URL} …`);
});

// Keep the process alive with no window so it can respond to the next event.
app.on('window-all-closed', () => { /* intentional no-op */ });
