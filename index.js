const mineflayer = require('mineflayer');
const express = require('express');
const config = require('./settings.json');

const app = express();
const PORT = process.env.PORT || 5000;

const bots = [];

const SERVER = {
  host: config.server.ip,
  port: Number(config.server.port),
  version: config.server.version
};

// ============================================================
// WEB DASHBOARD
// ============================================================

app.get('/', (req, res) => {

  const botCards = bots.map((data, index) => {

    const online =
      data.bot &&
      data.connected;

    let coords = 'Unknown';

    if (data.bot?.entity) {
      const p = data.bot.entity.position;

      coords =
        `${Math.floor(p.x)}, ` +
        `${Math.floor(p.y)}, ` +
        `${Math.floor(p.z)}`;
    }

    return `
      <div class="card">

        <h2>Bot ${index + 1}</h2>

        <p>
          <b>Username:</b>
          ${data.username}
        </p>

        <p>
          <b>Status:</b>
          ${online ? '🟢 Online' : '🔴 Offline'}
        </p>

        <p>
          <b>Coordinates:</b>
          ${coords}
        </p>

        <p>
          <b>Reconnects:</b>
          ${data.reconnectAttempts}
        </p>

      </div>
    `;

  }).join('');

  res.send(`
<!DOCTYPE html>

<html>

<head>

<title>${config.name}</title>

<meta name="viewport"
content="width=device-width, initial-scale=1">

<style>

body {
  background:#020617;
  color:white;
  font-family:Arial,sans-serif;
  padding:20px;
}

.container {
  max-width:700px;
  margin:auto;
}

h1 {
  color:#2dd4bf;
}

.server {
  background:#1e293b;
  padding:15px;
  border-radius:10px;
  margin-bottom:20px;
}

.card {
  background:#0f172a;
  border:1px solid #334155;
  padding:18px;
  border-radius:12px;
  margin:15px 0;
}

</style>

</head>

<body>

<div class="container">

<h1>🤖 ${config.name}</h1>

<div class="server">

<b>Server:</b>
${SERVER.host}:${SERVER.port}

<br><br>

<b>Version:</b>
${SERVER.version}

</div>

${botCards}

</div>

</body>

</html>
  `);

});

// ============================================================
// HEALTH
// ============================================================

app.get('/health', (req, res) => {

  res.json({

    server: SERVER,

    bots: bots.map((data) => ({

      username: data.username,

      status:
        data.connected
          ? 'connected'
          : 'disconnected',

      reconnectAttempts:
        data.reconnectAttempts,

      coordinates:
        data.bot?.entity
          ? data.bot.entity.position
          : null

    }))

  });

});

// ============================================================
// PING
// ============================================================

app.get('/ping', (req, res) => {

  res.send('pong');

});

app.listen(PORT, '0.0.0.0', () => {

  console.log(
    `[WEB] Dashboard running on port ${PORT}`
  );

});

// ============================================================
// CREATE BOT DATA
// ============================================================

function createBotData(account) {

  return {

    username: account.username,

    password: account.password || '',

    type: account.type || 'offline',

    bot: null,

    connected: false,

    reconnectAttempts: 0,

    reconnectTimer: null,

    antiAfkTimer: null

  };

}

// ============================================================
// CONNECT BOT
// ============================================================

