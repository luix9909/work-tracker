const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');
const app = express();

// ====================== جلب المتغيرات مباشرة من Render (بدون dotenv) ======================
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const REDIRECT_URI = process.env.REDIRECT_URI || `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'your-site.onrender.com'}/callback`;
const REQUIRED_ROLES = (process.env.REQUIRED_ROLES || '').split(',').filter(r => r.trim());
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-secret-change-in-render';

// ====================== الإعدادات ======================
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'enjoy-tracker-2025',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.set('trust proxy', 1); // السطر ده مهم جدًا في Render

// ====================== الصفحة الرئيسية → login.html ======================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ====================== تسجيل الدخول ======================
app.get('/login', (req, res) => {
  const scopes = 'identify guilds guilds.members.read';
  res.redirect(`https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scopes}`);
});

// ====================== Callback بعد تسجيل الدخول ======================
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('<h1 style="color:red;text-align:center">فشل تسجيل الدخول</h1>');

  try {
    // جلب التوكن
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
        scope: 'identify guilds guilds.members.read',
      }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const tokenData = await tokenResponse.json();
    if (tokenData.error) throw new Error(tokenData.error);

    const accessToken = tokenData.access_token;

    // جلب بيانات المستخدم
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const user = await userResponse.json();

    // جلب عضوية السيرفر + الرتب
    const memberResponse = await fetch(`https://discord.com/api/guilds/${GUILD_ID}/members/${user.id}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });

    if (!memberResponse.ok) {
      return res.send('<h1 style="color:red;text-align:center">الرتبة غير مصرحة أو لست في السيرفر!</h1>');
    }

    const member = await memberResponse.json();

    // فحص الرتب المطلوبة
    const hasRole = member.roles.some(role => REQUIRED_ROLES.includes(role));
    if (!hasRole && REQUIRED_ROLES.length > 0) {
      return res.send('<h1 style="color:red;text-align:center">الرتبة غير مصرحة!</h1>');
    }

    // حفظ بيانات المستخدم في الجلسة
    req.session.user = {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      tag: `${user.username}#${user.discriminator}`,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : 'https://cdn.discordapp.com/embed/avatars/0.png',
      accessToken
    };

    // تحميل أو إنشاء إحصائيات المستخدم
    if (!req.session.stats) {
      req.session.stats = {
        totalSeconds: 0,
        sessions: [],
        currentSession: null
      };
    }

res.redirect('/dashboard.html?loggedin=true');

  } catch (err) {
    console.error(err);
    res.status(500).send('<h1 style="color:red;text-align:center">حدث خطأ أثناء تسجيل الدخول</h1>');
  }
});

// ====================== API: جلب بيانات المستخدم ======================
app.get('/api/user', (req, res) => {
  if (req.session.user) {
    res.json({
      user: req.session.user,
      stats: req.session.stats || { totalSeconds: 0, sessions: [], currentSession: null }
    });
  } else {
    res.status(401).json({ error: 'غير مسجل دخول' });
  }
});

// ====================== API: ابدأ الجلسة ======================
app.post('/api/start', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'غير مسجل' });

  if (req.session.stats.currentSession) {
    return res.status(400).json({ error: 'يوجد جلسة مستمرة بالفعل' });
  }

  req.session.stats.currentSession = {
    start: Date.now(),
    pausedTime: 0,
    isPaused: false,
    pauseStart: null
  };

  res.json({ success: true });
});

// ====================== API: إيقاف مؤقت ======================
app.post('/api/pause', (req, res) => {
  if (!req.session.stats?.currentSession) return res.status(400).json({ error: 'لا توجد جلسة' });

  req.session.stats.currentSession.isPaused = true;
  req.session.stats.currentSession.pauseStart = Date.now();
  res.json({ success: true });
});

// ====================== API: استئناف ======================
app.post('/api/resume', (req, res) => {
  if (!req.session.stats?.currentSession) return res.status(400).json({ error: 'لا توجد جلسة' });

  const pauseDuration = Date.now() - req.session.stats.currentSession.pauseStart;
  req.session.stats.currentSession.pausedTime += pauseDuration;
  req.session.stats.currentSession.isPaused = false;
  req.session.stats.currentSession.pauseStart = null;

  res.json({ success: true });
});

// ====================== API: إنهاء الدوام ======================
app.post('/api/stop', (req, res) => {
  if (!req.session.stats?.currentSession) return res.status(400).json({ error: 'لا توجد جلسة' });

  const session = req.session.stats.currentSession;
  const duration = Math.floor((Date.now() - session.start - session.pausedTime) / 1000);

  req.session.stats.totalSeconds += duration;
  req.session.stats.sessions.push({
    date: new Date().toLocaleDateString('ar-EG'),
    duration: duration
  });

  req.session.stats.currentSession = null;
  res.json({ success: true, duration });
});

// ====================== تسجيل الخروج ======================
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ====================== حماية dashboard.html (اختياري – الجافاسكربت يكفي لكن هذا أقوى) ======================
app.get('/dashboard.html', (req, res) => {
  if (req.session.user) {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  } else {
    res.redirect('/');
  }
});
// إصلاح مشكلة الكوكيز في Render (مهم جدًا)
app.set('trust proxy', 1);
// ====================== تشغيل السيرفر ======================
app.listen(PORT, () => {
  console.log(`السيرفر شغال على الرابط: https://work-tracker-zrww.onrender.com`);
  console.log(`تسجيل الدخول: https://work-tracker-zrww.onrender.com`);
});
