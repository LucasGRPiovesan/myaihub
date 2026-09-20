import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // O .env vive na raiz do monorepo.
  const env = loadEnv(mode, '../..', ['VITE_', 'WEB_PORT', 'API_URL']);
  const apiUrl = env.VITE_API_URL ?? env.API_URL ?? 'http://localhost:3333';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      // Proxy em dev para que a API seja same-origin: os cookies httpOnly de
      // sessão funcionam sem afrouxar SameSite.
      proxy: {
        '/api': { target: apiUrl, changeOrigin: true },
        '/health': { target: apiUrl, changeOrigin: true },
      },
    },
    // O MESMO proxy no preview, que é onde o E2E roda. Sem ele o build
    // servido não alcança a API, e o navegador do teste receberia o
    // index.html no lugar do JSON — falha que não diz nada sobre o produto.
    preview: {
      port: 4173,
      proxy: {
        '/api': { target: apiUrl, changeOrigin: true },
        '/health': { target: apiUrl, changeOrigin: true },
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router'],
            query: ['@tanstack/react-query'],
          },
        },
      },
    },
    test: {
      name: 'web',
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  };
});
