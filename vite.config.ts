import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The PowerPoint package marks its Worker entry as side-effect-free, despite installing onmessage.
  worker: { rolldownOptions: { treeshake: false } },
  build: { target: 'es2022', chunkSizeWarningLimit: 850 },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@web-ppt/core', '@web-ppt/viewer-core'] },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 15000 },
} as Parameters<typeof defineConfig>[0]);
