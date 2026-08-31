module.exports = {
  apps: [{
    name: 'manga-tracker',
    script: './server.js',
    env: {
      NODE_ENV: 'development',
      PORT: 3000,
      BASE_PATH: ''
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001,
      BASE_PATH: '/manga-tracker'
      // Required auth values are injected by the production environment:
      // PUBLIC_ORIGIN, SESSION_SECRET, and bootstrap-only ADMIN_* when needed.
    }
  }]
};
