#!/usr/bin/env node
/**
 * Inform-only size / bundle / bench / health / coverage report.
 *
 * Exits 0 no matter what it finds: CI is the enforcement, this exists so a
 * regression is visible before the push rather than after the publish.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const argv = process.argv.slice(2)
const FAST = argv.includes('--fast')

function parseOnly() {
  const eq = argv.find((a) => a.startsWith('--only='))
  if (eq) return eq.slice('--only='.length)
  const i = argv.indexOf('--only')
  if (i < 0) return undefined
  return argv[i + 1] ?? '' // flag present with no value: explicit empty, not "run everything"
}
const ONLY = parseOnly()
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

/** Runs a command, returning stdout+stderr even when it exits non-zero. */
function run(cmd, args, env) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      timeout: 120_000,
      killSignal: 'SIGKILL',
    })
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
}

/** Like run(), but returns null on a non-zero exit instead of the error text. */
function runOk(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 120_000,
      killSignal: 'SIGKILL',
    })
  } catch {
    return null
  }
}

// An unreachable registry (eg. npm_config_registry pointed at a dead host) must
// degrade, not hang a pre-push hook where the only escape is Ctrl-C.
const NPM_TIMEOUT = ['--fetch-timeout=5000', '--fetch-retries=1']

// Colour only when a human is looking: piping to a file, a pipeline, or CI's
// step summary must stay plain, or ANSI escapes end up as literal garbage.
// NO_COLOR is the cross-tool standard; FORCE_COLOR overrides for demos.
const COLOR =
  !process.env.NO_COLOR && (Boolean(process.stdout.isTTY) || process.env.FORCE_COLOR === '1')

const paint = (open) => (text) => (COLOR ? `[${open}m${text}[0m` : String(text))

const c = {
  head: paint('1;36'), // bold cyan
  label: paint('37'), // plain grey
  value: paint('1'), // bold
  good: paint('32'), // green
  bad: paint('33'), // yellow, not red: this report never blocks anything
  dim: paint('2'),
}

// Progress goes to stderr: stdout is the report's data, which CI pipes into a
// markdown fence. Interactive only, because CI captures stderr into the summary.
const PROGRESS = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR
let progressWidth = 0

function progress(label) {
  if (!PROGRESS) return
  const line = `  ${label}...`
  progressWidth = line.length
  process.stderr.write(`\r${line}`)
}

function progressDone() {
  if (!PROGRESS || progressWidth === 0) return
  // Overwrite with spaces so no progress text survives in the scroll.
  process.stderr.write(`\r${' '.repeat(progressWidth)}\r`)
  progressWidth = 0
}

const kB = (n) => `${(n / 1024).toFixed(2)} kB`

/** Last n non-empty lines of captured output, so a regex miss still shows real diagnostics. */
function tail(out, n = 10) {
  return out
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .slice(-n)
}

function deltaOf(now, before) {
  if (before === undefined) return c.dim('new')
  const d = now - before
  if (d === 0) return c.dim('=')
  const pct = before === 0 ? 0 : Math.round((d / before) * 100)
  const text = `${d > 0 ? '+' : ''}${kB(d)} (${d > 0 ? '+' : ''}${pct}%)`
  return d > 0 ? c.bad(text) : c.good(text)
}

// tsdown content-hashes shared chunks, so a logical file is renamed every build.
// ponytail: prefix match, not a manifest - fine while ours are the four known entries.
const canonical = (name) => name.replace(/-[A-Za-z0-9_-]{8,}(?=\.)/, '-*')

function measureDist(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js') || f.endsWith('.d.ts'))
    .sort()
    .map((f) => {
      const buf = readFileSync(join(dir, f))
      return { name: canonical(f), raw: buf.length, gz: gzipSync(buf).length }
    })
}

/** Recursively sums file sizes under dir, skipping the top-level dist/ subtree. */
function sumOther(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'dist') continue
    const full = join(dir, entry.name)
    total += entry.isDirectory() ? sumOther(full) : statSync(full).size
  }
  return total
}

