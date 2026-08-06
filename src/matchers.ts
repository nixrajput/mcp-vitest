import { expect } from 'vitest'
import { McpHarness } from './harness.js'
import type { McpToolResult } from './types.js'

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
  return dp[a.length][b.length]
}

function suggest(name: string, candidates: string[]): string {
  const best = candidates.map((c) => ({ c, d: levenshtein(name, c) })).sort((x, y) => x.d - y.d)[0]
  return best && best.d <= 2 ? `. Did you mean "${best.c}"?` : ''
}

function assertHarness(received: unknown, matcher: string): asserts received is McpHarness {
  if (!(received instanceof McpHarness))
    throw new TypeError(`${matcher} expects an McpHarness (from mcpTest())`)
}

function textParts(result: McpToolResult): string[] {
  return (result.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
}

export const mcpMatchers = {
  async toHaveTool(received: unknown, name: string) {
    assertHarness(received, 'toHaveTool')
    const names = (await received.listTools()).map((t) => t.name)
    return {
      pass: names.includes(name),
      message: () =>
        `Expected server to have tool "${name}". Available tools: ` +
        `${names.join(', ') || '(none)'}${suggest(name, names)}`,
    }
  },

  async toHaveResource(received: unknown, uri: string) {
    assertHarness(received, 'toHaveResource')
    const uris = (await received.listResources()).map((r) => r.uri)
    return {
      pass: uris.includes(uri),
      message: () =>
        `Expected server to have resource "${uri}". Available resources: ` +
        `${uris.join(', ') || '(none)'}${suggest(uri, uris)}`,
    }
  },

  async toHavePrompt(received: unknown, name: string) {
    assertHarness(received, 'toHavePrompt')
    const names = (await received.listPrompts()).map((p) => p.name)
    return {
      pass: names.includes(name),
      message: () =>
        `Expected server to have prompt "${name}". Available prompts: ` +
        `${names.join(', ') || '(none)'}${suggest(name, names)}`,
    }
  },

  toHaveTextContent(received: McpToolResult, expected: string | RegExp) {
    const texts = textParts(received)
    const pass =
      typeof expected === 'string'
        ? texts.some((t) => t.includes(expected))
        : texts.some((t) => expected.test(t))
    return {
      pass,
      message: () =>
        `Expected tool result text content ${pass ? 'not ' : ''}to match ${String(expected)}. ` +
        `Text content: ${JSON.stringify(texts)}`,
    }
  },

  toBeToolError(received: McpToolResult, match?: string | RegExp) {
    if (received.isError !== true) {
      return {
        pass: false,
        message: () => 'Expected tool result to have isError: true',
      }
    }
    if (match === undefined)
      return {
        pass: true,
        message: () => 'Expected result not to be a tool error',
      }
    const texts = textParts(received)
    const pass =
      typeof match === 'string'
        ? texts.some((t) => t.includes(match))
        : texts.some((t) => match.test(t))
    return {
      pass,
      message: () =>
        `Tool errored, but error text ${pass ? 'matched' : 'did not match'} ${String(match)}. ` +
        `Text content: ${JSON.stringify(texts)}`,
    }
  },
}

export function registerMatchers(): void {
  expect.extend(mcpMatchers)
}

interface McpHarnessMatchers<R> {
  toHaveTool(name: string): Promise<R>
  toHaveResource(uri: string): Promise<R>
  toHavePrompt(name: string): Promise<R>
}

interface McpResultMatchers<R> {
  toHaveTextContent(expected: string | RegExp): R
  toBeToolError(match?: string | RegExp): R
}

declare module 'vitest' {
  // biome-ignore lint/suspicious/noExplicitAny: matcher augmentation is inherently loose
  interface Matchers<T = any> extends McpHarnessMatchers<T>, McpResultMatchers<T> {}
}
