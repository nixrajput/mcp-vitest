import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// The README is a published artifact: npm packs it regardless of the `files` allowlist and
// renders it as the package page, so a broken link there needs a release to fix. A past
// cleanup deleted a whole section unnoticed in the sibling repo, which is what these assert against.
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

// Headings are read from the prose only: a shell comment like `# SDK v1` inside a fenced
// block is not a heading, and counting it as one fails the round-trip below.
const prose = readme.replace(/^```[\s\S]*?^```/gm, "");

const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/ /g, "-");

const headings = [...prose.matchAll(/^#{1,3} (.+)$/gm)].map((m) => m[1] as string);
const tocEntries = [...readme.matchAll(/^\s*- \[([^\]]+)\]\(#([^)]+)\)/gm)].map((m) => ({
  text: m[1] as string,
  anchor: m[2] as string,
}));

describe("README contents", () => {
  test("every table-of-contents entry points at a real heading", () => {
    const real = new Set(headings.map(slug));
    expect(tocEntries.filter((e) => !real.has(e.anchor)).map((e) => e.anchor)).toEqual([]);
  });

  test("every heading appears in the table of contents", () => {
    const listed = new Set(tocEntries.map((e) => e.anchor));
    expect(headings.filter((h) => !listed.has(slug(h)))).toEqual([]);
  });

  test("link reference definitions are all used, and all used ones are defined", () => {
    const defined = new Set([...readme.matchAll(/^\[([^\]]+)\]:\s/gm)].map((m) => m[1] as string));
    const body = readme.replace(/^\[[^\]]+\]:\s.*$/gm, "");
    const used = new Set([...body.matchAll(/\]\[([^\]]+)\]/g)].map((m) => m[1] as string));

    expect([...used].filter((ref) => !defined.has(ref))).toEqual([]);
    expect([...defined].filter((ref) => !used.has(ref))).toEqual([]);
  });
});