/** Downloads the published tarball and measures its dist. null when offline. */
function publishedBaseline() {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vitest-baseline-'))
  try {
    const version = runOk('npm', ['view', pkg.name, 'version', ...NPM_TIMEOUT])?.trim()
    if (!version) return null
    run('npm', ['pack', `${pkg.name}@${version}`, '--pack-destination', dir, ...NPM_TIMEOUT])
    const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'))
    if (!tgz) return null
    const tarball = statSync(join(dir, tgz)).size
    run('tar', ['xzf', join(dir, tgz), '-C', dir])
    const pkgDir = join(dir, 'package')
    return {
      version,
      tarball,
      entries: measureDist(join(pkgDir, 'dist')),
      otherPacked: sumOther(pkgDir),
    }
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function size() {
  // In hook mode the gate built dist/ seconds ago; rebuilding wastes ~1.9s.
  let buildOutput = ''
  let buildFailed = false
  if (!FAST) {
    try {
      buildOutput = execFileSync('npm', ['run', 'build'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
        killSignal: 'SIGKILL',
      })
    } catch (error) {
      buildFailed = true
      buildOutput = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
  }
  let local
  try {
    local = measureDist('dist')
  } catch (error) {
    const lines = tail(buildOutput)
    return [
      'bundle size, gzipped: build failed, dist/ missing or unreadable',
      ...(lines.length ? lines : [`(no build output captured: ${error.message})`]),
    ]
  }
  const packed = JSON.parse(run('npm', ['pack', '--dry-run', '--json']))[0]
  const otherPacked = packed.files
    .filter((f) => !f.path.startsWith('dist/'))
    .reduce((sum, f) => sum + f.size, 0)
  const base = publishedBaseline()
  const before = new Map((base?.entries ?? []).map((e) => [e.name, e]))

  const lines = []
  if (buildFailed) {
    lines.push(c.bad('bundle size, gzipped: build failed - numbers below are from a stale dist/'))
    lines.push(...tail(buildOutput).map((l) => `  ${c.dim(l)}`))
  }
  lines.push(
    c.head(
      base
        ? `bundle size, gzipped, vs ${pkg.name}@${base.version} on npm`
        : 'bundle size, gzipped (no published baseline: offline or unpublished)',
    ),
  )
  for (const e of local) {
    lines.push(
      `  ${c.label(e.name.padEnd(28))} ${c.value(kB(e.gz).padStart(10))}  ${deltaOf(e.gz, before.get(e.name)?.gz)}`,
    )
    before.delete(e.name)
  }
  for (const gone of before.keys()) {
    lines.push(`  ${c.label(gone.padEnd(28))} ${c.dim('removed'.padStart(10))}`)
  }
  lines.push(
    `  ${c.label('other packaged files'.padEnd(28))} ${c.value(kB(otherPacked).padStart(10))}  ${deltaOf(otherPacked, base?.otherPacked)}`,
  )
  lines.push(
    `  ${c.label('tarball download'.padEnd(28))} ${c.value(kB(packed.size).padStart(10))}  ${deltaOf(packed.size, base?.tarball)}`,
  )
  lines.push(
    `  ${c.label('tarball on disk'.padEnd(28))} ${c.value(kB(packed.unpackedSize).padStart(10))}`,
  )
  return lines
}

function bench() {
  const out = run('npx', ['vitest', 'bench', '--run'], {
    MCP_VITEST_BENCH_TIME_MS: FAST ? '100' : '500',
  })
  const table = out
    .split('\n')
    .filter((l) => /·|name\s|hz|✓|×/.test(l) && !/^\s*$/.test(l))
    .map((l) => `  ${l.trimEnd()}`)
  return [
    c.head(
      FAST
        ? 'benchmarks (indicative: 100ms samples on your machine, expect 10-30% swing)'
        : 'benchmarks (500ms samples)',
    ),
    ...(table.length
      ? table
      : ['  no benchmark output captured', ...tail(out).map((l) => `  ${l}`)]),
  ]
}

function health() {
  const knipOut = run('npx', ['knip', '--no-progress'])
  const knip = knipOut
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `  ${l.trimEnd()}`)
  return [
    c.head('package health'),
    c.dim('  publint + attw: checked by npm run build'),
    // knip prints something whenever it has anything to say, so silence means
    // a clean run. Saying "no output" read like a malfunction instead of a pass.
    ...(knip.length ? knip : [c.good('  knip: no findings')]),
  ]
}

function coverage() {
  const out = run('npx', ['vitest', 'run', '--coverage', '--coverage.reporter=text-summary'])
  const summary = out
    .split('\n')
    .filter((l) => /Statements|Branches|Functions|Lines|Coverage report/.test(l))
    .map((l) => `  ${l.trim()}`)
  return [
    c.head('coverage'),
    ...(summary.length
      ? summary
      : ['  no coverage summary captured', ...tail(out).map((l) => `  ${l}`)]),
  ]
}

const SLOW_3G_BYTES_PER_SEC = 50 * 1024
const FOUR_G_BYTES_PER_SEC = 875 * 1024

/** npm's bundle size panel is Bundlephobia; read the same numbers it shows. */
function fetchPublishedBundle(version) {
  const out = run('curl', [
    '-s',
    '--max-time',
    '10',
    '-H',
    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    `https://bundlephobia.com/api/size?package=${pkg.name}@${version}`,
  ])
  try {
    const data = JSON.parse(out)
    return typeof data.gzip === 'number' ? data : null
  } catch {
    return null
  }
}

/** Minified size of our own code, dependencies external - not Bundlephobia comparable. */
function localMinified() {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vitest-min-'))
  try {
    run('npx', [
      'tsdown',
      'src/index.ts',
      '--format',
      'esm',
      '--minify',
      '--no-fixed-extension',
      '--out-dir',
      dir,
    ])
    const files = readdirSync(dir).filter((f) => f.endsWith('.js'))
    if (!files.length) return null
    let raw = 0
    const chunks = []
    for (const f of files) {
      const buf = readFileSync(join(dir, f))
      raw += buf.length
      chunks.push(buf)
    }
    return { raw, gz: gzipSync(Buffer.concat(chunks)).length }
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const ms = (bytes, rate) => `${Math.round((bytes / rate) * 1000)} ms`

function bundle() {
  const version = runOk('npm', ['view', pkg.name, 'version', ...NPM_TIMEOUT])?.trim()
  const published = version ? fetchPublishedBundle(version) : null
  const lines = []

  if (published) {
    const deps = published.dependencySizes ?? []
    const total = deps.reduce((sum, d) => sum + d.approximateSize, 0)
    lines.push(
      c.head(`bundle, published ${pkg.name}@${version} (Bundlephobia: bundled with dependencies)`),
      `  ${c.label('minified'.padEnd(24))} ${c.value(kB(published.size).padStart(10))}`,
      `  ${c.label('minified + gzipped'.padEnd(24))} ${c.value(kB(published.gzip).padStart(10))}`,
      `  ${c.label('download slow 3G'.padEnd(24))} ${c.value(ms(published.gzip, SLOW_3G_BYTES_PER_SEC).padStart(10))}`,
      `  ${c.label('download 4G'.padEnd(24))} ${c.value(ms(published.gzip, FOUR_G_BYTES_PER_SEC).padStart(10))}`,
      `  dependencies: ${published.dependencyCount ?? deps.length}`,
    )
    for (const d of deps.sort((a, b) => b.approximateSize - a.approximateSize)) {
      const pct = total ? ((d.approximateSize / total) * 100).toFixed(1) : '0.0'
      lines.push(
        `    ${c.label(d.name.padEnd(30))} ${c.value(kB(d.approximateSize).padStart(10))}  ${pct}%`,
      )
    }
  } else {
    lines.push(
      c.head('bundle, published: unavailable (offline, rate limited, or unpublished version)'),
    )
  }

  const local = localMinified()
  lines.push(
    local
      ? c.dim(
          `  local src/index.ts minified ${kB(local.raw)}, gzipped ${kB(local.gz)} (dependencies external, not comparable to the figures above)`,
        )
      : c.dim('  local minified: unavailable'),
  )
  return lines
}

const COLLECTORS = { size, bundle, bench, health, coverage }

if (ONLY?.length === 0) {
  console.log(
    `report: --only given no value, nothing to run (valid: ${Object.keys(COLLECTORS).join(', ')})`,
  )
}

const selected = (ONLY ?? Object.keys(COLLECTORS)).filter((name) => {
  if (COLLECTORS[name]) return true
  console.log(`report: no collector named ${name}`)
  return false
})

const started = Date.now()
for (const name of selected) {
  try {
    progress(`collecting ${name}`)
    const lines = COLLECTORS[name]()
    progressDone()
    console.log(`\n${lines.join('\n')}`)
  } catch (error) {
    progressDone()
    console.log(`\n${c.bad(`${name}: collector failed (${error.message})`)}`)
  }
}
console.log(
  c.dim(`\nreport: ${selected.join(', ')} in ${((Date.now() - started) / 1000).toFixed(1)}s`),
)
