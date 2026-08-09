## Summary

<!-- What does this PR do? One paragraph is enough. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / code cleanup
- [ ] Documentation
- [ ] CI / tooling
- [ ] Dependency update

## Related issues

Closes #<!-- issue number -->

## How to test

<!-- Steps for a reviewer to verify the change manually. -->

1.
2.

## Verification checklist

- [ ] `npm run lint` — 0 errors
- [ ] `npm run ts:check` — clean
- [ ] `npm test` — all tests pass (both SDK majors)
- [ ] `npm run build` — succeeds (tsdown + publint + attw)
- [ ] `package.json` version bumped (required to merge) - and `CLIENT_INFO` in `src/types.ts` if so
- [ ] Docs updated where applicable (README, inline comments)
- [ ] Public API changed? Link the matching `mcp-vitest-docs` PR:
- [ ] `SECURITY.md` supported-versions table still correct
- [ ] No unrelated changes included in this PR
