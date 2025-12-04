const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');
const app = express();

// ====================== المتغيرات من Render ======================
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const REDIRECT_URI = process.env.REDIRECT_URI || `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'your-site.onrender.com'}/callback`;
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'enjoy-tracker-2025';

// ====================== Role IDs (غيّرها من هنا) ======================
// الرتب العليا جدًا (يدخلون admin.html)
const TOP_RANK_ROLES = [
  "1431304799059579036",  // ← Owner
  "1431304799059579035"   // ← Co-Owner
];

// الرتب المتوسطة (لهم صلاحيات داخل dashboard.html لكن مو admin منفصل)
const MID_RANK_ROLES = [
  "123456789012345680",  // ← Host
  "1431304799059579034",  // ← Moderator
  "1431304799059579033"   // ← Supervisor
];

// ====================== الإعدادات ======================
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
app.set('trust proxy', 1);

// ====================== الصفحة الرئيسية ======================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ====================== تسجيل الدخول ======================
app.get('/login', (req, res) => {
  const scopes = 'identify guilds guilds.members.read';
  res.redirect(`https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scopes}`);
});

// ====================== Callback ======================
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('<h1 style="color:red;text-align:center">فشل تسجيل الدخول</h1>');

  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
      }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const tokenData = await tokenResponse.json();
    if (tokenData.error) throw new Error(tokenData.error);

    const accessToken = tokenData.access_token;

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const user = await userResponse.json();

    const memberResponse = await fetch(`https://discord.com/api/guilds/${GUILD_ID}/members/${user.id}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });

    if (!memberResponse.ok) {
      return res.send('<h1 style="color:red;text-align:center">أنت مو في السيرفر!</h1>');
    }

    const member = await memberResponse.json();
    const roles = member.roles || [];

    const isTopRank = roles.some(r => TOP_RANK_ROLES.includes(r));
    const isMidRank = roles.some(r => MID_RANK_ROLES.includes(r));

    // تحديد المستوى
    let level = "عضو";
    if (roles.includes(TOP_RANK_ROLES[0])) level = "المالك";
    else if (roles.includes(TOP_RANK_ROLES[1])) level = "شريك المالك";
    else if (roles.includes(MID_RANK_ROLES[0])) level = "هوست";
    else if (roles.includes(MID_RANK_ROLES[1])) level = "مشرف";
    else if (roles.includes(MID_RANK_ROLES[2])) level = "مراقب";

    req.session.user = {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      tag: `${user.username}#${user.discriminator}`,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : 'https://cdn.discordapp.com/embed/avatars/0.png',
      isTopRank: isTopRank,
      isMidRank: isMidRank,
      level: level
    };

    if (!req.session.stats) {
      req.session.stats = { totalSeconds: 0, sessions: [], currentSession: null };
    }

    // التوجيه النهائي
    if (isTopRank) {
      res.redirect('/admin.html');
    } else {
      res.redirect('/dashboard.html');
    }

  } catch (err) {
    console.error("خطأ في Callback:", err);
    res.status(500).send('<h1 style="color:red;text-align:center">حدث خطأ أثناء تسجيل الدخول</h1>');
  }
});

// ====================== API: جلب بيانات المستخدم (مهم للفرونت) ======================
app.get('/api/user', (req, res) => {
  if (req.session.user) {
    res.json({
      user: req.session.user,
      stats: req.session.stats
    });
  } else {
    res.status(401).json({ error: 'غير مسجل دخول' });
  }
});

// باقي APIs الدوام (start, pause, resume, stop) نفس اللي قبل ← ما تغيرت
// (انسخها من الرسالة السابقة)

// ====================== حماية الصفحات ======================
app.get('/dashboard.html', (req, res) => {
  if (req.session.user && !req.session.user.isTopRank) {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  } else if (req.session.user && req.session.user.isTopRank) {
    res.redirect('/admin.html');
  } else {
    res.redirect('/');
  }
});

app.get('/admin.html', (req, res) => {
  if (req.session.user && req.session.user.isTopRank) {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  } else {
    res.redirect('/dashboard.html');
  }
});

// ====================== تسجيل الخروج ======================
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ====================== تشغيل السيرفر ======================
app.listen(PORT, () => {
  console.log(`السيرفر شغال بنجاح!`);
  console.log(`رابط الدخول: https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:3000'}`);
});
