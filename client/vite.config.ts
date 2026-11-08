import { defineConfig } from 'vitest/config';
const serverPort = process.env.CATS_SERVER_PORT || '5101';
export default defineConfig({
  base: './', server: {host: '0.0.0.0', port: Number(process.env.CATS_CLIENT_PORT || 5174), strictPort: true,
    proxy: {'/ws': {target: `ws://127.0.0.1:${serverPort}`, ws: true}, '/health': `http://127.0.0.1:${serverPort}`}},
  build: {target: 'es2022'}, test: {include: ['src/**/*.test.ts']},
});
