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
    - [Testing sampling and elicitation](#testing-sampling-and-elicitation)
    - [Roots](#roots)
    - [Completions](#completions)
    - [`createMcpTest(serverOrFactory, options?)`](#createmcptestserverorfactory-options)
    - [Lifecycles](#lifecycles)
    - [Matchers](#matchers)
    - [`detectServerKind(server)`](#detectserverkindserver)
  - [Migrating from 0.2](#migrating-from-02)
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
- **Regression safety** - snapshot manifests of your tool, resource, and prompt surface, normalized so key order and absent optionals never churn them.
- **Real call ergonomics** - progress callbacks, `AbortSignal` cancellation, per-call timeouts, and a notification collector with `waitFor`.
- **Interaction doubles** - answer a server's sampling, elicitation, and roots requests from your test, over the 2025 push model and the 2026 multi-round-trip flow alike.
- **Lifecycle coverage** - run the same tests against the 2025 and 2026-07-28 protocol revisions, one harness each.
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

- **v1** (`@modelcontextprotocol/sdk`) servers connect over the SDK's `InMemoryTransport` linked pair - the 2025-era stateful lifecycle, the only one that SDK negotiates.
- **v2** (`@modelcontextprotocol/server`) servers connect over the SDK's in-process `handler.fetch` route, held to the 2026-07-28 stateless lifecycle by default and able to run the 2025 era too - see [lifecycles](#lifecycles).

You do not pick the transport. `mcpTest()` detects which SDK your server instance comes from and routes to the matching one; `mcp.kind` reports what it found (`'v1'` or `'v2'`). The same tests, matchers, and fixture work either way.

## API

### `mcpTest(serverOrFactory, options?)`

Connects a server and resolves with an [`McpHarness`](#mcpharness). Accepts an `McpServer` instance or a factory (sync or async) that returns one.

```ts
import { mcpTest } from "mcp-vitest";

const mcp = await mcpTest(() => createServer());
```

| Option            | Default             | Meaning                                                                       |
| ----------------- | ------------------- | ----------------------------------------------------------------------------- |
| `autoClose`       | `true`              | Close the harness via vitest's `onTestFinished` when inside a test.           |
| `protocolVersion` | `'2026-07-28'` (v2) | Hold the connection to one protocol revision - see [lifecycles](#lifecycles). |

With `autoClose: false` you own the lifetime and call `mcp.close()` yourself. Outside a vitest test context, auto-close is skipped and closing is always yours.

### `McpHarness`

| Member                         | Returns                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `kind`                         | `'v1'` or `'v2'`                                         |
| `lifecycle`                    | the protocol revision this connection is held to, if any |
| `client`                       | the underlying SDK client (escape hatch)                 |
| `listTools()`                  | every tool, following pagination                         |
| `callTool(name, args?, opts?)` | the tool result - see [call options](#call-options)      |
| `listResources()`              | every resource, following pagination                     |
| `readResource(uri)`            | `{ contents }`                                           |
| `listPrompts()`                | every prompt, following pagination                       |
| `getPrompt(name, args?)`       | `{ messages }`                                           |
| `complete(ref, argument)`      | `{ completion }` - see [completions](#completions)       |
| `onSampling(double)`           | answers the server's sampling requests                   |
| `onElicitation(double)`        | answers the server's elicitation requests                |
| `onRoots(roots)`               | serves `roots/list` (v1 only)                            |
| `notifications(method?)`       | a [notification collector](#notifications)               |
| `close()`                      | disconnects; idempotent                                  |

Anything the harness does not wrap is one hop away on `mcp.client`.

### Call options

`callTool` takes an options bag for progress, cancellation, and timeouts. Each option maps onto the underlying SDK's own request options, so behaviour is the SDK's, not a reimplementation.

```ts
// progress
const seen: number[] = [];
await mcp.callTool(
  "slow",
  { ms: 200 },
  { onProgress: (p) => seen.push(p.progress) },
);

// cancellation
const ac = new AbortController();
setTimeout(() => ac.abort(), 50);
await expect(
  mcp.callTool("slow", { ms: 5000 }, { signal: ac.signal }),
).rejects.toThrow();

// timeout
await expect(
  mcp.callTool("slow", { ms: 5000 }, { timeoutMs: 100 }),
).rejects.toThrow();
```

| Option       | Type                                                                  |
| ------------ | --------------------------------------------------------------------- |
| `onProgress` | `(p: { progress: number; total?: number; message?: string }) => void` |
| `signal`     | `AbortSignal`                                                         |
| `timeoutMs`  | `number`                                                              |

### Notifications

`mcp.notifications(method?)` starts collecting immediately and returns a collector. Pass a method to filter.

```ts
const progress = mcp.notifications("notifications/progress");
await mcp.callTool("slow", { ms: 100 });
expect(progress.items).toHaveLength(10);

// or wait for one that matters
const collector = mcp.notifications("notifications/progress");
const halfway = collector.waitFor((n) => n.params.progress >= 5);
await mcp.callTool("slow", { ms: 300 });
await expect(halfway).resolves.toMatchObject({
  method: "notifications/progress",
});
```

Each item is `{ method, params, at }`, where `at` is milliseconds since the collector was created. `waitFor(predicate, timeoutMs = 5000)` resolves with the first match - including one already collected - and rejects with a timeout error otherwise. Pending waiters are abandoned when the harness closes, so a timeout never surfaces against a later test.

A progress token is attached to a call only when you pass `onProgress` or a collector is listening, so an otherwise bare `callTool` leaves the request untouched and your server's no-token path stays testable. Progress params arrive as `{ progress, total?, message? }`: the SDK consumes the token before handing them over, so items from two _concurrent_ calls to the same tool cannot be told apart. Await one call at a time when you need to attribute them.

**v2 servers collect progress only.** Under the 2026-07-28 stateless lifecycle, `list_changed` notifications are delivered over `subscriptions/listen`, which this harness does not open yet. v1 servers collect every notification the client receives.

### Snapshot testing

Manifest helpers return normalized, deep-sorted objects - stable across runs, with entry-level `_meta` and `undefined` values dropped - so vitest's built-in snapshots catch unintended API changes to your server.

A manifest records what the server actually reports over the wire, which includes descriptor fields your MCP SDK adds for you (for example `execution` or a `$schema` on generated schemas). An SDK upgrade can therefore move a snapshot without your server changing; review the diff and update it as you would any snapshot. Capabilities your server does not expose come back empty rather than failing, so a tools-only server snapshots cleanly.

```ts
import { expect } from "vitest";
import { capabilitiesManifest, toolManifest } from "mcp-vitest/snapshot";

test("tool surface is unchanged", async ({ mcp }) => {
  expect(await toolManifest(mcp)).toMatchSnapshot();
});

test("capabilities are unchanged", async ({ mcp }) => {
  // { tools: string[], resources: string[], prompts: string[] }, names only
  expect(await capabilitiesManifest(mcp)).toMatchSnapshot();
});
```

`toolManifest`, `resourceManifest`, `promptManifest`, and `capabilitiesManifest` are available from `mcp-vitest/snapshot` or the package root.

### Structured output

`toMatchOutputSchema()` validates a result's `structuredContent` against the schema the tool declared in `tools/list`. Pass a JSON Schema explicitly to validate against something else.

```ts
const result = await mcp.callTool("weather");
expect(result).toMatchOutputSchema();
expect(result).toMatchOutputSchema({
  type: "object",
  properties: { temperature: { type: "number" }, unit: { type: "string" } },
  required: ["temperature", "unit"],
});
```

Note that both SDK majors validate declared output schemas server-side: if a tool's output violates its own schema, the call comes back as a tool error (`toBeToolError()`) rather than delivering invalid `structuredContent`. The explicit-schema form is what you want for asserting a contract the tool does not declare.

### Testing sampling and elicitation

When a tool asks the client for something - an LLM completion, a confirmation from the user - your test supplies the answer. Register a double and the harness answers on the client's behalf; the tool never knows the difference.

```ts
const mcp = await mcpTest(() => createServer());

// a function double sees the request
mcp.onSampling((req) => {
  expect(req.maxTokens).toBe(50);
  return {
    model: "double",
    role: "assistant",
    content: { type: "text", text: "short" },
  };
});

// or pass a constant result for elicitation
mcp.onElicitation({ action: "accept", content: { confirm: true } });

const result = await mcp.callTool("summarize", { text: "a very long text" });
expect(result).toHaveTextContent("summary: short");
```

Register a double any time before the call that triggers it - the handlers read the registry at call time, not at connect. Decline and cancel are ordinary results, so `{ action: 'decline' }` exercises the path where the user says no.

One interaction to be aware of if you also collect progress: on v2, the SDK's input-required driver reports each fulfilment round through the progress channel, so a call that uses a double emits an extra progress event (`Fulfilling input required by 'tools/call' (round 1)`) that no server sent. It reaches both `onProgress` and any `notifications('notifications/progress')` collector. Assert on the events you care about rather than on a bare count.

If a server asks for something you have not registered, mcp-vitest says so by name rather than hanging: `the server requested sampling but no double is registered. Call harness.onSampling(...) before triggering it.`

The mechanism differs by SDK major, and the difference is visible in one place. v1 uses the 2025 push model, so a missing double surfaces as a tool error. v2 uses the 2026 multi-round-trip flow, where the client answers locally and retries, so a missing double rejects the call directly:

```ts
// v1
expect(await mcp.callTool("summarize", { text: "x" })).toBeToolError(
  /no double is registered/,
);
// v2
await expect(mcp.callTool("summarize", { text: "x" })).rejects.toThrow(
  /no double is registered/,
);
```

> **On v2, doubles require the 2026-07-28 lifecycle**, which is the default. A v2 connection held to a 2025 revision has no channel for server-to-client requests at all, so `onSampling`/`onElicitation` throw immediately there instead of letting the call stall.
>
> **Sampling is deprecated** as of the 2026-07-28 revision (SEP-2577), along with roots. Both keep working for at least a twelve-month window; elicitation is not deprecated.

### Roots

`onRoots` serves the server's `roots/list` requests. **v1 only** - roots is deprecated in the 2026-07-28 revision, so it is not wired for v2.

```ts
mcp.onRoots([{ uri: "file:///workspace" }]);
const result = await mcp.callTool("list-roots");
expect(result).toHaveTextContent("roots: file:///workspace");
```

### Completions

`complete()` asks the server to complete a prompt argument or a resource-template variable, the same call an editor's autocomplete would make.

```ts
const { completion } = await mcp.complete(
  { type: "ref/prompt", name: "greet" },
  { name: "name", value: "A" },
);
expect(completion.values).toEqual(["Ada", "Alan"]);
```

Pass `{ type: 'ref/resource', uri }` to complete a resource template instead.

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

### Lifecycles

MCP revised its lifecycle in 2026-07-28: the 2025 revisions are stateful and let a server push requests to a client, while 2026-07-28 is stateless and carries those requests in-band instead. A server that claims to serve both should be tested on both, so `createMcpTest` can run every test once per revision.

```ts
const test = createMcpTest(() => createServer(), {
  lifecycles: ["2025-11-25", "2026-07-28"],
});

test("echo works on every lifecycle", async ({ mcp }) => {
  const result = await mcp.callTool("echo", { message: "x" });
  expect(result).toHaveTextContent("echo: x");
});
```

That registers `echo works on every lifecycle [2025-11-25]` and `echo works on every lifecycle [2026-07-28]`, each with its own harness. `mcp.lifecycle` tells a test which revision it is running on.

Two revisions are selectable, and that is a property of the SDK rather than a choice: pinning accepts modern revisions only, and the 2025 era is reachable only as "legacy", which lands on the newest 2025 revision. Earlier revisions such as `2025-06-18` cannot be pinned.

| Server | `'2025-11-25'`                    | `'2026-07-28'`                      |
| ------ | --------------------------------- | ----------------------------------- |
| v1     | the only revision it negotiates   | throws - the v1 SDK cannot serve it |
| v2     | legacy mode; no doubles available | default; full support               |

Two limits worth knowing. In `lifecycles` mode the returned value registers plain tests only: it is typed as `LifecycleMcpTest`, so `.skip`, `.only`, `.each`, and `.extend` are compile errors rather than runtime surprises. And for a single revision, `protocolVersion` on `mcpTest` or `createMcpTest` is simpler than a one-element matrix.

### Matchers

| Matcher                            | Asserts                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `toHaveTool(name)`                 | the server exposes that tool (suggests near-misses on typos)                |
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

## Migrating from 0.2

Everything from 0.2 keeps working. Two changes alter what your server sees, so they are worth a look if a suite starts behaving differently.

**v2 connections now negotiate 2026-07-28.** Through 0.2.1 the v2 lane negotiated `2025-11-25`, because the client's `versionNegotiation` defaults to `'legacy'` and nothing overrode it. The 2026 era is required for doubles to work at all - a 2025-era v2 connection has no channel for server-to-client requests. Progress collection was verified unaffected by the change. To get the old behavior:

```ts
const mcp = await mcpTest(() => createServer(), {
  protocolVersion: "2025-11-25",
});
```

**The test client now advertises `sampling`, `elicitation`, and `roots`.** Capabilities are declared at connect, long before a test body can register a double, so they are advertised unconditionally. If your server branches on the client's declared capabilities, it will now take its sampling or elicitation path where 0.2.1 made it take the fallback - and without a registered double that call fails with `the server requested sampling but no double is registered`. Register the double, or assert the fallback path against a server you construct without those branches.

One type-level note for the rare case it applies: `SdkClientLike` gained a required `complete()` member, so a hand-written implementation of `SdkClientLike` or `RawConnection` needs that method added. Nothing else in the public surface changed shape.

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
