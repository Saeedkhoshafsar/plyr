module.exports = {
  apps: [{
    name: "Hybrid-Automation",
    script: "./dist/index.js",
    instances: 4,
    exec_mode: "cluster",
    
    // ✅ اضافه شده: نمایش زمان در لاگ‌های PM2
    time: true,
    
    // ✅ اضافه شده: تفکیک فایل‌های لاگ سیستمی
    error_file: "./logs/pm2-error.log",
    out_file: "./logs/pm2-out.log",
    
    // ادغام لاگ‌های کلاسترهای مختلف در یک فایل
    merge_logs: true,

    env: {
      NODE_ENV: "production",
    },
    
    env_development: {
      NODE_ENV: "development",
      watch: true, 
      ignore_watch: ["node_modules", "logs", "profiles"],
    },

    max_memory_restart: '1G',
    autorestart: true,
  }]
}