import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base './' keeps asset paths relative, so the site works at https://<user>.github.io/<repo>/
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        bitcoin: resolve(__dirname, 'bitcoin.html'),
        income: resolve(__dirname, 'income.html'),
        portfolio: resolve(__dirname, 'portfolio.html'),
        learn: resolve(__dirname, 'learn.html'),
        compare: resolve(__dirname, 'compare.html'),
        tracker: resolve(__dirname, 'tracker.html'),
      },
    },
  },
});
