import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: env.VITE_BASE_URL || '/',
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${env.PORT || '5000'}`,
          changeOrigin: true,
        },
      },
    },
  };
});
