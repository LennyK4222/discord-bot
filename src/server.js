import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import { getAllConfigs, getGuildConfig, setGuildConfig } from './configStore.js';
import { setupAuth, ensureAuth } from './auth.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import fs from 'fs';
import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { composeBanner, composeOverlay } from './bannerComposer.js';
import { composeAnimatedBanner } from './animatedBannerComposer.js';
import compression from 'compression';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startServer({ bot }) {
  const app = express();
  const port = process.env.PORT || 3000;

  // When running behind a proxy (like Render, Heroku, etc.) the app receives
  // the client's IP in the X-Forwarded-For header. express-rate-limit validates
  // this header only if `trust proxy` is enabled. Enable it in production-like
  // environments. You can override via TRUST_PROXY env var (true/false).
  const trustProxyEnvRaw = process.env.TRUST_PROXY || '';
  const trustProxyEnv = trustProxyEnvRaw.toLowerCase();
  // Prefer a numeric value (number of proxies) to avoid permissive `trust proxy`.
  // express-rate-limit rejects a permissive true value. Use TRUST_PROXY=1 on PaaS
  // like Render where there is a single proxy in front of the app, or set a
  // specific IP/networks if needed.
  if (trustProxyEnv && !isNaN(Number(trustProxyEnvRaw))) {
    app.set('trust proxy', Number(trustProxyEnvRaw));
  } else if (trustProxyEnv === 'true') {
    // If explicitly true is provided, fall back to trusting only one proxy to
    // reduce permissiveness.
    app.set('trust proxy', 1);
  } else if (trustProxyEnv === '' && process.env.NODE_ENV === 'production') {
    // Default to trusting a single proxy in production environments like Render.
    app.set('trust proxy', 1);
  }

  // Basic security headers. Disable helmet's default CSP so we don't block CDN-loaded assets
  // (Tailwind CDN, fonts, etc.). For production, replace this with a proper CSP.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Rate limiter for auth endpoints and test actions
  const limiter = rateLimit({ windowMs: 10 * 1000, max: 15 });
  app.use('/auth/', limiter);
  app.use('/guild/:id/test', limiter);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  // Enable gzip compression for faster responses
  app.use(compression());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.json());

  // Authentication (Discord OAuth)
  try { await setupAuth(app); } catch (e) { console.warn('Auth setup failed (missing deps or env vars)'); }

  // Middleware to check user is a guild admin before allowing guild edits
  async function ensureGuildAdmin(req, res, next) {
    try {
      if (!req.user) return res.status(403).send('Forbidden');
      const guildId = req.params.id;
      const guild = bot.guilds.cache.get(guildId);
      if (!guild) return res.status(404).send('Guild not found');
      // find member in the guild
      const member = await guild.members.fetch(req.user.id).catch(() => null);
      if (!member) return res.status(403).send('Not a member of this guild');
      if (member.permissions.has('ManageGuild') || member.permissions.has('Administrator') || guild.ownerId === req.user.id) return next();
      return res.status(403).send('Insufficient permissions');
    } catch (e) {
      console.error('ensureGuildAdmin error', e);
      return res.status(500).send('Server error');
    }
  }

  // Make authenticated user available to templates
  app.use((req, res, next) => {
    try { res.locals.user = req.user; } catch {}
    next();
  });

  // Ensure banners directory exists and serve it for previews
  const bannersDir = path.join(__dirname, '..', 'data', 'banners');
  if (!fs.existsSync(bannersDir)) fs.mkdirSync(bannersDir, { recursive: true });
  app.use('/banners', express.static(bannersDir));

  // Multer setup for uploads
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, bannersDir);
    },
    filename: function (req, file, cb) {
      const id = req.params.id || 'global';
      const ext = path.extname(file.originalname) || '.gif';
      cb(null, `${id}${ext}`);
    }
  });

  // Overlay-only PNG API for LIVE preview over GIF backgrounds
  // Body: { layout?, title?, subtitle?, avatarUrl? }
  app.post('/api/overlay/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const guild = bot.guilds.cache.get(id);
      if (!guild) return res.status(404).send('Guild not found');
      const cfg = await getGuildConfig(id);

      const title = req.body?.title ?? (cfg.previewTitle || 'Bine ai venit!');
      const subtitle = req.body?.subtitle ?? (bot?.user?.username || '');
      const avatarUrl = req.body?.avatarUrl ?? bot?.user?.displayAvatarURL?.({ extension: 'png', size: 256 });
      const layoutRaw = req.body?.layout || req.body || {};
      const layout = validateLayout(layoutRaw);

      const buffer = await composeOverlay({ title, subtitle, avatarUrl, layout });
      res.setHeader('Content-Type', 'image/png');
      res.send(buffer);
    } catch (e) {
      console.error('Overlay(POST) error:', e);
      res.status(500).send('Overlay failed');
    }
  });

  // Preview API via POST body (does NOT persist). Body: { layout?, title?, subtitle?, avatarUrl? }
  app.post('/api/preview/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const guild = bot.guilds.cache.get(id);
      if (!guild) return res.status(404).send('Guild not found');
      const cfg = await getGuildConfig(id);

      const title = req.body?.title ?? (cfg.previewTitle || 'Bine ai venit!');
      const subtitle = req.body?.subtitle ?? (bot?.user?.username || '');
      const avatarUrl = req.body?.avatarUrl ?? bot?.user?.displayAvatarURL?.({ extension: 'png', size: 256 });
      const backgroundFilePath = cfg.bannerFile ? path.join(bannersDir, cfg.bannerFile) : undefined;
      const isGifLocal = cfg.bannerFile ? path.extname(cfg.bannerFile).toLowerCase() === '.gif' : false;
      const isGifUrl = cfg.bannerUrl ? new URL(cfg.bannerUrl).pathname.toLowerCase().endsWith('.gif') : false;
      const useGif = isGifLocal || isGifUrl;

      const layoutRaw = req.body?.layout || req.body || {};
      const layout = validateLayout(layoutRaw);

      // For LIVE preview we always render a fast PNG using Sharp, even if background is a GIF.
      // This avoids FFmpeg latency during slider/drag changes. GIF is still used for final send/test.
      const buffer = await composeBanner({ backgroundFilePath, backgroundUrl: cfg.bannerUrl, title, subtitle, avatarUrl, layout });
      res.setHeader('Content-Type', 'image/png');
      res.send(buffer);
    } catch (e) {
      console.error('Preview(POST) error:', e);
      res.status(500).send('Preview failed');
    }
  });

  // Layout API
  app.get('/api/layout/:id', async (req, res) => {
    const id = req.params.id;
    const cfg = await getGuildConfig(id);
    res.json(cfg.layout || {});
  });

  app.post('/api/layout/:id', async (req, res) => {
    const id = req.params.id;
    const layout = validateLayout(req.body || {});
    await setGuildConfig(id, { layout });
    res.json({ ok: true });
  });

  // Preview API (PNG or GIF depending on background)
  app.get('/api/preview/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const guild = bot.guilds.cache.get(id);
      if (!guild) return res.status(404).send('Guild not found');
      const cfg = await getGuildConfig(id);

      const title = cfg.previewTitle || 'Bine ai venit!';
      const subtitle = cfg.previewSubtitle || (bot?.user?.username || '');
      const avatarUrl = bot?.user?.displayAvatarURL?.({ extension: 'png', size: 256 });
      const backgroundFilePath = cfg.bannerFile ? path.join(bannersDir, cfg.bannerFile) : undefined;
      const isGifLocal = cfg.bannerFile ? path.extname(cfg.bannerFile).toLowerCase() === '.gif' : false;
      const isGifUrl = cfg.bannerUrl ? new URL(cfg.bannerUrl).pathname.toLowerCase().endsWith('.gif') : false;
      const useGif = isGifLocal || isGifUrl;

      const layout = cfg.layout || {};

      const buffer = useGif
        ? await composeAnimatedBanner({ backgroundFilePath, backgroundUrl: cfg.bannerUrl, title, subtitle, avatarUrl, layout })
        : await composeBanner({ backgroundFilePath, backgroundUrl: cfg.bannerUrl, title, subtitle, avatarUrl, layout });

      res.setHeader('Content-Type', useGif ? 'image/gif' : 'image/png');
      res.send(buffer);
    } catch (e) {
      console.error('Preview error:', e);
      res.status(500).send('Preview failed');
    }
  });
  const upload = multer({ storage });

  app.get('/', ensureAuth, async (req, res) => {
    const guildCache = bot?.guilds?.cache || new Map();
    const allCfg = await getAllConfigs();
    const guilds = [];
    for (const g of Array.from(guildCache.values())) {
      const cfg = allCfg[g.id] || {};
      let welcomeName = null;
      let goodbyeName = null;
      try {
        const chw = cfg.welcomeChannelId ? g.channels.cache.get(cfg.welcomeChannelId) : null;
        const chg = cfg.goodbyeChannelId ? g.channels.cache.get(cfg.goodbyeChannelId) : null;
        welcomeName = chw ? `#${chw.name}` : (cfg.welcomeChannelId ? 'Canal eliminat' : null);
        goodbyeName = chg ? `#${chg.name}` : (cfg.goodbyeChannelId ? 'Canal eliminat' : null);
      } catch (e) {
        // ignore
      }
      // determine if current user may see this guild on the dashboard
      let allowedForUser = false;
      try {
        if (req.user) {
          const member = await g.members.fetch(req.user.id).catch(() => null);
          if (member) {
            const isAdmin = member.permissions.has('Administrator') || member.permissions.has('ManageGuild') || g.ownerId === req.user.id;
            if (isAdmin) allowedForUser = true;
            const allowedRoles = (cfg.allowedRoleIds || []);
            if (!allowedForUser && allowedRoles.length) {
              for (const rid of allowedRoles) {
                if (member.roles.cache.has(rid)) { allowedForUser = true; break; }
              }
            }
          }
        }
      } catch (e) { /* ignore */ }
      if (allowedForUser) guilds.push({ id: g.id, name: g.name, icon: g.iconURL?.(), welcomeChannelName: welcomeName, goodbyeChannelName: goodbyeName });
    }

    res.render('index', { guilds, configs: allCfg });
  });

  app.get('/guild/:id', ensureAuth, async (req, res) => {
    const id = req.params.id;
    const guild = bot.guilds.cache.get(id);
    if (!guild) return res.status(404).send('Guild not found');
  const cfg = await getGuildConfig(id);
  const me = guild.members.me;
  // roles list for UI
  const roles = Array.from(guild.roles.cache.values()).map(r => ({ id: r.id, name: r.name }));
  const channels = Array.from(guild.channels.cache.values())
      .filter(ch => ch?.isTextBased?.())
      .filter(ch => {
        try { return !!me?.permissionsIn?.(ch)?.has?.('SendMessages'); } catch { return true; }
      })
      .map(ch => ({ id: ch.id, name: ch.name || ch.id }));
    let baseGifUrl = null;
    try {
      const isGifLocal = cfg.bannerFile ? path.extname(cfg.bannerFile).toLowerCase() === '.gif' : false;
      const isGifUrl = cfg.bannerUrl ? new URL(cfg.bannerUrl).pathname.toLowerCase().endsWith('.gif') : false;
      if (isGifLocal) baseGifUrl = '/banners/' + cfg.bannerFile;
      else if (isGifUrl) baseGifUrl = cfg.bannerUrl;
    } catch {}
    // determine if current user is admin and/or has access via allowed roles
    let isAdmin = false;
    let hasAccess = false;
    try {
      if (req.user) {
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (member) {
          isAdmin = member.permissions.has('Administrator') || member.permissions.has('ManageGuild') || guild.ownerId === req.user.id;
          const allowedRoles = cfg.allowedRoleIds || [];
          if (allowedRoles.length) {
            for (const rid of allowedRoles) if (member.roles.cache.has(rid)) { hasAccess = true; break; }
          }
        }
      }
    } catch (e) { /* ignore */ }

    // Admins can always see/manage; non-admins must have access
    if (!isAdmin && !hasAccess) return res.status(403).send('Nu ai permisiunea de a accesa această pagină');

    res.render('guild', { guild, cfg, channels, baseGifUrl, roles, isAdmin });
  });

  app.post('/guild/:id/save', ensureGuildAdmin, async (req, res) => {
    const id = req.params.id;
    const { welcomeChannelId, goodbyeChannelId, welcomeMessage, goodbyeMessage, bannerUrl } = req.body;
    let allowedRoleIds = req.body.allowedRoleIds || [];
    const autoRoleId = req.body.autoRoleId || null;
    if (!Array.isArray(allowedRoleIds)) {
      if (typeof allowedRoleIds === 'string' && allowedRoleIds.length) allowedRoleIds = [allowedRoleIds]; else allowedRoleIds = [];
    }
    await setGuildConfig(id, {
      welcomeChannelId,
      goodbyeChannelId,
      welcomeMessage,
      goodbyeMessage,
      bannerUrl,
      allowedRoleIds,
      autoRoleId
    });
    const wantsJson = (req.get('accept') || '').includes('application/json') || (req.get('x-requested-with') === 'fetch');
    if (wantsJson) return res.json({ ok: true });
    res.redirect('/guild/' + id);
  });

  // Check whether the bot can assign a given role (used by UI to provide feedback)
  app.get('/guild/:id/check-role', ensureGuildAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const roleId = req.query.roleId;
      if (!roleId) return res.status(400).json({ ok: false, reason: 'missing_roleId' });
      const guild = bot.guilds.cache.get(id);
      if (!guild) return res.status(404).json({ ok: false, reason: 'guild_not_found' });
      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (!role) return res.json({ ok: false, reason: 'role_not_found' });
      const me = guild.members.me;
      if (!me) return res.json({ ok: false, reason: 'bot_not_in_guild' });
      if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return res.json({ ok: false, reason: 'missing_manage_roles' });
      const botHighest = me.roles.highest;
      if (!botHighest || botHighest.position <= role.position) return res.json({ ok: false, reason: 'role_too_high' });
      return res.json({ ok: true });
    } catch (e) {
      console.error('check-role error', e);
      return res.status(500).json({ ok: false, reason: 'server_error' });
    }
  });

  // Upload local banner file
  app.post('/guild/:id/upload', ensureGuildAdmin, upload.single('bannerFile'), async (req, res) => {
    const id = req.params.id;
    if (!req.file) return res.status(400).send('Niciun fișier încărcat');
    // Save only filename; bot will attach from disk when sending
    await setGuildConfig(id, { bannerFile: req.file.filename });
    res.redirect('/guild/' + id);
  });

  // Simple in-memory rate limit per guild for test endpoint
  const lastTestAt = new Map();

  // Send a test message to verify banner and formatting
  app.post('/guild/:id/test', ensureGuildAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const now = Date.now();
      const last = lastTestAt.get(id) || 0;
      if (now - last < 3000) {
        const wantsJsonToo = (req.get('accept') || '').includes('application/json') || (req.get('x-requested-with') === 'fetch');
        const msg = 'Prea des. Încearcă din nou în câteva secunde.';
        return wantsJsonToo ? res.status(429).json({ ok: false, error: msg }) : res.status(429).send(msg);
      }
      lastTestAt.set(id, now);
  // Accept JSON payload with optional layout from the client to ensure test uses same preview layout
  const { type = 'welcome', channelId, layout } = req.body;
      const guild = bot.guilds.cache.get(id);
      if (!guild) return res.status(404).send('Guild not found');
      const cfg = await getGuildConfig(id);

      const targetChannelId = channelId || (type === 'goodbye' ? (cfg.goodbyeChannelId || cfg.welcomeChannelId) : cfg.welcomeChannelId);
      if (!targetChannelId) return res.status(400).send('Setează un channel ID pentru test');
      const channel = await guild.channels.fetch(targetChannelId).catch(() => null);
      if (!channel || !channel.isTextBased()) return res.status(400).send('Channel invalid sau non-text');

      const title = type === 'goodbye' ? 'La revedere!' : 'Bine ai venit!';
      // Use bot's username for preview; in real events it's the member's username
      const subtitle = bot.user.username;
      const avatarUrl = bot.user.displayAvatarURL({ extension: 'png', size: 128 });
      const backgroundFilePath = cfg.bannerFile ? path.join(bannersDir, cfg.bannerFile) : undefined;
      const isGifLocal = cfg.bannerFile ? path.extname(cfg.bannerFile).toLowerCase() === '.gif' : false;
      const isGifUrl = cfg.bannerUrl ? new URL(cfg.bannerUrl).pathname.toLowerCase().endsWith('.gif') : false;
      const useGif = isGifLocal || isGifUrl;

      // If a layout was supplied in the test POST (from the preview UI), persist it for this guild
      // so future real events use the same layout.
      const finalLayout = layout || cfg.layout || {};
      if (layout) {
        // merge and persist layout
        await setGuildConfig(id, { layout: finalLayout });
      }

      const composed = useGif
        ? await composeAnimatedBanner({ backgroundFilePath, backgroundUrl: cfg.bannerUrl, title, subtitle, avatarUrl, layout: finalLayout })
        : await composeBanner({ backgroundFilePath, backgroundUrl: cfg.bannerUrl, title, subtitle, avatarUrl, layout: finalLayout });

      const embed = new EmbedBuilder()
        .setColor(type === 'goodbye' ? 0xff7043 : 0x00bcd4)
        .setTimestamp(new Date())
        .setImage(`attachment://banner.${useGif ? 'gif' : 'png'}`);

      await channel.send({ embeds: [embed], files: [{ attachment: composed, name: `banner.${useGif ? 'gif' : 'png'}` }] });
      const wantsJson = (req.get('accept') || '').includes('application/json') || (req.get('x-requested-with') === 'fetch');
      if (wantsJson) {
        return res.json({ ok: true });
      }
      res.redirect('/guild/' + id);
    } catch (e) {
      console.error('Eroare test banner:', e);
      const wantsJson = (req.get('accept') || '').includes('application/json') || (req.get('x-requested-with') === 'fetch');
      if (wantsJson) {
        return res.status(500).json({ ok: false, error: 'Eroare la trimiterea testului' });
      }
      res.status(500).send('Eroare la trimiterea testului');
    }
  });

  const server = app.listen(port, () => {
    console.log(`UI disponibil pe http://localhost:${port}`);
  });

  return server;
}

