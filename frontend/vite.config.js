import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { faqAnswerAnchor, faqGroups } from './src/data/faq.jsx';

const faqCatalog = {
  name: 'faq-catalog',
  apply: 'build',
  generateBundle() {
    const entries = faqGroups.flatMap(({ items }) =>
      items.map(({ question, search }) => ({ id: faqAnswerAnchor(question), question, search })),
    );
    this.emitFile({ type: 'asset', fileName: 'help-faq.json', source: JSON.stringify(entries) });
  },
};

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), faqCatalog],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: Object.fromEntries(
      [
        '/api',
        '/static',
        '/mcp',
        '/authorize',
        '/token',
        '/register',
        '/revoke',
        '/.well-known',
      ].map((path) => [path, 'http://127.0.0.1:8000']),
    ),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
    // Bound JSDOM concurrency on laptops and small CI runners without relaxing timeouts.
    maxWorkers: 1,
  },
});
