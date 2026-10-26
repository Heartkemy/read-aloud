#!/usr/bin/env node
/**
 * Builds the React entry point.
 *
 * Only the browser half needs a build, and only because it contains JSX: the
 * server half is plain ESM that Node runs as-is, and shipping it unbundled
 * keeps stack traces pointing at readable source. React stays external so a
 * host app never ends up with two copies of it.
 *
 * Runs from `prepare`, so `npm install github:athanor-code/read-aloud` produces
 * a working package without a publish step.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
mkdirSync(path.join(root, 'dist'), { recursive: true })

await build({
  entryPoints: [path.join(root, 'src', 'react', 'index.js')],
  outfile: path.join(root, 'dist', 'react.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  sourcemap: true,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  logLevel: 'info',
})
