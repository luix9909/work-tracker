const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// المتغيرات من Environment (مضمونة من Render)
const CLIENT_ID      = process.env.CLIENT_ID;
const CLIENT_SECRET  = process.env.CLIENT_SECRET;
const BOT_TOKEN      = process.env.BOT_TOKEN;
const REDIRECT_URI   = process.env.REDIRECT_URI;
const GUILD_ID       = process.env.GUILD_ID;
const REQUIRED_ROLES = process.env.REQUIRED_ROLES ? process.env.REQUIRED_ROLES.split(',').map(r => r.trim()) : [];
const WEBHOOK_URL    = process.env.WEBHOOK_URL;

const users = {}; // تخزين مؤقت

// Middleware (مهم جدًا - كانت ناقصة)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(session({
  secret: 'enjoy-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Routes
app.get('/login', (req, res) => {
  res.redirect(`https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send('<h1 style="color:red;text-align:center">فشل في تسجيل الدخول</h1>');

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const tokens = await tokenRes.json();

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const user = await userRes.json();

    const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const guilds = await guildsRes.json();

    if (!guilds.find(g => g.id === GUILD_ID)) {
      return res.send('<h1 style="color:red;text-align:center">غير موجود في السيرفر المطلوب!</h1>');
    }

    const memberRes = await fetch(`https://discord.com/api/guilds/${GUILD_ID}/members/${user.id}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    const member = await memberRes.json();

    if (!member.roles || !member.roles.some(r => REQUIRED_ROLES.includes(r))) {
      return res.send('<h1 style="color:red;text-align:center">الرتبة غير مصرحة!</h1>');
    }

    req.session.user = {
      id: user.id,
      tag: user.global_name || `${user.username}#${user.discriminator || '0000'}`,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : `https://cdn.discordapp.com/embed/avatars/${(user.discriminator || 0) % 5}.png`
    };

    if (!users[user.id]) {
      users[user.id] = { totalSeconds: 0, sessions: [], currentSession: null };
    }

    await sendWebhook(`✅ **${req.session.user.tag}** سجّل دخول - مرحباً بالعمل!`);
    res.redirect('/');

  } catch (e) {
    console.error('Callback Error:', e);
    res.send('<h1 style="color:red;text-align:center">خطأ غير متوقع: ' + e.message + '</h1>');
  }
});

app.get('/api/user', (req, res) => {
  if (!req.session.user) return res.json(null);
  res.json({ user: req.session.user, stats: users[req.session.user.id] || { totalSeconds: 0, sessions: [], currentSession: null } });
});

app.post('/api/start', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const uid = req.session.user.id;
  if (!users[uid]) users[uid] = { totalSeconds: 0, sessions: [], currentSession: null };
  if (!users[uid].currentSession) {
    users[uid].currentSession = { start: Date.now(), pausedTime: 0, isPaused: false };
    await sendWebhook(`▶️ **${req.session.user.tag}** بدأ جلسة عمل جديدة`);
  }
  res.json({ success: true });
});

app.post('/api/pause', (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const sess = users[req.session.user.id]?.currentSession;
  if (sess && !sess.isPaused) {
    sess.pauseStart = Date.now();
    sess.isPaused = true;
  }
  res.json({ success: true });
});

app.post('/api/resume', (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const sess = users[req.session.user.id]?.currentSession;
  if (sess && sess.isPaused) {
    sess.pausedTime += Date.now() - sess.pauseStart;
    sess.isPaused = false;
    sess.pauseStart = null;
  }
  res.json({ success: true });
});

app.post('/api/stop', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const uid = req.session.user.id;
  const sess = users[uid]?.currentSession;
  if (sess) {
    const duration = Math.floor((Date.now() - sess.start - sess.pausedTime) / 1000);
    users[uid].totalSeconds += duration;
    users[uid].sessions.push({ date: new Date().toLocaleDateString('ar-EG'), duration });
    await sendWebhook(`🚪 **${req.session.user.tag}** سجّل خروج - قضى **${formatTime(duration)}**`);
    users[uid].currentSession = null;
  }
  res.json({ success: true });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Route الرئيسية (للـ index.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Functions
async function sendWebhook(content) {
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
  } catch (e) { console.error('Webhook Error:', e); }
}

function formatTime(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// Server start
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
