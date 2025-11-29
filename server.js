const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ضع معلوماتك هنا (غيّرها)
const CLIENT_ID = process.env.CLIENT_ID || '1444436322147242134';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'cDQK1BxxuzlXaCAIC29qAdsI-XBwvM-P';
const BOT_TOKEN = process.env.BOT_TOKEN || 'MTQ0NDQzNjMyMjE0NzI0MjEzNA.GFnrFu.WnP1y-kOErs5c3mgL7cXcDhAlccEgmIpni-Sn0';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://work-tracker-zrww.onrender.com/';
const GUILD_ID = process.env.GUILD_ID || '1431304799042670612';
const REQUIRED_ROLES = ['1431304799059579035', '1431304799059579036']; // حط IDs الرتب المسموحة (مفصولة بفاصلة)
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://discord.com/api/webhooks/1444444487219679364/ZZJcgslKbMNl4y80lrbpoxo8G0ORLkOp3Q-1WmIFxBUEyW6qxBrU8hlX4VFmrklCCHCq';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(session({
  secret: 'enjoy-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

const users = {}; // تخزين مؤقت (يمكن ترقيته لقاعدة بيانات)

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

    const memberRes = await fetch(`https://discord.com/api/guilds/${GUILD_ID}/members/${user.id}?with_roles=true`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    const member = await memberRes.json();

    if (!member.roles.some(r => REQUIRED_ROLES.includes(r))) {
      return res.send('<h1 style="color:red;text-align:center">الرتبة غير مصرحة!</h1>');
    }

    req.session.user = {
      id: user.id,
      tag: user.global_name || `${user.username}#${user.discriminator}`,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : `https://cdn.discordapp.com/embed/avatars/${user.discriminator % 5}.png`
    };

    if (!users[user.id]) users[user.id] = { totalSeconds: 0, sessions: [], currentSession: null };

    // إرسال ويب هوك عند الدخول
    await sendWebhook(`✅ **${req.session.user.tag}** سجّل دخول - مرحباً بالعمل!`);

    res.redirect('/');
  } catch (e) {
    console.error(e);
    res.send('<h1>خطأ غير متوقع</h1>');
  }
});

app.get('/api/user', (req, res) => {
  if (!req.session.user) return res.json(null);
  res.json({ user: req.session.user, stats: users[req.session.user.id] });
});

app.post('/api/start', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const uid = req.session.user.id;
  if (!users[uid].currentSession) {
    users[uid].currentSession = { start: Date.now(), pausedTime: 0, isPaused: false };
    await sendWebhook(`▶️ **${req.session.user.tag}** بدأ جلسة عمل جديدة`);
  }
  res.json({ success: true });
});

app.post('/api/pause', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const uid = req.session.user.id;
  const sess = users[uid].currentSession;
  if (sess && !sess.isPaused) {
    sess.pauseStart = Date.now();
    sess.isPaused = true;
  }
  res.json({ success: true });
});

app.post('/api/resume', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const uid = req.session.user.id;
  const sess = users[uid].currentSession;
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
  const sess = users[uid].currentSession;
  if (sess) {
    const duration = Math.floor((Date.now() - sess.start - sess.pausedTime) / 1000);
    users[uid].totalSeconds += duration;
    users[uid].sessions.push({ date: new Date().toLocaleDateString('ar'), duration });
    await sendWebhook(`🚪 **${req.session.user.tag}** سجّل خروج - قضى **${formatTime(duration)}** اليوم`);
    users[uid].currentSession = null;
  }
  res.json({ success: true });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

async function sendWebhook(content) {
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
  } catch (e) { console.error('Webhook error:', e); }
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
