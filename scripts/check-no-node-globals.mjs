// No file in src/ may depend on an ambient Node global. A tsconfig `exclude`
// cannot express this - index.ts re-exports serveHandler, so the import graph
// pulls it in regardless - hence typecheck with no Node types and ignore serve.ts.
import { spawnSync } from "node:child_process";

// src/auth/* is the second deliberate exception - the fake authorization server
// signs real tokens with node:crypto, and the mcp-vitest/auth subpath is what
// keeps the default import free of Node builtins instead of this guard.
const ALLOWED = (file) => file === "src/serve.ts" || file.startsWith("src/auth/");
const FILE_ERROR = /^(?<file>\S+?)\(\d+,\d+\): error /;

const { status, stdout, stderr } = spawnSync(
  "npx",
  ["tsc", "--noEmit", "-p", "tsconfig.no-node.json"],
  { encoding: "utf8" },
);

const lines = (stdout ?? "").split("\n");
const fileErrors = lines.flatMap((line) => {
  const file = FILE_ERROR.exec(line)?.groups?.file;
  return file ? [{ file, line }] : [];
});
const leaks = fileErrors.filter(({ file }) => !ALLOWED(file));

if (leaks.length > 0) {
  console.error("Node globals leaked into src/ (only src/serve.ts and src/auth/* may use them):\n");
  for (const { line } of leaks) console.error(`  ${line}`);
  process.exit(1);
}

// A non-file-scoped error means tsc did not check what this assumes it did, and
// alongside the expected serve.ts errors it would otherwise report "clean".
const unparsed = lines.filter((l) => /error TS\d+/.test(l) && !FILE_ERROR.test(l));
if (unparsed.length > 0 || (status !== 0 && fileErrors.length === 0)) {
  console.error(`tsc exited ${status} with diagnostics this check cannot attribute:\n`);
  for (const l of unparsed) console.error(`  ${l}`);
  if (unparsed.length === 0) console.error(stdout || stderr || "(no output)");
  process.exit(1);
}

console.log("no-node guard: clean (src/serve.ts and src/auth/* are the only Node-dependent files)");
