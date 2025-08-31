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
      const RedisStore = connectRedis(session);
      const client = new IORedis(process.env.REDIS_URL);
      sessionOptions.store = new RedisStore({ client });
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
