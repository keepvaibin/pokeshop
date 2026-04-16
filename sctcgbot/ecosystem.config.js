module.exports = {
  apps: [
    {
      name: 'sctcg-bot',
      script: 'main.py',
      interpreter: 'python3',
      cwd: '/home/azureuser/sctcgbot',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      // Env vars are loaded from .env by config.py — do NOT hardcode secrets here.
      // Set them in the VM environment or a .env file in the cwd above.
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/home/azureuser/logs/sctcg-bot-error.log',
      out_file: '/home/azureuser/logs/sctcg-bot-out.log',
      merge_logs: true,
    },
  ],
};
