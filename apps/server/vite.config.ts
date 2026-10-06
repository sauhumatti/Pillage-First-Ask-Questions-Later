import { defineConfig } from 'vite';
import repoPackageJson from '../../package.json' with { type: 'json' };
import webPackageJson from '../web/package.json' with { type: 'json' };

// Bundles the server and the shared game code into plain JavaScript for Node.
// The SQLite package stays external, since it loads its WebAssembly file from disk.
export default defineConfig({
  define: {
    'import.meta.env.VERSION': JSON.stringify(repoPackageJson.version),
    'import.meta.env.GRAPHICS_VERSION': JSON.stringify(
      webPackageJson.dependencies['@pillage-first/graphics'] ?? '0.0.0',
    ),
  },
  ssr: {
    target: 'node',
    noExternal: true,
    external: ['@sqlite.org/sqlite-wasm', 'vitest'],
  },
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'build',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'src/main.ts',
        'world-worker': 'src/world-worker.ts',
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
      },
    },
  },
});
