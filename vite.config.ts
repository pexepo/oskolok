import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const buildId = new Date().toISOString();
  const buildInfo = JSON.stringify({buildId});
  return {
    base: env.VITE_BASE_URL || '/',
    define: {'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(buildId)},
    plugins: [react(), {
      name: 'oskolok-build-version',
      generateBundle() {this.emitFile({type:'asset',fileName:'version.json',source:buildInfo});},
      configureServer(server) {server.middlewares.use('/version.json',(_req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(buildInfo);});},
    }],
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
