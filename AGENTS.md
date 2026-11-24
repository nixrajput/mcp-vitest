# AI Agent Guidelines

Last updated: 2026-11-24

---

## Project

**mcp-vitest** is a Vitest-native testing harness for Model Context Protocol servers. It never reimplements the protocol: it drives a real SDK `Client` over a real transport, in-process.

| Area          | Detail                                                                              |
| ------------- | ----------------------------------------------------------------------------------- |
| Language      | TypeScript strict, ESM only, Node `>=20`                                            |
| Build         | tsdown (CLI flags, not a config file) + publint + attw                              |
| Tests         | vitest, both SDK majors exercised side by side                                      |
| Lint / format | Biome - double quotes, semicolons, trailing commas, 100 columns                     |
| Peers         | vitest (required), both MCP SDK majors (optional)                                   |
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
  connect/external.ts  connectStdio() spawn + connectUrl() real HTTP
  serve.ts       serveHandler() - fetch handler on an ephemeral local port
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
  servers/stdio-server.mjs  runnable v1 stdio server, plain JS (spawned)
```

The two fixture servers share one contract on purpose. Every harness and matcher test runs against both, so a change that only works on one SDK major fails loudly. There are two deliberate exceptions:

- `list-roots` is v1-only, because roots is deprecated in the 2026 spec.
- The interactive tools use different mechanisms per era. v1 pushes server-to-client requests. v2 answers with `inputRequired()` and reads the reply from `ctx.mcpReq.inputResponses` on the client's retry.

### The checks

`npm run lint`, `npm run ts:check`, `npm test`, `npm run build`. CI runs exactly these four in the `build` job. A second job repeats lint/typecheck/test on the Node 20 floor. tsdown itself needs >=22.18, so the floor job skips `build`. `.githooks/pre-push` runs them too (`git config core.hooksPath .githooks`).

`.githooks/pre-push` also prints an inform-only report. It covers per-file size deltas against the published version, npm/Bundlephobia bundle metrics (minified, gzipped, download times, dependency composition), benchmarks, knip, and coverage. It never blocks a push (`|| true`), skips bench and coverage when no `src/`, `test/`, `bench/`, or `package.json` file changed, and uses a short bench sample. `npm run report` runs the full-fidelity version, and CI attaches it to every PR summary. Size budgets are deliberately deferred until the feature surface stops moving. See the roadmap's carried items.

### Conventions

- Conventional Commits, imperative subject `<=` 50 chars, no trailing period, no `Co-Authored-By` or `Generated with` trailers.
- Every PR that changes anything users receive bumps `package.json` version. CI gate `version bumped` enforces it. The gate waives itself when a PR touches only `.github`, `.claude`, `.githooks`, `scripts`, `bench`, `.nvmrc`, or the governance docs. `README.md` is excluded from that waiver, because it ships in the tarball.
- The PR title becomes the squash commit message.
- `main` is protected: PR required, squash-only merges.
- The README documents **shipped features only** - no roadmap, no plans.
- Markdown prose is never hard-wrapped: one line per paragraph and per list item. Do not re-wrap these files to a column.

---

## Always-Active Instructions

> These apply to EVERY interaction, automatically.

### Writing Style

Never use em-dashes (`—`). Always use a hyphen (`-`) instead - in code comments, commit messages, PR/issue text, chat responses, and any file content.

#### Plain technical English (adapted from ASD-STE100)

Write text that has exactly one reading. The goal is to remove ambiguity, not words. Stop when a sentence cannot be misread, not when it is shortest.

**Everywhere** (chat, commits, PR and issue text, docs, code comments). Aim for about 80% of strict STE. Follow these rules, but treat the word limits as targets and skip the strict-mode extras.

- Active voice. Name who acts: "The job deletes the file", not "The file is deleted". Use passive only when the actor is unknown or irrelevant.
- One idea per sentence. Aim for 20 words or fewer in instructions and 25 or fewer in descriptions.
- No semicolons in prose. Where a semicolon or a dash would join two clauses, prefer two sentences.
- Use a numbered or bulleted list for 3+ steps, conditions or options. Keep one topic and 6 sentences max per paragraph.
- One name per thing. Pick one term (e.g. "user" or "account", not both) and keep it for the whole text. Rotating synonyms makes the reader ask if they are different things.
- One meaning and one part of speech per word. If "store" names a storage layer, do not also use it to mean "save".
- Plain words, not formal ones: use, start, before, about, to, make sure - not utilize, leverage, commence, prior to, approximately, in order to, ensure.
- Verbs, not nominalizations: "analyze the log", not "perform an analysis of the log".
- Plain verbs, not soft phrasal verbs: start, contact, read, begin - not spin up, reach out, dive into, kick off.
- No marketing adjectives (seamless, robust, powerful, blazing-fast, effortless). Delete them or give the number that earns the claim.
- No hedge stacking ("it is worth noting that this may potentially help"). State the claim or cut it.
- Keep subjects, verbs and articles. Do not drop words to save space ("Files not backed up will be lost" - which files?).
- Noun stacks of 3 words max: "the handler that sets task-queue priority", not "the agent task queue priority handler".
- Define a domain term once, on first use, if it is not common English.
- Label a risky step WARNING (irreversible: data loss, money, production, real users) or CAUTION (recoverable). Give the command first, then the risk: "WARNING: Do not run this on production. It deletes all sessions."

**Keep modality. Confidence is content.** "May have failed" never becomes "failed". "Could be caused by X" never becomes "X is the cause". Never upgrade a hedge to a fact, and never add a cause, frequency or mechanism the evidence does not show. Never drop a condition, exception or scope qualifier to shorten a sentence. If a rule would cost precision, keep the longer wording. When you rewrite someone else's text, name any content you added.

**Strict mode** applies to text that an agent or program reads with no human to resolve ambiguity. That includes AGENTS.md, CLAUDE.md, skills, agent and subagent prompts, tool descriptions, hook output, error and log messages, and reports that one agent writes for another.

- The 20/25-word limits are hard caps. One instruction per sentence, unless two actions happen at the same time.
- Write instructions in the imperative. Keep descriptions as descriptions. Do not turn a fact into a command.
- Put the condition first: "If the app is uninstalled, skip the sync." Do not put it at the end.
- Use one verb for one action in the whole file. Do not mix "check", "verify" and "confirm" for the same action. If "check" is already a noun in the file (a CI check), use "verify" for the action.
- Use simple tenses by default: "the job completed", not "the job is completing". Keep a compound form only when it carries meaning: "is running" (still in progress), "has completed" (done and available now), "may have failed" (uncertain). When tense and modality conflict, modality wins.

**Exempt:** creative or persuasive copy, code, and quoted or verbatim text (error strings, the user's words).

**Pick the format before the words.** Some explanations cover a flow, a structure or 3+ interacting parts. For these, draw a diagram (ASCII in chat) or offer an HTML page instead of a long block of text.

These rules fix form, not substance. Leave text that already follows them unchanged. If a paragraph has nothing to say, delete it instead of polishing it.

### Working Discipline

#### 1. Understand Before Acting

**Reach 95% certainty about what the user wants before you write code, a plan or a design. Below that bar, ask.**

**The 95% gate**

- Before you start, state in one or two concrete sentences what "done" looks like. If you cannot, you are below the bar. Ask.
- Ask all clarifying questions in one batch, up front. Do not spread them across turns, one question at a time.
- Ask only questions whose answers change the outcome. If an answer would not change what you build, pick the sensible default, name it and continue.
- A question costs one message. Building the wrong thing costs the whole implementation. Never trade a question for a guess.
- Skip the gate only for trivial, reversible, unambiguous work: a typo, a rename, a one-line fix, a command given verbatim.
- The gate applies BEFORE you start. When the task is clear, execute it end to end. Do not stop mid-flow to ask approval for steps that the request already implies.

**Map the blast radius**

- Before you start, find every place that depends on what you will change. The request names one surface. Shared logic, shared data and shared formats usually feed several.
- Trace it. Do not guess. Grep every caller, reader, subscriber and consumer of the function, field, rule, default, format or schema that you change.
- Look past the screen in front of you. Look for:
  - other views of the same data
  - exports and reports
  - background jobs and schedulers
  - public APIs and webhooks
  - caches and derived or stored state
  - permissions, analytics, tests and docs
- Give the user the list of dependents that you found. Ask which of them must change with your change, and which must keep their current behavior exactly. Ask this in the same up-front batch as your other questions, not after you start.
- If you cannot check what a consumer expects, say so. Do not silently change its behavior, and do not silently keep it.
- Record the affected areas in the plan, ticket and PR description. Reviewers and QA use this record to know what to test again.
- A map of the impact does not give permission to widen the change. Rule 3 still applies: report what is affected, and edit only what the user's answer says to edit.

**No unverified assumptions**

- An assumption is anything without evidence: you did not read it, did not run it, and nobody told you. Treat it as unknown, not as "probably fine".
- Valid evidence is:
  - the actual code, schema, config or migration
  - a command that you ran, and its output
  - docs for the exact version in use
  - the user's own words
- These are NOT evidence: a file or function name, "this is how these projects usually work", or memory of a similar codebase.
- Read the real implementation of anything that you call, extend, override or depend on. A signature or a name does not show behavior.
- Treat second-hand claims as unverified: stale comments, outdated docs, a subagent's summary, a review bot's finding, an old ticket. Check each claim against the current code before you act on it.
- If you must continue without evidence, say so openly: "Assuming X because I could not check Y." Never leave an assumption silent.
- Never call something done, fixed, working or passing unless you ran the check and saw it pass. Show the output.

**Before you implement**

- Read the existing code and follow its patterns. Do not invent new ones.
- If the request has more than one reasonable reading, present all readings. Do not silently pick one.
- If a simpler approach exists, say so. Disagree when you have a reason.
- If something is unclear, stop and name exactly what is unclear.

#### 2. Simplicity First

**Write the minimum code that solves the problem. Write nothing speculative.**

- No features beyond the request.
- No abstractions for code with one use.
- No "flexibility" or "configurability" that the user did not request.
- No error handling for impossible scenarios.
- If you write 200 lines and 50 lines can do the same work, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

#### 3. Surgical Changes

**Change only what you must. Remove only the mess that you made.**

When you edit existing code:

- Do not "improve" adjacent code, comments or formatting.
- Do not refactor code that works.
- Match the existing style, even if you would write it differently.
- If you see unrelated dead code, mention it. Do not delete it.

When your changes create orphans:

- Remove the imports, variables and functions that YOUR changes made unused.
- Do not remove dead code that existed before your change, unless the user asks.

The test: every changed line traces directly to the user's request.

#### 3a. Code Comments

**Comment the why and the how, never the what. Most code needs no comment.**

- Code shows what it does. Add a comment only when the why or the how is hard to follow. Examples: non-obvious logic, a deliberate tradeoff, or a constraint that the code cannot show.
- Do NOT add routine comments on methods, classes, variables, props, components or PropTypes. Prop-type and type comments are noise, except for a special case or an explicit user request.
- Write a comment only if it does one of these:
  - prevents a real misunderstanding
  - marks significant or surprising behavior
  - documents a cross-file side effect: a hook, mutation or edit in one file that changes another file. These cross-file couplings ARE worth a comment.
- Length: 3 lines max, 120 characters max per line. Prefer one line. If one line cannot hold it, ask yourself if the comment is necessary.
- When you edit existing code, do not add comments that the user did not ask for just to "explain" your change. The diff and the commit message carry that.
- Such comments are the most common drift. A one-line fix does NOT need a comment that says why it is correct or what the old code did wrong.
- Default to ZERO comments on a change. The exceptions are a genuine cross-file coupling, a non-obvious constraint, or surprising behavior that would confuse a future reader. When in doubt, add no comment.
- Comments are for non-obvious handling in a method, class, library integration or cross-file side effect. They are not for variables, props, local assignments, or a restatement of what the code plainly does.

#### 4. Goal-Driven Execution

**Define success criteria. Repeat until the check passes.**

Change each task into a goal that you can check:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Make sure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → check: [how]
2. [Step] → check: [how]
3. [Step] → check: [how]
```

Strong success criteria let you repeat the loop without help. Weak criteria ("make it work") need constant clarification.

#### 5. Report What Was Done

When the work is complete, state what changed and why. Do not only say that it is done.

---

**These guidelines work if** diffs have fewer unnecessary changes, fewer rewrites come from overcomplication, and clarifying questions come before implementation, not after mistakes.

---

### Multi-Agent Safety Rules

- **Never** create, apply or drop git stash entries, unless the user explicitly asks.
- **Never** edit files in `node_modules/`, `vendor/` or other dependency directories.
- **Always** work on a dedicated branch when concurrent agents run.
- **Never** force-push or rebase shared branches from an agent session.
- **Check** that no other agent is changing the same files before you change them.

### Release Safety

- WARNING: **Never** merge a PR or publish to npm without explicit approval. A merge to `main` triggers the tag, the GitHub Release, and `npm publish` via OIDC in one shot. A published version number can never be reused.

---
