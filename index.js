const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const express = require('express');
const http = require('http');
const https = require('https');

const config = require('./settings.json');

const app = express();
const PORT = process.env.PORT || 5000;

let bot = null;
let reconnectTimeout = null;
let isReconnecting = false;
let activeIntervals = [];

const botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: []
};

// ============================================================
// DASHBOARD
// ============================================================

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>${config.name || 'Minecraft AFK Bot'}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #0f172a;
      color: white;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
    }

    .container {
      width: 90%;
      max-width: 500px;
      background: #1e293b;
      padding: 30px;
      border-radius: 18px;
      text-align: center;
      box-shadow: 0 0 35px rgba(45,212,191,.2);
    }

    h1 {
      color: #ccfbf1;
    }

    .card {
      background: #0f172a;
      padding: 15px;
      margin: 12px 0;
      border-radius: 10px;
      text-align: left;
    }

    .label {
      color: #94a3b8;
      font-size: 12px;
      text-transform: uppercase;
    }

    .value {
      color: #2dd4bf;
      font-size: 18px;
      font-weight: bold;
      margin-top: 5px;
    }

    a {
      display: inline-block;
      margin-top: 15px;
      padding: 10px 20px;
      background: #2dd4bf;
      color: #0f172a;
      border-radius: 8px;
      text-decoration: none;
      font-weight: bold;
    }
  </style>
</head>

<body>
<div class="container">

  <h1>🤖 ${config.name || 'AFK Bot'}</h1>

  <div class="card">
    <div class="label">Status</div>
    <div class="value" id="status">Connecting...</div>
  </div>

  <div class="card">
    <div class="label">Uptime</div>
    <div class="value" id="uptime">0s</div>
  </div>

  <div class="card">
    <div class="label">Coordinates</div>
    <div class="value" id="coords">Waiting...</div>
  </div>

  <div class="card">
    <div class="label">Server</div>
    <div class="value">
      ${config.server?.ip || 'Unknown'}:${config.server?.port || ''}
    </div>
  </div>

  <a href="/health">Health</a>

</div>

<script>
async function update() {
  try {
    const response = await fetch('/health');
    const data = await response.json();

    document.getElementById('status').textContent =
      data.status === 'connected'
        ? '🟢 Online'
        : '🔴 Reconnecting';

    document.getElementById('uptime').textContent =
      data.uptime + ' seconds';

    if (data.coords) {
      document.getElementById('coords').textContent =
        Math.floor(data.coords.x) + ', ' +
        Math.floor(data.coords.y) + ', ' +
        Math.floor(data.coords.z);
    } else {
      document.getElementById('coords').textContent = 'Unknown';
    }

  } catch (error) {
    document.getElementById('status').textContent = 'Offline';
  }
}

setInterval(update, 2000);
update();
</script>

</body>
</html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: botState.connected ? 'connected' : 'disconnected',
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: bot && bot.entity ? bot.entity.position : null,
    reconnectAttempts: botState.reconnectAttempts,
    lastActivity: botState.lastActivity,
    memoryMB:
      Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  });
});

app.get('/ping', (req, res) => {
  res.send('pong');
});

