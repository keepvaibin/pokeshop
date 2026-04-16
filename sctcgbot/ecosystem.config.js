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
      max_memory_restart: '400M',
      // Env vars are loaded from the VM environment or a .env shell export.
      // Do NOT hardcode secrets — set SONNET_TOKEN and other vars in the
      // VM environment or via: export $(cat .env | xargs)
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/home/azureuser/logs/sctcg-bot-error.log',
      out_file: '/home/azureuser/logs/sctcg-bot-out.log',
      merge_logs: true,
    },
  ],
};
