/**
 * PM2 ecosystem 配置（Stage 2.2）
 *
 * 启动：pm2 start app/deploy/ecosystem.config.cjs
 * 查看：pm2 logs ai-comic-drama-worker
 * 伸缩：pm2 scale ai-comic-drama-worker=3
 *
 * instance=1 是默认。大流量场景调为 2-4 个 worker 即可水平扩展；
 * BullMQ 会自动在多个 worker 之间分发任务。
 */

module.exports = {
  apps: [
    {
      name: "ai-comic-drama-worker",
      cwd: __dirname + "/..",
      script: "node_modules/.bin/tsx",
      args: "src/workers/main.ts",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      kill_timeout: 30000,
      env: {
        NODE_ENV: "production",
      },
      // 日志
      out_file: "./logs/worker-out.log",
      error_file: "./logs/worker-error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
