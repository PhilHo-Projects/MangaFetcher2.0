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
      // Auth — override ADMIN_PASSWORD on the server for real security.
      // ADMIN_USERNAME: 'phil',
      // ADMIN_PASSWORD: '0000',
      // DEMO_USERNAME: 'demo',
      // SESSION_SECRET is auto-generated and persisted to data/session-secret
      // if not set here.
    }
  }]
};
