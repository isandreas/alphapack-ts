// PM2 ecosystem config for AlphaPack Bot
// Production deployment on a 768 MB VPS — single lean Node.js process.
//
// Prerequisites (run once on the VPS, not automated here):
//   npm install -g pm2
//   pm2 install pm2-logrotate
//   pm2 set pm2-logrotate:max_size 20M
//   pm2 set pm2-logrotate:retain 7
//   pm2 set pm2-logrotate:compress true

/** @type {import('pm2').StartOptions[]} */
module.exports = {
  apps: [
    {
      name: "alphapack-bot",

      // Run the compiled output — build first with `npm run build`
      script: "dist/index.js",

      // Single instance (fork mode), NOT cluster mode.
      // Cluster mode multiplies memory usage — avoid on 768 MB.
      instances: 1,
      exec_mode: "fork",

      // Limit heap to 256 MB. Tune upward if pino/Redis overhead pushes
      // steady-state RSS above ~180 MB after monitoring with `pm2 monit`.
      node_args: "--max-old-space-size=256",

      // Safety net: PM2 restarts the process if RSS exceeds 300 MB
      // instead of letting the OOM killer take down the whole VPS.
      max_memory_restart: "300M",

      // Load .env from the project root (dotenv is called in config/env.ts)
      cwd: __dirname,

      // Environment variables — production secrets live in .env, not here.
      // Do NOT commit actual values.
      env: {
        NODE_ENV: "production",
      },
      env_development: {
        NODE_ENV: "development",
        LOG_LEVEL: "debug",
      },

      // Restart policy
      autorestart: true,
      watch: false,            // Never watch in production — use `pm2 reload` after deploy
      max_restarts: 10,        // Stop trying after 10 rapid crashes (avoid restart loop)
      min_uptime: "10s",       // A process is considered crashed if it dies before 10 s

      // Exponential back-off between restarts (ms)
      restart_delay: 4_000,

      // Log configuration (pm2-logrotate handles rotation)
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      merge_logs: true,
      time: true,              // Prefix each log line with a timestamp
    },
  ],
};
