<div align="center">

<img src="https://raw.githubusercontent.com/nixrajput/mcp-vitest/main/assets/logo.svg" width="76" alt="mcp-vitest">

# mcp-vitest

<em>Test your MCP server the way you test everything else.</em>

<br />

[![CI](https://github.com/nixrajput/mcp-vitest/actions/workflows/ci.yml/badge.svg)][ci]
[![npm](https://img.shields.io/npm/v/mcp-vitest?color=159F7C)][npm]
[![Stars](https://img.shields.io/github/stars/nixrajput/mcp-vitest?color=159F7C)][repo]
[![Contributors](https://img.shields.io/github/contributors/nixrajput/mcp-vitest?color=159F7C)][contributors]
[![License: MIT](https://img.shields.io/github/license/nixrajput/mcp-vitest?color=159F7C)][license]
[![Last commit](https://img.shields.io/github/last-commit/nixrajput/mcp-vitest?label=last%20commit)][repo]
[![Issues](https://img.shields.io/github/issues/nixrajput/mcp-vitest?label=issues)][issues]
[![PRs](https://img.shields.io/github/issues-pr/nixrajput/mcp-vitest?label=PRs)][pulls]

<strong>In-process &middot; both SDK majors &middot; both protocol revisions &middot; seven typed matchers &middot; one runtime dependency</strong><br>
<sub>A fresh server plus a full <code>initialize</code> handshake, per test, costs <strong>0.24ms on SDK v1 and 0.47ms on v2</strong> - means across 8,270 and 4,284 samples at &plusmn;2.3% and &plusmn;3.6%, reproducible with <code>npm run bench</code>. There is no subprocess and no socket to pay for. Also checkable: <strong>157 tests</strong> across the two SDK lanes, which connect over <em>different transports</em> and so are covered separately rather than assumed equivalent; the v2 lane <strong>pins the 2026-07-28 revision</strong>, which is what makes the two lanes cover different protocol eras instead of the same one twice; and every build is verified with <strong>publint</strong> and <strong>@arethetypeswrong/cli</strong>. <a href="https://github.com/nixrajput/mcp-vitest/actions/workflows/ci.yml">See the runs</a>.</sub>

<br />

**[Documentation][docs]** &middot; [Getting started][docs-start] &middot; [API reference][docs-api] &middot; [Lifecycles][docs-lifecycles]

<sub><b>AI agents / LLMs:</b> the documentation is machine-readable at <a href="https://mcp-vitest.nixrajput.com/llms.txt"><code>llms.txt</code></a>, or as one blob at <a href="https://mcp-vitest.nixrajput.com/llms-full.txt"><code>llms-full.txt</code></a>.</sub>

</div>

---

## Contents

- [mcp-vitest](#mcp-vitest)
  - [Contents](#contents)
  - [Before and after](#before-and-after)
  - [Overview](#overview)
  - [Features](#features)
  - [Getting started](#getting-started)
    - [Prerequisites](#prerequisites)
    - [Install](#install)
    - [Quickstart](#quickstart)
  - [Works with both SDK majors](#works-with-both-sdk-majors)
  - [Testing OAuth-protected servers](#testing-oauth-protected-servers)
  - [API](#api)
  - [Is this for you](#is-this-for-you)
  - [Compared to](#compared-to)
  - [FAQ](#faq)
  - [Contributing](#contributing)
  - [Contributors](#contributors)
  - [License](#license)
  - [Support the project](#support-the-project)
  - [Connect](#connect)

## Before and after

Driving an MCP server from a test without a harness means wiring the SDK yourself. This is a trimmed version of what [`src/connect/v1.ts`](src/connect/v1.ts) does for you - a linked transport pair, a client with the right capabilities advertised before `initialize`, and a request handler per interaction type:

```ts
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

const client = new Client(
  { name: "my-test", version: "1.0.0" },
  { capabilities: { sampling: {}, elicitation: {}, roots: {} } },
);

client.setRequestHandler(CreateMessageRequestSchema, async (req) =>
  mySampling(req.params),
);
client.setRequestHandler(ElicitRequestSchema, async (req) =>
  myElicitation(req.params),
);
client.setRequestHandler(ListRootsRequestSchema, async () => ({
  roots: myRoots,
}));

await Promise.all([
  server.connect(serverTransport),
  client.connect(clientTransport),
]);

const { tools } = await client.listTools();
if (!tools.some((t) => t.name === "search")) throw new Error("no search tool");
```

And that is only the v1 path. A v2 server does not use `InMemoryTransport` at all - it connects over the SDK's in-process `handler.fetch` route - so supporting both means writing it twice and keeping them in step.

With the harness:

```ts
const test = createMcpTest(() => createServer());

test("search tool works", async ({ mcp }) => {
  await expect(mcp).toHaveTool("search");
});
```

`mcpTest()` detects which SDK your server came from and routes to the matching transport. Capabilities are advertised before `initialize` because a server decides what to request during it, which is a detail that is easy to get wrong by hand and impossible to notice until a double never fires.

## Overview

Testing an MCP server usually means spawning a subprocess, picking a port, or hand-rolling JSON-RPC frames. By default mcp-vitest does none of that: your server runs **in-process**, driven by a real SDK `Client` over the SDK's own in-process transport, and you get a small harness plus typed matchers on top. When a server cannot be imported, the same harness drives it over stdio or a URL instead. The protocol is never reimplemented, so what your tests exercise is what a real client would.

```text
   your test ──▶ mcp.callTool() ──▶ real SDK Client ──┬─▶ v1: InMemoryTransport pair
   expect(mcp) ─▶ seven matchers                      ├─▶ v2: handler.fetch route
                                                      └─▶ external: stdio or URL
```

## Features

- **In-process by default** - no ports, no spawn, no teardown races. Both SDK majors, detected automatically.
- **Typed matchers** - seven of them, with TypeScript augmentation and did-you-mean suggestions on typos.
- **A small harness** - tools, resources, and prompts with pagination followed for you, plus the raw SDK client as an escape hatch.
- **Interaction doubles** - answer a server's sampling, elicitation, and roots requests from your test.
- **External servers** - spawn one over stdio or point at a running URL; everything above works unchanged.
- **OAuth test doubles** - send a bearer token or headers with `auth`, and drive the other side of the handshake with a fake authorization server backed by a real RS256 keypair.
- **Lifecycle coverage** - run the same tests against the 2025 and 2026-07-28 protocol revisions.
- **Regression safety** - snapshot manifests normalized so key order and absent optionals never churn them.
- **Real call ergonomics** - progress callbacks, `AbortSignal` cancellation, per-call timeouts, and a notification collector with `waitFor`.
- **One runtime dependency** - `@cfworker/json-schema` (MIT, no transitive deps). Your MCP SDK is an optional peer, so you install only the major you use.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) `>=20`
- [vitest](https://vitest.dev/) `>=3.2` in your project
- An MCP server built on either SDK major - `@modelcontextprotocol/sdk` `>=1.10`, or `@modelcontextprotocol/server` + `/client` `^2.0`. Both are optional peers, so you install only the one you use.
- ESM only, with no CJS build

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

You do not pick. `mcpTest()` detects which SDK your server came from and routes to the matching transport; `mcp.kind` reports what it found. The same tests, matchers, and fixture work either way - including against [external servers](https://mcp-vitest.nixrajput.com/en/docs/api/external-servers), which report `'external'`. Which protocol revision each lane speaks is covered under [lifecycles](https://mcp-vitest.nixrajput.com/en/docs/api/lifecycles).

## Testing OAuth-protected servers

Pass `auth: { token }` or `auth: { headers }` to send credentials on every request, and reach for `mcp-vitest/auth` to test the other side of the handshake: a fake authorization server with a real RS256 keypair, plus assertions for the 401 challenge and PRM discovery a protected server has to get right. Details at [auth test doubles][docs-auth].

Pass `fakeAuthServer({ audience })` when your server should refuse a token minted for a different resource - MCP's confused-deputy defence. Without it the verifier reports the audience as `AuthInfo.resource` but accepts any value, because `requireBearerAuth` checks only scopes and expiry. `auth` throws on a stdio or in-process server, which cannot send a credential at all.

## API

The full reference lives at **[mcp-vitest.nixrajput.com/en/docs/api/mcp-test](https://mcp-vitest.nixrajput.com/en/docs/api/mcp-test)** - `mcpTest`, the harness, all seven matchers, interaction doubles, notification collectors, snapshots, external servers, and the lifecycle matrix.

Migrating from an earlier version? See [the migration notes](https://mcp-vitest.nixrajput.com/en/docs/migrating).

## Is this for you

**Good fit if you…**

- maintain an MCP server and want tests that run in your existing vitest suite
- need to assert on tools, resources, prompts and results without hand-rolling JSON-RPC
- have to answer a server's sampling, elicitation or roots requests from a test
- support both SDK majors, or are migrating between them
- care which protocol revision your server actually negotiates

**Skip it if you…**

- want an interactive debugger rather than automated tests. [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is the right tool for poking at a server by hand.
- are not on vitest. The matchers and fixture are vitest-native; nothing here ports to jest without rewriting.
- only need to check that a process starts. A shell script is cheaper.
- are on SDK v1 below 1.10, or need a CJS build. This is ESM only.

## Compared to

|                                                                    | SDK majors                                    | Protocol revisions        | Interaction doubles          | Snapshots            | Schema validation     |
| ------------------------------------------------------------------ | --------------------------------------------- | ------------------------- | ---------------------------- | -------------------- | --------------------- |
| **mcp-vitest**                                                     | v1 and v2, auto-detected                      | 2025-11-25 and 2026-07-28 | sampling, elicitation, roots | Normalized manifests | `toMatchOutputSchema` |
| [vitest-mcp](https://www.npmjs.com/package/vitest-mcp)             | v1 only, per its own peer range `>=1.10.0 <2` | Whatever v1 negotiates    | No                           | No                   | No                    |
| [MCP Inspector](https://github.com/modelcontextprotocol/inspector) | Interactive tool, not a test harness          | -                         | -                            | -                    | -                     |
| Hand-rolled                                                        | Whatever you write twice                      | Whatever you pin          | Whatever you wire            | Yours to normalize   | Yours to write        |

`vitest-mcp` arrived in August 2026 and covers the same idea for the v1 SDK; if that is all you need, it is smaller. The differences above are the reasons this exists: two SDK majors over two different transports, two protocol eras, and the interaction doubles that let a test answer what a server asks it.

## FAQ

**Does it spawn my server as a subprocess?**
Not by default. When a server cannot be imported, the same harness drives it [over stdio or a URL][docs-external] instead, and everything else works unchanged.

**Is the protocol reimplemented?**
No - both lanes use the SDK's own client and transports. That is also why the lanes are tested separately rather than assumed equivalent: they genuinely connect differently.

**Which protocol revision am I testing?**
Whichever your lane negotiates, and it is reported rather than assumed. SDK v1 tops out at 2025-11-25; the v2 lane pins 2026-07-28. Asking a v1 server for the 2026 lifecycle fails with an explanation instead of silently testing the older era. See [lifecycles][docs-lifecycles].

**Is the fake authorization server a mock?**
No - it is a real HTTP server with its own RS256 keypair, serving real JWKS and token endpoints, so your `requireBearerAuth` wiring runs unchanged rather than being stubbed out. Two instances never trust each other's tokens, because each mints its own keypair.

**Why is there a runtime dependency at all?**
`toMatchOutputSchema` needs a validator, and v1 emits draft-07 while v2 emits 2020-12. `@cfworker/json-schema` is MIT with no transitive dependencies, and v1 users pay nothing extra because the MCP SDK already depends on it. Approximating validation in a testing tool would be worse than the dependency.

**Can I use the raw SDK client?**
Yes. The harness exposes it as an escape hatch, so anything not covered by a matcher is still reachable.

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

[ci]: https://github.com/nixrajput/mcp-vitest/actions/workflows/ci.yml
[docs]: https://mcp-vitest.nixrajput.com
[docs-start]: https://mcp-vitest.nixrajput.com/en/docs/getting-started
[docs-api]: https://mcp-vitest.nixrajput.com/en/docs/api/mcp-test
[docs-lifecycles]: https://mcp-vitest.nixrajput.com/en/docs/api/lifecycles
[docs-external]: https://mcp-vitest.nixrajput.com/en/docs/api/external-servers
[docs-auth]: https://mcp-vitest.nixrajput.com/en/docs/api/auth
[npm]: https://www.npmjs.com/package/mcp-vitest
[repo]: https://github.com/nixrajput/mcp-vitest
[issues]: https://github.com/nixrajput/mcp-vitest/issues
[pulls]: https://github.com/nixrajput/mcp-vitest/pulls
[discussions]: https://github.com/nixrajput/mcp-vitest/discussions
[contributors]: https://github.com/nixrajput/mcp-vitest/graphs/contributors
[license]: https://github.com/nixrajput/mcp-vitest/blob/main/LICENSE
