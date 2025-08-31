import passport from 'passport';
import session from 'express-session';
import { Strategy as DiscordStrategy } from 'passport-discord';
import dotenv from 'dotenv';
import { createRequire } from 'module';
dotenv.config();

const require = createRequire(import.meta.url);
const SCOPES = ['identify', 'guilds'];

export async function setupAuth(app) {
  // Session store: prefer Redis if REDIS_URL is provided, otherwise fallback to memory (not for prod)
  let sessionOptions = {
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
  };

  if (process.env.REDIS_URL) {
    try {
      const connectRedis = require('connect-redis');
      const IORedis = require('ioredis');

      // Create Redis client (ioredis)
      const client = new IORedis(process.env.REDIS_URL);

      // connect-redis has changed export shapes across versions. Try multiple ways to
      // construct a store so this code works with v3/v4/v5/v6 variants.
      let initialized = false;
      let lastError = null;

      try {
        // old style: connectRedis(session) -> Store constructor
        if (typeof connectRedis === 'function') {
          const StoreCtor = connectRedis(session);
          sessionOptions.store = new StoreCtor({ client });
          initialized = true;
        }
      } catch (e) { lastError = e; }

      if (!initialized && connectRedis && typeof connectRedis.default === 'function') {
        try {
          const StoreCtor = connectRedis.default(session);
          sessionOptions.store = new StoreCtor({ client });
          initialized = true;
        } catch (e) { lastError = e; }
      }

      if (!initialized && connectRedis && connectRedis.RedisStore) {
        try {
          const StoreCtor = connectRedis.RedisStore;
          sessionOptions.store = new StoreCtor({ client });
          initialized = true;
        } catch (e) { lastError = e; }
      }

      if (!initialized) {
        // As a last resort, try treating the module itself as a constructor
        try {
          sessionOptions.store = new connectRedis({ client });
          initialized = true;
        } catch (e) { lastError = e; }
      }

      if (!initialized) throw lastError || new Error('Could not initialize Redis store (unknown connect-redis shape)');
      console.log('Auth: using Redis session store');
    } catch (e) {
      console.warn('Auth: REDIS_URL set but redis packages missing or failed to initialize; falling back to memory store');
      console.error('Auth: redis init error:', e && (e.stack || e.message || e));
    }
  }

  app.use(session(sessionOptions));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((obj, done) => done(null, obj));

  const callbackURL = process.env.DISCORD_CALLBACK || 'http://localhost:3000/auth/discord/callback';
  console.log('Auth: discord callback URL =', callbackURL);
  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL,
    scope: SCOPES
  }, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
  }));

  app.get('/login', (req, res) => res.render('login', { user: req.user }));
  app.get('/auth/discord', (req, res, next) => {
    // store returnTo if present
    try { if (req.session && req.session.returnTo) delete req.session.returnTo; } catch {}
    passport.authenticate('discord')(req, res, next);
  });
  app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/login' }), (req, res) => {
    // redirect back to where user wanted to go
    const dest = (req.session && req.session.returnTo) || '/';
    if (req.session) delete req.session.returnTo;
    res.redirect(dest);
  });

  app.get('/logout', (req, res) => { req.logout(() => {}); res.redirect('/'); });
}

export function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  // remember where user wanted to go
  try {
    if (req.session) req.session.returnTo = req.originalUrl || req.url;
  } catch {}
  res.redirect('/login');
}
