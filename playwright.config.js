const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8790', launchOptions: { args: ['--enable-unsafe-swiftshader'] } },
  webServer: { command: 'npx wrangler pages dev --port 8790', url: 'http://127.0.0.1:8790', reuseExistingServer: false, timeout: 90000 },
});
