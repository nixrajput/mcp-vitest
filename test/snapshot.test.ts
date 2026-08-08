import { describe, expect, test } from "vitest";
import { mcpTest } from "../src/index.js";
import { capabilitiesManifest, toolManifest } from "../src/snapshot.js";
import { createV1Server } from "./servers/v1.js";
import { createV2Server } from "./servers/v2.js";

describe.each([
  ["v1", () => mcpTest(createV1Server())],
  ["v2", () => mcpTest(() => createV2Server())],
])("snapshot manifests (%s)", (_label, make) => {
  test("toolManifest is stable and sorted", async () => {
    const mcp = await make();
    const a = await toolManifest(mcp);
    const b = await toolManifest(mcp);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toMatchSnapshot();
  });

  test("capabilitiesManifest lists names only", async () => {
    const mcp = await make();
    const caps = (await capabilitiesManifest(mcp)) as { tools: string[] };
    expect(caps.tools).toEqual([...caps.tools].sort());
    expect(caps.tools).toContain("echo");
    expect(caps).toMatchSnapshot();
  });
});
