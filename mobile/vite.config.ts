import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envPrefix: 'VITE_MOBILE_API_URL',
  build: { target: 'es2022', outDir: 'dist', sourcemap: false },
});
