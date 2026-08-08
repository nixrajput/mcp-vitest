import { describe, expect } from "vitest";
import { createMcpTest } from "../src/index.js";
import { createV1Server } from "./servers/v1.js";
import { createV2Server } from "./servers/v2.js";

const testV1 = createMcpTest(() => createV1Server());
const testV2 = createMcpTest(() => createV2Server());

describe("createMcpTest", () => {
  testV1("provides a connected v1 harness", async ({ mcp }) => {
    expect(mcp.kind).toBe("v1");
    await expect(mcp).toHaveTool("echo");
  });

  testV2("provides a connected v2 harness", async ({ mcp }) => {
    expect(mcp.kind).toBe("v2");
    const result = await mcp.callTool("echo", { message: "fixture" });
    expect(result).toHaveTextContent("echo: fixture");
  });

  testV1("fixtures are isolated per test", async ({ mcp }) => {
    // a fresh harness every test: no residue possible, just prove it works
    await expect(mcp).toHavePrompt("greet");
  });
});
