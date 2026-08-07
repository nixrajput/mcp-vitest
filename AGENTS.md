# AI Agent Guidelines

Last updated: 2026-08-07

---

## Project

**mcp-vitest** is a Vitest-native testing harness for Model Context Protocol servers. It never reimplements the protocol: it drives a real SDK `Client` over a real transport, in-process.

| Area          | Detail                                                                              |
| ------------- | ----------------------------------------------------------------------------------- |
| Language      | TypeScript strict, ESM only, Node `>=20`                                            |
| Build         | tsdown (CLI flags, not a config file) + publint + attw                              |
| Tests         | vitest, both SDK majors exercised side by side                                      |
| Lint / format | Biome - single quotes, no semicolons, 100 columns                                   |
| Peers         | vitest (required); both MCP SDK majors (optional)                                   |
| Runtime deps  | one: `@cfworker/json-schema` (MIT, no transitive deps), backs `toMatchOutputSchema` |

### Layout

```
src/
  index.ts       public barrel
  types.ts       RawConnection, SdkClientLike, McpToolResult, options
  detect.ts      detectServerKind() - routes a server object to its SDK major
  connect/bus.ts shared notification bus + CallToolOptions -> SDK request options
  connect/v1.ts  InMemoryTransport linked pair (2025-era lifecycle)
  connect/v2.ts  createMcpHandler + handler.fetch, pinned to 2026-07-28
  doubles.ts     DoubleRegistry + sampling/elicitation/roots double types
  harness.ts     McpHarness + mcpTest()
  fixture.ts     createMcpTest() - vitest test.extend, plus the lifecycle matrix
  matchers.ts    matchers + registerMatchers() + vitest module augmentation
  notifications.ts  NotificationCollector (items + waitFor)
  snapshot.ts    normalized manifests for vitest snapshots
  setup.ts       side-effect entry for setupFiles
test/
  servers/v1.ts  v1 fixture server - tools echo/boom/slow/weather/weather-bad/
                 weather-strict/ask/summarize/list-roots, resource
                 demo://greeting, template demo://person/{name}, prompt greet
  servers/v2.ts  v2 fixture server - same surface minus list-roots
```

The two fixture servers share one contract on purpose: every harness and matcher test runs against both, so a change that only works on one SDK major fails loudly. Two deliberate exceptions: `list-roots` is v1-only because roots is deprecated in the 2026 spec, and the interactive tools use different mechanisms per era - v1 pushes server-to-client requests, while v2 answers with `inputRequired()` and reads the reply from `ctx.mcpReq.inputResponses` on the client's retry.

### The checks

`npm run lint`, `npm run ts:check`, `npm test`, `npm run build`. CI runs exactly these four in the `build` job, and repeats lint/typecheck/test on the Node 20 floor in a second job (tsdown itself needs >=22.18, so the floor job skips `build`). `.githooks/pre-push` runs them too (`git config core.hooksPath .githooks`).

`.githooks/pre-push` also prints an inform-only report: per-file size deltas against the published version, npm/Bundlephobia bundle metrics (minified, gzipped, download times, dependency composition), benchmarks, knip, and coverage. It never blocks a push (`|| true`), skips bench and coverage when no `src/`, `test/`, `bench/`, or `package.json` file changed, and uses a short bench sample. `npm run report` runs the full-fidelity version, and CI attaches it to every PR summary. Size budgets are deliberately deferred until the feature surface stops moving; see the roadmap's carried items.

### Conventions

- Conventional Commits, imperative subject `<=` 50 chars, no trailing period, no `Co-Authored-By` or `Generated with` trailers.
- Every PR bumps `package.json` version - CI gate `version bumped` enforces it.
- The PR title becomes the squash commit message.
- `main` is protected: PR required, squash-only merges.
- The README documents **shipped features only** - no roadmap, no plans.
- Markdown prose is never hard-wrapped: one line per paragraph and per list item. Do not re-wrap these files to a column.

---

## Always-Active Instructions

> These apply to EVERY interaction, automatically.

### Working Discipline

> Behavioral guidelines to reduce common LLM coding mistakes. Bias toward caution over speed; for trivial tasks, use judgment.

#### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- Read existing code and understand patterns before proposing changes.
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

#### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

#### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

#### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

#### 5. Report What Was Done

After completing work, state what changed and why - not just that it's done.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

### Multi-Agent Safety Rules

- **Never** create/apply/drop git stash entries unless explicitly requested
- **Never** edit files in `node_modules/`, `vendor/`, or other dependency directories
- **Always** work on a dedicated branch when running concurrent agents
- **Never** force-push or rebase shared branches from an agent session
- **Verify** no other agent is modifying the same files before making changes

### Release Safety

- **Never** merge a PR or publish to npm without explicit approval. Merging `main` triggers the tag, the GitHub Release, and `npm publish` via OIDC in one shot, and a published version number can never be reused.

---
