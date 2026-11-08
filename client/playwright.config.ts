import {defineConfig} from '@playwright/test';
export default defineConfig({testDir: './tests', timeout: 30000, workers: 1, fullyParallel: false,
  use: {baseURL: process.env.CATS_TEST_URL || 'http://127.0.0.1:5101', channel: 'chrome', headless: true,
    launchOptions: {args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']}, screenshot: 'only-on-failure', trace: 'retain-on-failure'},
});
