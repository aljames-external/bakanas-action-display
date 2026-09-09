import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/module.ts',
      formats: ['es'],
      fileName: () => 'module.js',
    },
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
  },
});
