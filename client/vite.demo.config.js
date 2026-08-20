import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build da demonstracao publicada: troca o cliente HTTP pelo backend que roda no
 * proprio navegador. Todo o resto — componentes, estilos, regras — e o mesmo codigo.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^(.*)\/lib\/api\.js$/, replacement: '$1/lib/api.demo.js' }],
  },
  build: {
    outDir: 'dist-demo',
    // Um arquivo so, sem hash: e ele que vira o HTML publicado.
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});
