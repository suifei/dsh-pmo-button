// Bundle the client half into the lazy-CJS/IIFE script the module loader
// expects. Runs after tsc so lib/client.js is never left as ESM output.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/client.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: 'lib/client.js',
  external: ['react'],
  logLevel: 'info',
})
