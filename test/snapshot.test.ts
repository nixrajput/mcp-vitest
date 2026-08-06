import { describe, expect, test } from 'vitest'
import { mcpTest } from '../src/index.js'
import { capabilitiesManifest, toolManifest } from '../src/snapshot.js'
import { createV1Server } from './servers/v1.js'

describe('snapshot manifests', () => {
  test('toolManifest is stable and sorted', async () => {
    const mcp = await mcpTest(createV1Server())
    const a = await toolManifest(mcp)
    const b = await toolManifest(mcp)
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).toMatchSnapshot()
  })

  test('capabilitiesManifest lists names only', async () => {
    const mcp = await mcpTest(createV1Server())
    const caps = (await capabilitiesManifest(mcp)) as { tools: string[] }
    expect(caps.tools).toEqual([...caps.tools].sort())
    expect(caps.tools).toContain('echo')
    expect(caps).toMatchSnapshot()
  })
})
