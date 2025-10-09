module.exports = {
  apps: [{
    name: 'manga-tracker',
    script: './server.js',
    env: {
      NODE_ENV: 'development',
    },
    env_production: {
      NODE_ENV: 'production',
    }
  }]
};
