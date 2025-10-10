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
    }
  }]
};
