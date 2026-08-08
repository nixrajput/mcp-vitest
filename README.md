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
    - [Testing an external server](#testing-an-external-server)
    - [`serveHandler(handler)`](#servehandlerhandler)
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

- **In-process** - no ports, no spawn, no teardown races. Both SDK majors, detected automatically.
- **Typed matchers** - seven of them, with TypeScript augmentation and did-you-mean suggestions on typos.
- **A small harness** - tools, resources, and prompts with pagination followed for you, plus the raw SDK client as an escape hatch.
- **Interaction doubles** - answer a server's sampling, elicitation, and roots requests from your test.
- **External servers** - spawn one over stdio or point at a running URL; everything above works unchanged.
- **Lifecycle coverage** - run the same tests against the 2025 and 2026-07-28 protocol revisions.
- **Regression safety** - snapshot manifests normalized so key order and absent optionals never churn them.
- **Real call ergonomics** - progress callbacks, `AbortSignal` cancellation, per-call timeouts, and a notification collector with `waitFor`.
- **One runtime dependency** - `@cfworker/json-schema` (MIT, no transitive deps). Your MCP SDK is an optional peer, so you install only the major you use.

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

- **v1** (`@modelcontextprotocol/sdk`) connects over the SDK's `InMemoryTransport` linked pair.
- **v2** (`@modelcontextprotocol/server`) connects over the SDK's in-process `handler.fetch` route.

You do not pick. `mcpTest()` detects which SDK your server came from and routes to the matching transport; `mcp.kind` reports what it found. The same tests, matchers, and fixture work either way - including against [external servers](#testing-an-external-server), which report `'external'`. Which protocol revision each lane speaks is covered under [lifecycles](#lifecycles).

## API

### `mcpTest(serverOrFactory, options?)`

Connects a server and resolves with an [`McpHarness`](#mcpharness). Accepts an `McpServer` instance, a factory (sync or async) that returns one, or a spec for a server you cannot import - `{ command, args? }` to spawn one over stdio, or `{ url, headers? }` to reach one over HTTP. See [testing an external server](#testing-an-external-server).

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
| `kind`                         | `'v1'`, `'v2'`, or `'external'`                          |
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

`callTool` takes an options bag for progress, cancellation, and timeouts. Each option maps onto the underlying SDK's own request options, so behavior is the SDK's, not a reimplementation.

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

Each item is `{ method, params, at }`, where `at` is milliseconds since the collector was created. `waitFor(predicate, timeoutMs = 5000)` resolves with the first match - including one already collected - and abandons pending waiters on close, so a timeout never surfaces against a later test.

A progress token is attached only when you pass `onProgress` or a collector is listening, so a bare `callTool` leaves the request untouched and your server's no-token path stays testable. Params arrive as `{ progress, total?, message? }`; the SDK consumes the token first, so items from two _concurrent_ calls to the same tool cannot be told apart - await one at a time when you need to attribute them.

**v2 servers collect progress only.** The 2026-07-28 lifecycle is stateless, so there is no persistent server to push `list_changed` from, and the SDK's server side does not emit it - a `subscriptions/listen` for it succeeds but honours nothing. A gap upstream rather than one the harness withholds; it will be wired up when the SDK sends those notifications. v1 servers collect everything the client receives.

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

Register a double any time before the call that triggers it. Decline and cancel are ordinary results, so `{ action: 'decline' }` exercises the path where the user says no. Forget one and you get a named error rather than a hang: `the server requested sampling but no double is registered.`

A missing double surfaces differently per SDK major, because the mechanisms differ - v1 pushes the request to the client, v2 answers it locally and retries:

```ts
// v1: comes back as a tool error
expect(await mcp.callTool("summarize", { text: "x" })).toBeToolError(
  /no double/,
);
// v2: rejects the call
await expect(mcp.callTool("summarize", { text: "x" })).rejects.toThrow(
  /no double/,
);
```

Three things worth knowing:

- **Doubles need a connection that can carry server-initiated requests.** That is the default everywhere except a v2 or URL connection held to a 2025 revision, which has no such channel - registering there throws immediately rather than letting the call stall.
- **Sampling and roots are deprecated** as of 2026-07-28 (SEP-2577), with at least a twelve-month window. Elicitation is not.
- **On v2, a call that uses a double emits an extra progress event** the server never sent - the SDK reports each fulfillment round through the progress channel. It reaches `onProgress` and any progress collector, so assert on the events you care about rather than a bare count.

### Roots

`onRoots` serves the server's `roots/list` requests. **v1 only** - roots is deprecated in the 2026-07-28 revision, so the v2 lane does not advertise the capability and `onRoots` throws there rather than accepting a double that would never fire.

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

The 2025 revisions are stateful and let a server push requests to a client; 2026-07-28 is stateless and carries them in-band instead. A server claiming to serve both should be tested on both, so `createMcpTest` can run every test once per revision.

```ts
const test = createMcpTest(() => createServer(), {
  lifecycles: ["2025-11-25", "2026-07-28"],
});

test("echo works on every lifecycle", async ({ mcp }) => {
  const result = await mcp.callTool("echo", { message: "x" });
  expect(result).toHaveTextContent("echo: x");
});
```

Each test is registered once per revision with the revision appended to its name, each with its own harness, and `mcp.lifecycle` tells a test which one it is on. For a single revision, `protocolVersion` is simpler than a one-element matrix.

| Lane  | `'2025-11-25'`                    | `'2026-07-28'`                      |
| ----- | --------------------------------- | ----------------------------------- |
| v1    | the only revision it negotiates   | throws - the v1 SDK cannot serve it |
| v2    | legacy mode; no doubles available | default; full support               |
| stdio | the only revision it negotiates   | throws - stdio is driven by v1      |
| url   | legacy mode; no doubles available | pinned; otherwise auto-negotiated   |

Exactly two revisions are selectable, which is an SDK property rather than a choice: pinning accepts modern revisions only, and the 2025 era is reachable just as "legacy". `2025-06-18` cannot be pinned. In `lifecycles` mode the returned test is typed `LifecycleMcpTest` and registers plain tests only, so `.skip`, `.only`, `.each`, and `.extend` are compile errors rather than runtime surprises.

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

### Testing an external server

Not every server can be imported. `mcpTest` also takes a spawn spec or a URL, and everything else - matchers, collectors, doubles, snapshots - works exactly as in-process. Both report `mcp.kind === 'external'`.

```ts
// spawn one over stdio; env and cwd are accepted too
const mcp = await mcpTest({ command: "node", args: ["./dist/server.js"] });

// or reach one already running, over Streamable HTTP
const mcp = await mcpTest({
  url: "https://example.com/mcp",
  headers: { authorization: "Bearer test-token" },
});
```

The child process is terminated when the harness closes, which the fixture does for you. `headers` are merged into every request, which is the seam for auth-protected servers.

Two things that surprise people:

- **`env` does not extend your environment, it replaces most of it.** The SDK starts from a small allowlist (`HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`, and platform equivalents) and merges yours on top, so a server reading `API_KEY` from the ambient environment will not see it unless you pass it explicitly.
- **A URL connection does not pin a protocol revision.** The server is not yours and may implement any era, so negotiation probes and meets it where it is. Pass `protocolVersion` to hold it to one.

### `serveHandler(handler)`

Binds a fetch-style handler - what both SDK majors' HTTP handlers expose - to an ephemeral loopback port, so you can point the URL transport at your own server without picking a port:

```ts
import { serveHandler } from "mcp-vitest";
import { createMcpHandler } from "@modelcontextprotocol/server";

const served = await serveHandler(createMcpHandler(() => createServer()));
const mcp = await mcpTest({ url: `${served.url}/mcp` });
// ...
await served.close();
```

### `detectServerKind(server)`

Resolves `'v1'` or `'v2'` for an SDK server object, or rejects with a message naming what to pass instead. Exported for the rare case you need to branch on the SDK major yourself.

## Migrating from 0.2

Everything from 0.2 keeps working. Three changes alter what your server sees, so they are worth a look if a suite starts behaving differently.

| Change                                                                                                                                                                                | Effect                                                                                                                                                             | If it bites                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **v2 connections now negotiate 2026-07-28.** Through 0.2.1 the v2 lane silently ran `2025-11-25`, because `versionNegotiation` defaults to `'legacy'`.                                | The 2026 era is required for doubles to work at all. Progress collection was verified unaffected.                                                                  | `mcpTest(server, { protocolVersion: '2025-11-25' })` restores the old behavior.            |
| **The client now advertises `sampling`, `elicitation`, and `roots`.** Capabilities are declared at connect, before a test body can register a double, so they go out unconditionally. | A server that branches on client capabilities now takes its sampling or elicitation path where 0.2.1 took the fallback, then fails with `no double is registered`. | Register the double, or assert the fallback against a server built without those branches. |
| **`SdkClientLike` gained a required `complete()`.**                                                                                                                                   | Only affects a hand-written `SdkClientLike` or `RawConnection`.                                                                                                    | Add the method. Nothing else changed shape.                                                |
| **`RawConnection` gained a required `supports`.** | Same audience: a hand-written connection must declare `{ roots, serverInitiatedRequests }`. | Add the field. It is required on purpose - an absent one would read as "supports everything". |

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

mcp-vitest is MIT licensed and free to use, always. If it earns a place in your test suite, sponsorship is welcome.

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
