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
const FILE_ERROR = /^(?<file>\S+?)\(\d+,\d+\): error /

const { status, stdout, stderr } = spawnSync(
  'npx',
  ['tsc', '--noEmit', '-p', 'tsconfig.no-node.json'],
  { encoding: 'utf8' },
)

const lines = (stdout ?? '').split('\n')
const fileErrors = lines.flatMap((line) => {
  const file = FILE_ERROR.exec(line)?.groups?.file
  return file ? [{ file, line }] : []
})
// Exact filename, not startsWith: a prefix match would silently allowlist a
// hypothetical src/serve.tsx alongside the one file that is meant to be exempt.
const leaks = fileErrors.filter(({ file }) => file !== ALLOWED)

if (leaks.length > 0) {
  console.error(`Node globals leaked into src/ (only ${ALLOWED} may use them):\n`)
  for (const { line } of leaks) console.error(`  ${line}`)
  process.exit(1)
}

// A non-zero exit with nothing file-scoped left means tsc failed for a reason
// this script cannot parse - a bad config path, a crash. Passing there would
// report "clean" while nothing was actually checked.
if (status !== 0 && fileErrors.length === 0) {
  console.error(`tsc exited ${status} without any file-scoped error; the check did not run.\n`)
  console.error(stdout || stderr || '(no output)')
  process.exit(1)
}

console.log(`no-node guard: clean (${ALLOWED} is the only Node-dependent file)`)
