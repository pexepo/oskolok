module.exports = {
  apps: [
    {
      name: 'oskolok-api',
      script: 'dist-server/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
    },
  ],
};