// Clamp and sanitize layout values
function clamp(n, min, max) { n = Number(n); return isFinite(n) ? Math.max(min, Math.min(max, n)) : undefined; }
function validateLayout(layout = {}) {
  const out = { ...layout };
  out.overlayOpacity = typeof layout.overlayOpacity === 'number' ? clamp(layout.overlayOpacity, 0, 0.6) : out.overlayOpacity;
  out.avatar = {
    ...(layout.avatar || {}),
    size: clamp(layout.avatar?.size ?? 190, 32, 300),
    x: clamp(layout.avatar?.x ?? 80, 0, 1200),
    y: clamp(layout.avatar?.y ?? 90, 0, 400)
  };
  out.title = {
    ...(layout.title || {}),
    size: clamp(layout.title?.size ?? 100, 12, 200),
    x: clamp(layout.title?.x ?? 600, 0, 1200),
    y: clamp(layout.title?.y ?? 205, 0, 400),
    center: !!layout.title?.center,
    strokeWidth: clamp(layout.title?.strokeWidth ?? 3, 0, 10)
  };
  out.subtitle = {
    ...(layout.subtitle || {}),
    size: clamp(layout.subtitle?.size ?? 50, 12, 200),
    x: clamp(layout.subtitle?.x ?? 600, 0, 1200),
    y: clamp(layout.subtitle?.y ?? 265, 0, 400),
    center: !!layout.subtitle?.center,
    strokeWidth: clamp(layout.subtitle?.strokeWidth ?? 2, 0, 10)
  };
  return out;
}
