# mcp-vitest

> Vitest-native testing for Model Context Protocol (MCP) servers.

Your server runs in-process, driven by a real MCP SDK client over a real
transport. No subprocess, no port, no protocol reimplementation.

## Install

```bash
npm i -D mcp-vitest vitest
```

Plus the SDK your server uses:

```bash
# SDK v1
npm i -D @modelcontextprotocol/sdk

# SDK v2
npm i -D @modelcontextprotocol/server @modelcontextprotocol/client
```

## Quickstart

Register the matchers in your vitest config:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { setupFiles: ['mcp-vitest/setup'] },
})
```

Then write tests against your server:

```ts
import { createMcpTest } from 'mcp-vitest'
import { createServer } from './src/server.js'

const test = createMcpTest(() => createServer())

test('search tool works', async ({ mcp }) => {
  await expect(mcp).toHaveTool('search')
  const result = await mcp.callTool('search', { query: 'foo' })
  expect(result).toHaveTextContent(/results/)
})
```

## Works with both SDK majors

- **v1** (`@modelcontextprotocol/sdk`) servers connect over the SDK's
  `InMemoryTransport` linked pair.
- **v2** (`@modelcontextprotocol/server`) servers connect over the SDK's
  in-process `handler.fetch` route, which exercises the 2026-07-28 stateless
  lifecycle.

You do not pick: `mcpTest()` detects which SDK your server comes from and
routes to the right transport. `mcp.kind` tells you what it found.

## API

### `mcpTest(serverOrFactory, options?)`

Connects a server and resolves with an `McpHarness`. Accepts an `McpServer`
instance or a factory (sync or async) returning one.

```ts
import { mcpTest } from 'mcp-vitest'

const mcp = await mcpTest(() => createServer())
```

Inside a vitest test the harness closes itself via `onTestFinished`. Pass
`{ autoClose: false }` to own the lifetime yourself and call `mcp.close()`.

### `McpHarness`

| Method                    | Returns                                        |
| ------------------------- | ---------------------------------------------- |
| `listTools()`             | every tool, following pagination               |
| `callTool(name, args?)`   | the tool result                                |
| `listResources()`         | every resource, following pagination           |
| `readResource(uri)`       | `{ contents }`                                 |
| `listPrompts()`           | every prompt, following pagination             |
| `getPrompt(name, args?)`  | `{ messages }`                                 |
| `close()`                 | disconnects (idempotent)                       |

`mcp.kind` is `'v1'` or `'v2'`. `mcp.client` is the underlying SDK client, for
anything the harness does not wrap.

### `createMcpTest(serverOrFactory, options?)`

Returns a vitest `test` with an `mcp` fixture: a fresh harness per test,
closed after each one.

```ts
const test = createMcpTest(() => createServer())

test('lists prompts', async ({ mcp }) => {
  await expect(mcp).toHavePrompt('greet')
})
```

### Matchers

| Matcher                            | Asserts                                                     |
| ---------------------------------- | ----------------------------------------------------------- |
| `toHaveTool(name)`                 | the server exposes that tool (suggests near-misses on typos) |
| `toHaveResource(uri)`              | the server exposes that resource                            |
| `toHavePrompt(name)`               | the server exposes that prompt                              |
| `toHaveTextContent(string\|regex)` | a tool result's text content matches                        |
| `toBeToolError(string\|regex?)`    | a tool result has `isError: true`, optionally matching text  |

The three server matchers are async - `await expect(mcp).toHaveTool('x')`.

`setupFiles: ['mcp-vitest/setup']` registers them globally. To register them
yourself instead:

```ts
import { registerMatchers } from 'mcp-vitest'

registerMatchers()
```

### `detectServerKind(server)`

Resolves `'v1'` or `'v2'`, or rejects if the object is not an SDK server.

## Requirements

- Node >= 20
- vitest >= 3.2
- ESM only

## License

[MIT](LICENSE)
