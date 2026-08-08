import { describe, expect, test } from "vitest";
import { mcpTest } from "../src/index.js";
import { createV1Server } from "./servers/v1.js";

describe("matchers", () => {
  test("toHaveTool passes and fails with suggestion", async () => {
    const mcp = await mcpTest(createV1Server());
    await expect(mcp).toHaveTool("echo");
    // typo: fails, and the failure message suggests the near-miss
    await expect(expect(mcp).toHaveTool("ecoh")).rejects.toThrow(/did you mean "echo"/i);
  });

  test("toHaveResource and toHavePrompt", async () => {
    const mcp = await mcpTest(createV1Server());
    await expect(mcp).toHaveResource("demo://greeting");
    await expect(mcp).toHavePrompt("greet");
    await expect(expect(mcp).toHavePrompt("nope")).rejects.toThrow(/available prompts/i);
  });

  test("toHaveTextContent with string and regex", async () => {
    const mcp = await mcpTest(createV1Server());
    const result = await mcp.callTool("echo", { message: "hello world" });
    expect(result).toHaveTextContent("hello");
    expect(result).toHaveTextContent(/hello \w+/);
    expect(() => expect(result).toHaveTextContent("absent")).toThrow(/text content/i);
  });

  test("toBeToolError", async () => {
    const mcp = await mcpTest(createV1Server());
    const boom = await mcp.callTool("boom");
    expect(boom).toBeToolError();
    expect(boom).toBeToolError(/kaboom/);
    const ok = await mcp.callTool("echo", { message: "x" });
    expect(() => expect(ok).toBeToolError()).toThrow(/isError/i);
  });
});
