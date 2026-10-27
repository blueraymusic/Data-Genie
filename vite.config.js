import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8000', '/static': 'http://127.0.0.1:8000' } },
  test: { environment: 'jsdom', include: ['src/**/*.test.{js,jsx}'], restoreMocks: true },
});
