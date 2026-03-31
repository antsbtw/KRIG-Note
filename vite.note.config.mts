import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: 'note.html',
    },
  },
  css: {
    // 确保 CSS 文件被正确加载
  },
});