function connectBot(data, index) {

  console.log('');
  console.log(
    `[BOT ${index + 1}] Connecting as ${data.username}...`
  );

  try {

    const bot = mineflayer.createBot({

      username: data.username,

      password:
        data.password || undefined,

      auth:
        data.type || 'offline',

      host:
        SERVER.host,

      port:
        SERVER.port,

      version:
        SERVER.version,

      hideErrors: false,

      checkTimeoutInterval: 120000

    });

    data.bot = bot;

    // ========================================================
    // SPAWN
    // ========================================================

    bot.once('spawn', () => {

      data.connected = true;

      data.reconnectAttempts = 0;

      console.log(
        `[BOT ${index + 1}] ✅ ${data.username} joined!`
      );

      startAntiAFK(data, index);

    });

    // ========================================================
    // LOGIN / REGISTER
    // ========================================================

    bot.on('messagestr', (message) => {

      const msg =
        String(message).toLowerCase();

      if (!data.password) {
        return;
      }

      if (
        msg.includes('login') &&
        !msg.includes('logged')
      ) {

        bot.chat(
          `/login ${data.password}`
        );

        console.log(
          `[BOT ${index + 1}] Login sent`
        );

      }

      if (
        msg.includes('register')
      ) {

        bot.chat(
          `/register ${data.password} ${data.password}`
        );

        console.log(
          `[BOT ${index + 1}] Register sent`
        );

      }

    });

    // ========================================================
    // KICK
    // ========================================================

    bot.on('kicked', (reason) => {

      console.log(
        `[BOT ${index + 1}] Kicked:`,
        typeof reason === 'string'
          ? reason
          : JSON.stringify(reason)
      );

    });

    // ========================================================
    // ERROR
    // ========================================================

    bot.on('error', (error) => {

      console.log(
        `[BOT ${index + 1}] Error: ${error.message}`
      );

    });

    // ========================================================
    // DISCONNECT
    // ========================================================

    bot.on('end', (reason) => {

      data.connected = false;

      stopAntiAFK(data);

      console.log(
        `[BOT ${index + 1}] Disconnected:`,
        reason || 'Unknown'
      );

      if (
        config.utils?.['auto-reconnect'] !== false
      ) {

        scheduleReconnect(
          data,
          index
        );

      }

    });

  } catch (error) {

    console.log(
      `[BOT ${index + 1}] Connection failed:`,
      error.message
    );

    scheduleReconnect(
      data,
      index
    );

  }

}

// ============================================================
// ANTI AFK
// ============================================================

function startAntiAFK(data, index) {

  if (
    !config.utils?.['anti-afk']?.enabled
  ) {
    return;
  }

  stopAntiAFK(data);

  const interval =
    Number(
      config.utils['anti-afk'].interval
    ) || 30000;

  data.antiAfkTimer =
    setInterval(() => {

      if (
        !data.bot ||
        !data.connected
      ) {
        return;
      }

      try {

        data.bot.setControlState(
          'jump',
          true
        );

        setTimeout(() => {

          if (data.bot) {

            data.bot.setControlState(
              'jump',
              false
            );

          }

        }, 300);

      } catch {}

    }, interval);

  console.log(
    `[BOT ${index + 1}] Anti-AFK enabled`
  );

}

// ============================================================
// STOP ANTI AFK
// ============================================================

function stopAntiAFK(data) {

  if (data.antiAfkTimer) {

    clearInterval(
      data.antiAfkTimer
    );

    data.antiAfkTimer = null;

  }

}

// ============================================================
// RECONNECT
// ============================================================

function scheduleReconnect(data, index) {

  if (data.reconnectTimer) {
    return;
  }

  data.reconnectAttempts++;

  const delay =
    Number(
      config.utils?.['reconnect-delay']
    ) || 5000;

  console.log(
    `[BOT ${index + 1}] Reconnecting in ${delay / 1000}s`
  );

  data.reconnectTimer =
    setTimeout(() => {

      data.reconnectTimer = null;

      connectBot(
        data,
        index
      );

    }, delay);

}

// ============================================================
// START ALL BOTS
// ============================================================

console.log('');
console.log('======================================');
console.log('       PERZAAN MULTI AFK BOT');
console.log('======================================');

console.log(
  `Server: ${SERVER.host}:${SERVER.port}`
);

console.log(
  `Version: ${SERVER.version}`
);

console.log(
  `Total bots: ${config.bots.length}`
);

config.bots.forEach((account, index) => {

  const data =
    createBotData(account);

  bots.push(data);

  // 5-second gap between bots

  setTimeout(() => {

    connectBot(
      data,
      index
    );

  }, index * 5000);

});

// ============================================================
// SHUTDOWN
// ============================================================

function shutdown(signal) {

  console.log(
    `[SYSTEM] ${signal} received`
  );

  bots.forEach((data) => {

    stopAntiAFK(data);

    if (data.reconnectTimer) {

      clearTimeout(
        data.reconnectTimer
      );

    }

    if (data.bot) {

      try {
        data.bot.quit('Shutdown');
      } catch {}

    }

  });

  setTimeout(() => {

    process.exit(0);

  }, 1000);

}

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);
