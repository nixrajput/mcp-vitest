<div align="center">

# mcp-vitest

Vitest-native testing for **Model Context Protocol** servers - in-process, over the real MCP SDK, on both SDK majors.

<br />

[![npm](https://img.shields.io/npm/v/mcp-vitest?color=159F7C)][npm]
[![Stars](https://img.shields.io/github/stars/nixrajput/mcp-vitest?color=159F7C)][repo]
[![Contributors](https://img.shields.io/github/contributors/nixrajput/mcp-vitest?color=159F7C)][contributors]
[![License: MIT](https://img.shields.io/github/license/nixrajput/mcp-vitest?color=159F7C)][license]
[![Last commit](https://img.shields.io/github/last-commit/nixrajput/mcp-vitest?label=last%20commit)][repo]
[![Issues](https://img.shields.io/github/issues/nixrajput/mcp-vitest?label=issues)][issues]
[![PRs](https://img.shields.io/github/issues-pr/nixrajput/mcp-vitest?label=PRs)][pulls]

</div>

---

## Contents

- [mcp-vitest](#mcp-vitest)
  - [Contents](#contents)
  - [Overview](#overview)
  - [Features](#features)
  - [Tech stack](#tech-stack)
  - [Getting started](#getting-started)
    - [Prerequisites](#prerequisites)
    - [Install](#install)
    - [Quickstart](#quickstart)
  - [Works with both SDK majors](#works-with-both-sdk-majors)
  - [API](#api)
    - [`mcpTest(serverOrFactory, options?)`](#mcptestserverorfactory-options)
    - [`McpHarness`](#mcpharness)
    - [Call options](#call-options)
    - [Notifications](#notifications)
    - [Snapshot testing](#snapshot-testing)
    - [Structured output](#structured-output)
    - [`createMcpTest(serverOrFactory, options?)`](#createmcptestserverorfactory-options)
    - [Matchers](#matchers)
    - [`detectServerKind(server)`](#detectserverkindserver)
  - [Requirements](#requirements)
  - [Contributing](#contributing)
  - [Contributors](#contributors)
  - [License](#license)
  - [Support the project](#support-the-project)
  - [Connect](#connect)

## Overview

Testing an MCP server usually means spawning a subprocess, picking a port, or hand-rolling JSON-RPC frames. mcp-vitest does none of that: your server runs **in-process**, driven by a real SDK `Client` over the SDK's own in-process transport, and you get a small harness plus typed matchers on top. The protocol is never reimplemented, so what your tests exercise is what a real client would.

## Features

- **In-process, no subprocess** - no ports, no spawn, no teardown races.
- **Both SDK majors** - v1 over `InMemoryTransport`, v2 over the SDK's `handler.fetch` route. Detected automatically.
- **A small harness** - tools, resources, and prompts, with pagination followed for you, plus the raw SDK client as an escape hatch.
- **Typed matchers** - `toHaveTool`, `toHaveResource`, `toHavePrompt`, `toHaveTextContent`, `toHaveContent`, `toMatchOutputSchema`, `toBeToolError`, with TypeScript augmentation and did-you-mean suggestions on typos.
- **Regression safety** - snapshot manifests of your tool, resource, and prompt surface, normalized so they only change when your server does.
- **Real call ergonomics** - progress callbacks, `AbortSignal` cancellation, per-call timeouts, and a notification collector with `waitFor`.
- **A `test` fixture** - `createMcpTest()` gives a fresh, auto-closed harness per test via vitest's `test.extend`.
- **One runtime dependency** - `@cfworker/json-schema` (MIT, no transitive deps), used for output-schema validation. vitest and your MCP SDK stay peers, and the SDK peers are optional, so you install only the major you use.

## Tech stack

| Area          | Choice                                                      |
| ------------- | ----------------------------------------------------------- |
| Language      | TypeScript (strict), ESM only                               |
| Runtime       | Node.js `>=20`                                              |
| Test runner   | vitest `>=3.2` (peer)                                       |
| MCP SDK v1    | `@modelcontextprotocol/sdk` (optional peer)                 |
| MCP SDK v2    | `@modelcontextprotocol/server` + `/client` (optional peers) |
| Build         | tsdown, verified with publint + @arethetypeswrong/cli       |
| Lint / format | Biome                                                       |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) `>=20`
- [vitest](https://vitest.dev/) `>=3.2` in your project
- An MCP server built on either SDK major

### Install

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

### Quickstart

Register the matchers in your vitest config:

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["mcp-vitest/setup"] },
});
```

Then test your server:

```ts
import { expect } from "vitest";
import { createMcpTest } from "mcp-vitest";
import { createServer } from "./src/server.js";

const test = createMcpTest(() => createServer());

test("search tool works", async ({ mcp }) => {
  await expect(mcp).toHaveTool("search");
  const result = await mcp.callTool("search", { query: "foo" });
  expect(result).toHaveTextContent(/results/);
});
```

(Set `globals: true` in your vitest config if you would rather skip the `expect` import.)

## Works with both SDK majors

- **v1** (`@modelcontextprotocol/sdk`) servers connect over the SDK's `InMemoryTransport` linked pair - the 2025-era stateful lifecycle.
- **v2** (`@modelcontextprotocol/server`) servers connect over the SDK's in-process `handler.fetch` route - the 2026-07-28 stateless lifecycle.

You do not pick. `mcpTest()` detects which SDK your server instance comes from and routes to the matching transport; `mcp.kind` reports what it found (`'v1'` or `'v2'`). The same tests, matchers, and fixture work either way.

## API

### `mcpTest(serverOrFactory, options?)`

Connects a server and resolves with an [`McpHarness`](#mcpharness). Accepts an `McpServer` instance or a factory (sync or async) that returns one.

```ts
import { mcpTest } from "mcp-vitest";

const mcp = await mcpTest(() => createServer());
```

| Option      | Default | Meaning                                                             |
| ----------- | ------- | ------------------------------------------------------------------- |
| `autoClose` | `true`  | Close the harness via vitest's `onTestFinished` when inside a test. |

With `autoClose: false` you own the lifetime and call `mcp.close()` yourself. Outside a vitest test context, auto-close is skipped and closing is always yours.

### `McpHarness`

| Member                          | Returns                                       |
| ------------------------------- | --------------------------------------------- |
| `kind`                          | `'v1'` or `'v2'`                              |
| `client`                        | the underlying SDK client (escape hatch)      |
| `listTools()`                   | every tool, following pagination              |
| `callTool(name, args?, opts?)`  | the tool result - see [call options](#call-options) |
| `listResources()`               | every resource, following pagination          |
| `readResource(uri)`             | `{ contents }`                                |
| `listPrompts()`                 | every prompt, following pagination            |
| `getPrompt(name, args?)`        | `{ messages }`                                |
| `notifications(method?)`        | a [notification collector](#notifications)    |
| `close()`                       | disconnects; idempotent                       |

Anything the harness does not wrap is one hop away on `mcp.client`.

### Call options

`callTool` takes an options bag for progress, cancellation, and timeouts. Each option maps onto the underlying SDK's own request options, so behaviour is the SDK's, not a reimplementation.

```ts
// progress
const seen: number[] = []
await mcp.callTool('slow', { ms: 200 }, { onProgress: (p) => seen.push(p.progress) })

// cancellation
const ac = new AbortController()
setTimeout(() => ac.abort(), 50)
await expect(mcp.callTool('slow', { ms: 5000 }, { signal: ac.signal })).rejects.toThrow()

// timeout
await expect(mcp.callTool('slow', { ms: 5000 }, { timeoutMs: 100 })).rejects.toThrow()
```

| Option       | Type                                                              |
| ------------ | ----------------------------------------------------------------- |
| `onProgress` | `(p: { progress: number; total?: number; message?: string }) => void` |
| `signal`     | `AbortSignal`                                                     |
| `timeoutMs`  | `number`                                                          |

### Notifications

`mcp.notifications(method?)` starts collecting immediately and returns a collector. Pass a method to filter.

```ts
const progress = mcp.notifications('notifications/progress')
await mcp.callTool('slow', { ms: 100 })
expect(progress.items).toHaveLength(10)

// or wait for one that matters
const collector = mcp.notifications('notifications/progress')
const halfway = collector.waitFor((n) => n.params.progress >= 5)
await mcp.callTool('slow', { ms: 300 })
await expect(halfway).resolves.toMatchObject({ method: 'notifications/progress' })
```

Each item is `{ method, params, at }`, where `at` is milliseconds since the collector was created. `waitFor(predicate, timeoutMs = 5000)` resolves with the first match - including one already collected - and rejects with a timeout error otherwise. Pending waiters are abandoned when the harness closes, so a timeout never surfaces against a later test.

A progress token is attached to a call only when you pass `onProgress` or a collector is listening, so an otherwise bare `callTool` leaves the request untouched and your server's no-token path stays testable. Progress params arrive as `{ progress, total?, message? }`: the SDK consumes the token before handing them over, so items from two *concurrent* calls to the same tool cannot be told apart. Await one call at a time when you need to attribute them.

**v2 servers collect progress only.** Under the 2026-07-28 stateless lifecycle, `list_changed` notifications are delivered over `subscriptions/listen`, which this harness does not open yet. v1 servers collect every notification the client receives.

### Snapshot testing

Manifest helpers return normalized, deep-sorted objects - stable across runs, with entry-level `_meta` and `undefined` values dropped - so vitest's built-in snapshots catch unintended API changes to your server.

A manifest records what the server actually reports over the wire, which includes descriptor fields your MCP SDK adds for you (for example `execution` or a `$schema` on generated schemas). An SDK upgrade can therefore move a snapshot without your server changing; review the diff and update it as you would any snapshot. Capabilities your server does not expose come back empty rather than failing, so a tools-only server snapshots cleanly.

```ts
import { expect } from 'vitest'
import { capabilitiesManifest, toolManifest } from 'mcp-vitest/snapshot'

test('tool surface is unchanged', async ({ mcp }) => {
  expect(await toolManifest(mcp)).toMatchSnapshot()
})

test('capabilities are unchanged', async ({ mcp }) => {
  // { tools: string[], resources: string[], prompts: string[] }, names only
  expect(await capabilitiesManifest(mcp)).toMatchSnapshot()
})
```

`toolManifest`, `resourceManifest`, `promptManifest`, and `capabilitiesManifest` are available from `mcp-vitest/snapshot` or the package root.

### Structured output

`toMatchOutputSchema()` validates a result's `structuredContent` against the schema the tool declared in `tools/list`. Pass a JSON Schema explicitly to validate against something else.

```ts
const result = await mcp.callTool('weather')
expect(result).toMatchOutputSchema()
expect(result).toMatchOutputSchema({
  type: 'object',
  properties: { temperature: { type: 'number' }, unit: { type: 'string' } },
  required: ['temperature', 'unit'],
})
```

Note that both SDK majors validate declared output schemas server-side: if a tool's output violates its own schema, the call comes back as a tool error (`toBeToolError()`) rather than delivering invalid `structuredContent`. The explicit-schema form is what you want for asserting a contract the tool does not declare.

### `createMcpTest(serverOrFactory, options?)`

Returns a vitest `test` with an `mcp` fixture: a fresh harness per test, closed after each one. Same arguments as `mcpTest`.

```ts
import { expect } from "vitest";
import { createMcpTest } from "mcp-vitest";

const test = createMcpTest(() => createServer());

test("lists prompts", async ({ mcp }) => {
  await expect(mcp).toHavePrompt("greet");
});
```

### Matchers

| Matcher                            | Asserts                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `toHaveTool(name)`                 | the server exposes that tool (suggests near-misses on typos)               |
| `toHaveResource(uri)`              | the server exposes that resource                                            |
| `toHavePrompt(name)`               | the server exposes that prompt                                              |
| `toHaveTextContent(string\|regex)` | a tool result's text content matches                                        |
| `toHaveContent(partial)`           | some content part matches the given fields (values may be regexes)          |
| `toMatchOutputSchema(schema?)`     | `structuredContent` satisfies the tool's declared schema, or the one passed |
| `toBeToolError(string\|regex?)`    | a tool result has `isError: true`, optionally matching text                 |

The three server matchers query the live server, so they are async: `await expect(mcp).toHaveTool('x')`. The four result matchers are synchronous.

`setupFiles: ['mcp-vitest/setup']` registers all of them. To register them manually instead:

```ts
import { registerMatchers } from "mcp-vitest";

registerMatchers();
```

### `detectServerKind(server)`

Resolves `'v1'` or `'v2'` for an SDK server object, or rejects with a message naming what to pass instead. Exported for the rare case you need to branch on the SDK major yourself.

## Requirements

- Node.js `>=20`
- vitest `>=3.2`
- ESM only (no CJS build)

## Contributing

Contributions are welcome. Fork, branch, and open a PR - see [CONTRIBUTING.md](CONTRIBUTING.md) for the checks a PR has to pass. Bugs and ideas go to [Issues][issues]; questions to [Discussions][discussions]; vulnerabilities follow [SECURITY.md](SECURITY.md).

## Contributors

Thanks to everyone who has contributed to mcp-vitest.

<a href="https://github.com/nixrajput/mcp-vitest/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=nixrajput/mcp-vitest" alt="Contributors" />
</a>

## License

Licensed under the **MIT** license - see [LICENSE](LICENSE).

## Support the project

<div align="center">

If mcp-vitest saves you time, consider supporting its development. Sponsorship funds new features, faster fixes, and keeps the project independent.

<br />

<a href="https://github.com/sponsors/nixrajput">
  <img src="https://img.shields.io/badge/Sponsor_on_GitHub-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="GitHub Sponsors" />
</a>
<a href="https://ko-fi.com/nixrajput">
  <img src="https://img.shields.io/badge/Ko--fi-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white" alt="Ko-fi" />
</a>
<a href="https://www.buymeacoffee.com/nixrajput">
  <img src="https://img.shields.io/badge/Buy_Me_a_Coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy Me a Coffee" />
</a>

</div>

## Connect

<div align="center">

**Nikhil Rajput**

<a href="https://github.com/nixrajput"><img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub" /></a>
<a href="https://linkedin.com/in/nixrajput"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn" /></a>
<a href="https://x.com/nixrajput"><img src="https://img.shields.io/badge/X-000000?style=for-the-badge&logo=x&logoColor=white" alt="X" /></a>
<a href="https://instagram.com/nixrajput"><img src="https://img.shields.io/badge/Instagram-E4405F?style=for-the-badge&logo=instagram&logoColor=white" alt="Instagram" /></a>
<a href="https://telegram.me/nixrajput"><img src="https://img.shields.io/badge/Telegram-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" /></a>
<a href="mailto:nkr.nikhil.nkr@gmail.com"><img src="https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white" alt="Email" /></a>

</div>

[npm]: https://www.npmjs.com/package/mcp-vitest
[repo]: https://github.com/nixrajput/mcp-vitest
[issues]: https://github.com/nixrajput/mcp-vitest/issues
[pulls]: https://github.com/nixrajput/mcp-vitest/pulls
[discussions]: https://github.com/nixrajput/mcp-vitest/discussions
[contributors]: https://github.com/nixrajput/mcp-vitest/graphs/contributors
[license]: https://github.com/nixrajput/mcp-vitest/blob/main/LICENSE
