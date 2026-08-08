// Guards what tsconfig's `types: []` used to guarantee before @types/node was
// added in v0.4: no file in src/ may depend on an ambient Node global.
//
// A tsconfig `exclude` cannot express this - src/index.ts re-exports
// serveHandler, so the import graph pulls src/serve.ts in no matter what the
// globs say. So the whole project is typechecked with no Node types and errors
// originating in serve.ts, the one file that deliberately uses them, are
// ignored. Anything else failing means a Node global leaked somewhere it will
// not exist at runtime for a consumer.
import { spawnSync } from 'node:child_process'

const ALLOWED = 'src/serve.ts'

const { stdout } = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.no-node.json'], {
  encoding: 'utf8',
})

const leaks = stdout
  .split('\n')
  .filter((line) => /^\S+\.ts\(\d+,\d+\): error/.test(line))
  .filter((line) => !line.startsWith(ALLOWED))

if (leaks.length > 0) {
  console.error('Node globals leaked into src/ (only %s may use them):\n', ALLOWED)
  for (const line of leaks) console.error(`  ${line}`)
  process.exit(1)
}
console.log('no-node guard: clean (%s is the only Node-dependent file)', ALLOWED)
