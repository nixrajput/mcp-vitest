#!/usr/bin/env node
/**
 * Inform-only size / bench / health / coverage report.
 *
 * Exits 0 no matter what it finds: CI is the enforcement, this exists so a
 * regression is visible before the push rather than after the publish.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const argv = process.argv.slice(2)
const FAST = argv.includes('--fast')

function parseOnly() {
  const eq = argv.find((a) => a.startsWith('--only='))
  if (eq) return eq.slice('--only='.length)
  const i = argv.indexOf('--only')
  return i >= 0 ? argv[i + 1] : undefined
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
    })
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
}

/** Like run(), but returns null on a non-zero exit instead of the error text. */
function runOk(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

const kB = (n) => `${(n / 1024).toFixed(2)} kB`

function deltaOf(now, before) {
  if (before === undefined) return 'new'
  const d = now - before
  if (d === 0) return '='
  const pct = before === 0 ? 0 : Math.round((d / before) * 100)
  return `${d > 0 ? '+' : ''}${kB(d)} (${d > 0 ? '+' : ''}${pct}%)`
}

// tsdown gives shared chunks a content hash, so the same logical file has a
// different name in every build. Collapse the hash to compare like with like.
// ponytail: prefix match, not a manifest. An entry literally named
// "foo-abcdefgh.js" would collapse too; ours are index/matchers/setup/snapshot.
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

/** Downloads the published tarball and measures its dist. null when offline. */
function publishedBaseline() {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vitest-baseline-'))
  try {
    const version = runOk('npm', ['view', pkg.name, 'version'])?.trim()
    if (!version) return null
    run('npm', ['pack', `${pkg.name}@${version}`, '--pack-destination', dir])
    const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'))
    if (!tgz) return null
    const tarball = statSync(join(dir, tgz)).size
    run('tar', ['xzf', join(dir, tgz), '-C', dir])
    return { version, tarball, entries: measureDist(join(dir, 'package', 'dist')) }
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function size() {
  // In hook mode the gate built dist/ seconds ago; rebuilding wastes ~1.9s.
  const buildOutput = FAST ? '' : run('npm', ['run', 'build'])
  let local
  try {
    local = measureDist('dist')
  } catch (error) {
    const tail = buildOutput.trim().split('\n').slice(-10).join('\n')
    return [
      'bundle size, gzipped: build failed, dist/ missing or unreadable',
      tail || `(no build output captured: ${error.message})`,
    ]
  }
  const packed = JSON.parse(run('npm', ['pack', '--dry-run', '--json']))[0]
  const base = publishedBaseline()
  const before = new Map((base?.entries ?? []).map((e) => [e.name, e]))

  const lines = [
    base
      ? `bundle size, gzipped, vs ${pkg.name}@${base.version} on npm`
      : 'bundle size, gzipped (no published baseline: offline or unpublished)',
  ]
  for (const e of local) {
    lines.push(
      `  ${e.name.padEnd(28)} ${kB(e.gz).padStart(10)}  ${deltaOf(e.gz, before.get(e.name)?.gz)}`,
    )
    before.delete(e.name)
  }
  for (const gone of before.keys()) lines.push(`  ${gone.padEnd(28)} ${'removed'.padStart(10)}`)
  lines.push(
    `  ${'tarball download'.padEnd(28)} ${kB(packed.size).padStart(10)}  ${deltaOf(packed.size, base?.tarball)}`,
  )
  lines.push(`  ${'tarball on disk'.padEnd(28)} ${kB(packed.unpackedSize).padStart(10)}`)
  return lines
}

const COLLECTORS = { size }

const selected = (ONLY ?? Object.keys(COLLECTORS)).filter((name) => {
  if (COLLECTORS[name]) return true
  console.log(`report: no collector named ${name}`)
  return false
})

const started = Date.now()
for (const name of selected) {
  try {
    console.log(`\n${COLLECTORS[name]().join('\n')}`)
  } catch (error) {
    console.log(`\n${name}: collector failed (${error.message})`)
  }
}
console.log(`\nreport: ${selected.join(', ')} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
