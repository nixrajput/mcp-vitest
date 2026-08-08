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

// Any error line that is not file-scoped - a bad config path, a crash, a bad
// `types` entry - means tsc did not check what this script assumes it did.
// Without this, such a diagnostic alongside the expected serve.ts errors would
// still report "clean", because the leak filter would find nothing to report.
const unparsed = lines.filter((l) => /error TS\d+/.test(l) && !FILE_ERROR.test(l))
if (unparsed.length > 0 || (status !== 0 && fileErrors.length === 0)) {
  console.error(`tsc exited ${status} with diagnostics this check cannot attribute:\n`)
  for (const l of unparsed) console.error(`  ${l}`)
  if (unparsed.length === 0) console.error(stdout || stderr || '(no output)')
  process.exit(1)
}

console.log(`no-node guard: clean (${ALLOWED} is the only Node-dependent file)`)
