import { describe, expect, test } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { connectV1 } from "../src/connect/v1.js";
import { DoubleRegistry } from "../src/doubles.js";
import { createV1Server } from "./servers/v1.js";

describe("connectV1", () => {
  test("round-trips listTools and callTool in memory", async () => {
    const { client, close } = await connectV1(createV1Server(), new DoubleRegistry());
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "ask",
        "boom",
        "echo",
        "list-roots",
        "slow",
        "summarize",
        "weather",
        "weather-bad",
        "weather-strict",
      ]);

      const result = await client.callTool({
        name: "echo",
        arguments: { message: "hi" },
      });
      expect(result.content[0]).toMatchObject({ type: "text", text: "echo: hi" });
    } finally {
      await close();
    }
  });

  test("close() is idempotent", async () => {
    const conn = await connectV1(createV1Server(), new DoubleRegistry());
    await conn.close();
    await expect(conn.close()).resolves.toBeUndefined();
  });
});

// The advertised client version is a literal in each connect module and it silently
// drifted across two releases. Pin it to package.json so the next drift fails here.
describe("client identity", () => {
  test("advertises the package version on the wire", async () => {
    const server = createV1Server();
    const { close } = await connectV1(server, new DoubleRegistry());
    try {
      expect(server.server.getClientVersion()).toEqual({
        name: "mcp-vitest",
        version: pkg.version,
      });
    } finally {
      await close();
    }
  });
});
