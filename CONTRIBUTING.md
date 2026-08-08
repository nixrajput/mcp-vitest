# Contributing to mcp-vitest

Thanks for your interest in contributing. mcp-vitest is a Vitest-native testing harness for Model Context Protocol servers, and contributions that make testing MCP servers less painful are very welcome.

## Code of Conduct

Please review and adhere to our [Code of Conduct](CODE_OF_CONDUCT.md). We expect all contributors to be respectful, considerate, and inclusive when interacting with the project and its community.

## Getting set up

Requires Node.js `>=20`.

```bash
git clone https://github.com/nixrajput/mcp-vitest.git
cd mcp-vitest
npm install
git config core.hooksPath .githooks   # optional: runs the checks below before each push
```

Both MCP SDK majors are installed as devDependencies, so the test suite exercises v1 (`@modelcontextprotocol/sdk`) and v2 (`@modelcontextprotocol/server` + `@modelcontextprotocol/client`) side by side.

## The checks

Every one of these must pass before a PR can merge - CI runs exactly the same set:

```bash
npm run lint       # biome check (lint + format)
npm run ts:check   # tsc --noEmit
npm test           # vitest run
npm run build      # tsdown + publint + attw
```

`npm run format` rewrites formatting if `lint` complains.

## Workflow

1. **Fork and branch.** Branch off `main` with a descriptive name (`feat/notification-collector`, `fix/v2-close-leak`).
2. **Write the test first.** Every feature and bugfix lands with a test. Bugs get a test that reproduces them before the fix.
3. **Keep the diff surgical.** Every changed line should trace to the change you are making. No drive-by refactors, no speculative abstractions.
4. **Bump the version.** `package.json` must move in every PR - CI enforces it (`version bumped`). Patch for fixes, minor for features.
5. **Update the docs.** If behavior a user can see changes, the README changes in the same PR.
6. **Open the PR.** Fill in the template. The PR title becomes the squash commit message on merge, so write it in Conventional Commit form (`feat: add notification collector`) and keep it under ~50 characters.

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`, `refactor:`), imperative subject, no trailing period.
- **Style:** Biome, double quotes, semicolons, trailing commas, 100-column lines - Prettier-compatible defaults. Do not hand-format - run `npm run format`.
- **Language:** TypeScript strict, ESM only, Node `>=20`. No CJS build.
- **Dependencies:** the package ships with exactly one runtime dependency, `@cfworker/json-schema` (MIT, no transitive deps), which backs `toMatchOutputSchema`. Both SDK majors and vitest are peers, and the SDK peers are optional. Please do not add another runtime dependency without discussing it in an issue first.
- **Comments:** explain why, not what. Most code needs none.

## Reporting issues

Bugs and feature requests go to [Issues](https://github.com/nixrajput/mcp-vitest/issues) - the templates ask for the SDK major, versions, and a minimal repro, which is usually enough to act on. Questions and open-ended ideas belong in [Discussions](https://github.com/nixrajput/mcp-vitest/discussions). Security issues follow [SECURITY.md](SECURITY.md) instead - never a public issue.

## Thank you

Every issue, repro, and PR makes this project more useful. Thanks for taking the time.
