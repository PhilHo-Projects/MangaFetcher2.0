const crypto = require('node:crypto');
const db = require('./db');
const { loadConfig } = require('./config');

const SESSION_COOKIE_NAME = 'mt_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const CONFIG = loadConfig(process.env);
const SECRET = CONFIG.sessionSecret;

function createSessionToken(userId, secret, ttlMs = SESSION_TTL_MS) {
  const encodedUserId = Buffer.from(String(userId)).toString('base64url');
  const payload = `${encodedUserId}.${Date.now() + ttlMs}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${hmac}`;
}

function verifySessionToken(token, secret) {
  if (typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [encodedUserId, expiry, providedHmac] = parts;
  const payload = `${encodedUserId}.${expiry}`;
  const expectedHmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  // Validate that providedHmac is exactly 64 lowercase hex chars (SHA-256 = 32 bytes)
  if (!/^[0-9a-f]{64}$/.test(providedHmac)) {
    return null;
  }

  let expectedBuf;
  let providedBuf;
  try {
    expectedBuf = Buffer.from(expectedHmac, 'hex');
    providedBuf = Buffer.from(providedHmac, 'hex');
  } catch {
    return null;
  }

  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return null;
  }

  const expiryMs = Number(expiry);
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) {
    return null;
  }

  const userId = Number(Buffer.from(encodedUserId, 'base64url').toString('utf8'));
  if (!Number.isInteger(userId)) {
    return null;
  }

  return { userId };
}

function parseCookies(cookieHeader) {
  const out = {};
  if (typeof cookieHeader !== 'string') {
    return out;
  }

  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim();
    if (!key) {
      continue;
    }
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function cookieOptions(basePath, includeMaxAge = true) {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: basePath || '/'
  };
  if (includeMaxAge) {
    options.maxAge = SESSION_TTL_MS;
  }
  return options;
}

function setSessionCookie(res, userId, basePath) {
  res.cookie(SESSION_COOKIE_NAME, createSessionToken(userId, SECRET), cookieOptions(basePath, true));
}

function clearSessionCookie(res, basePath) {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions(basePath, false));
}

function resolveDemoUser() {
  const demoUsername = String(process.env.DEMO_USERNAME || 'demo').trim() || 'demo';
  return db.getUserByUsername(demoUsername) || null;
}

function attachUser(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionToken(cookies[SESSION_COOKIE_NAME], SECRET);

  let user = null;
  if (session) {
    user = db.getUser(session.userId) || null;
  }
  if (!user || user.role === 'demo') {
    user = user && user.role === 'demo' ? user : resolveDemoUser();
  }

  req.user = user;
  req.userId = user ? user.id : null;
  next();
}

function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireOwner
};