app.get('/tutorial', (req, res) => {
  res.send(`
    <h1>AFK Bot Setup</h1>
    <p>Configure settings.json and start the bot.</p>
    <p>Server: ${config.server?.ip || 'Unknown'}</p>
  `);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[WEB] Dashboard running on port ${PORT}`);
});

// ============================================================
// INTERVAL HELPERS
// ============================================================

function addInterval(callback, delay) {
  const id = setInterval(callback, delay);
  activeIntervals.push(id);
  return id;
}

function clearAllIntervals() {
  activeIntervals.forEach(clearInterval);
  activeIntervals = [];
}

// ============================================================
// RECONNECT
// ============================================================

function getReconnectDelay() {
  const base =
    Number(config.utils?.['auto-reconnect-delay']) || 5000;

  const max =
    Number(config.utils?.['max-reconnect-delay']) || 30000;

  return Math.min(
    base + botState.reconnectAttempts * 1000,
    max
  );
}

function scheduleReconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (isReconnecting) return;

  isReconnecting = true;
  botState.reconnectAttempts++;

  const delay = getReconnectDelay();

  console.log(
    `[BOT] Reconnecting in ${Math.round(delay / 1000)} seconds...`
  );

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    isReconnecting = false;
    createBot();
  }, delay);
}

// ============================================================
// BOT CREATION
// ============================================================

function createBot() {

  if (isReconnecting) return;

  if (bot) {
    try {
      clearAllIntervals();
      bot.removeAllListeners();
      bot.end();
    } catch (error) {
      console.log('[CLEANUP]', error.message);
    }

    bot = null;
  }

  console.log('[BOT] Creating bot...');

  try {

    bot = mineflayer.createBot({
      username: config['bot-account'].username,

      password:
        config['bot-account'].password || undefined,

      auth:
        config['bot-account'].type || 'offline',

      host:
        config.server.ip,

      port:
        Number(config.server.port),

      version:
        config.server.version,

      hideErrors: false,

      checkTimeoutInterval: 120000
    });

    bot.loadPlugin(pathfinder);

    let connectionTimeout = setTimeout(() => {

      if (!botState.connected) {

        console.log(
          '[BOT] Connection timeout.'
        );

        try {
          bot.end();
        } catch {}

        scheduleReconnect();
      }

    }, 60000);

    // ========================================================
    // SPAWN
    // ========================================================

    bot.once('spawn', () => {

      clearTimeout(connectionTimeout);

      botState.connected = true;
      botState.lastActivity = Date.now();
      botState.reconnectAttempts = 0;
      isReconnecting = false;

      console.log(
        '[BOT] ✅ Successfully connected!'
      );

      console.log(
        `[BOT] Server: ${config.server.ip}:${config.server.port}`
      );

      setupModules();

      // Try creative if enabled
      if (config.utils?.['creative-on-start']) {

        setTimeout(() => {

          if (bot && botState.connected) {

            bot.chat('/gamemode creative');

            console.log(
              '[BOT] Creative command sent.'
            );
          }

        }, 3000);
      }

      // Disable command feedback
      setTimeout(() => {

        if (bot && botState.connected) {
          bot.chat(
            '/gamerule sendCommandFeedback false'
          );
        }

      }, 4000);
    });

    // ========================================================
    // CHAT / LOGIN
    // ========================================================

    bot.on('messagestr', (message) => {

      botState.lastActivity = Date.now();

      const msg = String(message).toLowerCase();

      const password =
        config['bot-account'].password;

      if (!password) return;

      if (
        msg.includes('login') ||
        msg.includes('/login')
      ) {

        bot.chat(`/login ${password}`);

        console.log('[AUTH] Login command sent.');

        return;
      }

      if (
        msg.includes('register') ||
        msg.includes('/register')
      ) {

        bot.chat(
          `/register ${password} ${password}`
        );

        console.log('[AUTH] Register command sent.');
      }
    });

    // ========================================================
    // KICK
    // ========================================================

    bot.on('kicked', (reason) => {

      console.log(
        '[BOT] Kicked:',
        typeof reason === 'string'
          ? reason
          : JSON.stringify(reason)
      );
    });

    // ========================================================
    // END
    // ========================================================

    bot.on('end', (reason) => {

      botState.connected = false;

      clearAllIntervals();

      console.log(
        `[BOT] Disconnected: ${reason || 'Unknown'}`
      );

      if (
        config.utils?.['auto-reconnect'] !== false
      ) {
        scheduleReconnect();
      }
    });

    // ========================================================
    // ERROR
    // ========================================================

    bot.on('error', (error) => {

      console.log(
        `[BOT] Error: ${error.message}`
      );

      botState.errors.push({
        message: error.message,
        time: Date.now()
      });

      if (botState.errors.length > 20) {
        botState.errors.shift();
      }
    });

  } catch (error) {

    console.log(
      '[BOT] Failed:',
      error.message
    );

    scheduleReconnect();
  }
}

// ============================================================
// MODULES
// ============================================================

function setupModules() {

  if (!bot) return;

  const mcData = require('minecraft-data')(
    config.server.version
  );

  const defaultMove =
    new Movements(bot, mcData);

  console.log('[MODULES] Starting modules...');

  // ----------------------------------------------------------
  // MOVE TO POSITION
  // ----------------------------------------------------------

  if (config.position?.enabled) {

    bot.pathfinder.setMovements(
      defaultMove
    );

    bot.pathfinder.setGoal(
      new GoalBlock(
        Number(config.position.x),
        Number(config.position.y),
        Number(config.position.z)
      )
    );

    console.log(
      '[MOVE] Going to configured position.'
    );
  }

  // ----------------------------------------------------------
  // ANTI AFK
  // ----------------------------------------------------------

  if (config.utils?.['anti-afk']?.enabled) {

    const interval =
      Number(
        config.utils['anti-afk'].interval
      ) || 30000;

    addInterval(() => {

      if (!bot || !botState.connected) return;

      bot.setControlState('jump', true);

      setTimeout(() => {

        if (bot) {
          bot.setControlState('jump', false);
        }

      }, 300);

      botState.lastActivity = Date.now();

    }, interval);

    console.log(
      `[AFK] Anti-AFK enabled (${interval}ms)`
    );

    if (
      config.utils['anti-afk'].sneak
    ) {

      bot.setControlState(
        'sneak',
        true
      );
    }
  }

  // ----------------------------------------------------------
  // RANDOM JUMP
  // ----------------------------------------------------------

  if (
    config.movement?.['random-jump']?.enabled
  ) {

    const delay =
      Number(
        config.movement['random-jump'].interval
      ) || 10000;

    addInterval(() => {

      if (!bot || !botState.connected) return;

      bot.setControlState('jump', true);

      setTimeout(() => {

        if (bot) {
          bot.setControlState('jump', false);
        }

      }, 250);

    }, delay);
  }

  // ----------------------------------------------------------
  // LOOK AROUND
  // ----------------------------------------------------------

  if (
    config.movement?.['look-around']?.enabled
  ) {

    const delay =
      Number(
        config.movement['look-around'].interval
      ) || 8000;

    addInterval(async () => {

      if (!bot || !botState.connected) return;

      try {

        const yaw =
          Math.random() * Math.PI * 2;

        const pitch =
          (Math.random() - 0.5) * 0.5;

        await bot.look(
          yaw,
          pitch,
          true
        );

        botState.lastActivity =
          Date.now();

      } catch {}
    }, delay);
  }

  // ----------------------------------------------------------
  // CIRCLE WALK
  // ----------------------------------------------------------

  if (
    config.movement?.['circle-walk']?.enabled
  ) {

    startCircleWalk();
  }

  console.log(
    '[MODULES] All modules started.'
  );
}

// ============================================================
// CIRCLE WALK
// ============================================================

function startCircleWalk() {

  const delay =
    Number(
      config.movement['circle-walk'].interval
    ) || 5000;

  let direction = 1;

  addInterval(() => {

    if (!bot || !botState.connected) return;

    direction *= -1;

    bot.setControlState(
      'left',
      direction === 1
    );

    bot.setControlState(
      'right',
      direction === -1
    );

    bot.setControlState(
      'forward',
      true
    );

    botState.lastActivity =
      Date.now();

  }, delay);

  console.log('[MOVE] Circle walk enabled.');
}

// ============================================================
// MEMORY MONITOR
// ============================================================

setInterval(() => {

  const memory =
    process.memoryUsage();

  console.log(
    `[MEMORY] Heap: ${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`
  );

}, 300000);

// ============================================================
// SELF PING
// ============================================================

function startSelfPing() {

  const interval =
    10 * 60 * 1000;

  setInterval(() => {

    const url =
      process.env.RENDER_EXTERNAL_URL ||
      `http://localhost:${PORT}`;

    const protocol =
      url.startsWith('https')
        ? https
        : http;

    protocol
      .get(`${url}/ping`, (res) => {
        res.resume();
      })
      .on('error', (error) => {
        console.log(
          '[KEEPALIVE]',
          error.message
        );
      });

  }, interval);

  console.log(
    '[KEEPALIVE] Self-ping enabled.'
  );
}

startSelfPing();

// ============================================================
// START BOT
// ============================================================

console.log('================================');
console.log('     MINECRAFT AFK BOT');
console.log('================================');

createBot();

// ============================================================
// SAFE SHUTDOWN
// ============================================================

function shutdown(signal) {

  console.log(
    `[SYSTEM] ${signal} received.`
  );

  clearAllIntervals();

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  if (bot) {

    try {
      bot.quit('Server shutting down');
    } catch {}

    bot = null;
  }

  process.exit(0);
}

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);
