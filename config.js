function requireString(environment, name) {
  const value = String(environment[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function loadConfig(environment = process.env) {
  const nodeEnv = String(environment.NODE_ENV || 'development').trim();
  const publicOrigin = requireString(environment, 'PUBLIC_ORIGIN');
  const parsedOrigin = new URL(publicOrigin);
  if (parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) {
    throw new Error('PUBLIC_ORIGIN must be an origin without a path, query, or hash');
  }

  const sessionSecret = requireString(environment, 'SESSION_SECRET');
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }

  const adminUsername = String(environment.ADMIN_USERNAME || '').trim() || null;
  const adminPassword = typeof environment.ADMIN_PASSWORD === 'string'
    ? environment.ADMIN_PASSWORD
    : null;

  if (adminPassword && adminPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  }

  return {
    nodeEnv,
    publicOrigin: parsedOrigin.origin,
    sessionSecret,
    adminUsername,
    adminPassword
  };
}

module.exports = { loadConfig };

