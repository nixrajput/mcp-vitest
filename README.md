<div align="center">

# mcp-vitest

Vitest-native testing for **Model Context Protocol** servers - matchers, snapshots, interaction doubles, and real external servers, on both SDK majors.

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
  - [Requirements](#requirements)
  - [Contributing](#contributing)
  - [Contributors](#contributors)
  - [License](#license)
  - [Support the project](#support-the-project)
  - [Connect](#connect)

## Overview

Testing an MCP server usually means spawning a subprocess, picking a port, or hand-rolling JSON-RPC frames. By default mcp-vitest does none of that: your server runs **in-process**, driven by a real SDK `Client` over the SDK's own in-process transport, and you get a small harness plus typed matchers on top. When a server cannot be imported, the same harness drives it over stdio or a URL instead. The protocol is never reimplemented, so what your tests exercise is what a real client would.

## Features

- **In-process by default** - no ports, no spawn, no teardown races. Both SDK majors, detected automatically.
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

You do not pick. `mcpTest()` detects which SDK your server came from and routes to the matching transport; `mcp.kind` reports what it found. The same tests, matchers, and fixture work either way - including against [external servers](https://mcp-vitest.nixrajput.com/en/docs/api/external-servers), which report `'external'`. Which protocol revision each lane speaks is covered under [lifecycles](https://mcp-vitest.nixrajput.com/en/docs/api/lifecycles).

## API

The full reference lives at **[mcp-vitest.nixrajput.com/en/docs/api/mcp-test](https://mcp-vitest.nixrajput.com/en/docs/api/mcp-test)** - `mcpTest`, the harness, all seven matchers, interaction doubles, notification collectors, snapshots, external servers, and the lifecycle matrix.

Migrating from an earlier version? See [the migration notes](https://mcp-vitest.nixrajput.com/en/docs/migrating).

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
