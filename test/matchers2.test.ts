import { describe, expect, test } from "vitest";
import { mcpTest } from "../src/index.js";
import { createV1Server } from "./servers/v1.js";
import { createV2Server } from "./servers/v2.js";

// Both majors, because they differ where it matters: v1 emits tool schemas as
// draft-07 and v2 as 2020-12, so toMatchOutputSchema takes a different branch.
const majors = [
  ["v1", () => mcpTest(createV1Server())],
  ["v2", () => mcpTest(() => createV2Server())],
] as const;

const weatherSchema = {
  type: "object",
  properties: { temperature: { type: "number" }, unit: { type: "string" } },
  required: ["temperature", "unit"],
};

describe.each(majors)("toHaveContent (%s)", (_label, make) => {
  test("matches a partial content object", async () => {
    const mcp = await make();
    const result = await mcp.callTool("weather");
    expect(result).toHaveContent({ type: "text", text: "21C" });
    expect(() => expect(result).toHaveContent({ type: "image" })).toThrow(/content/i);
  });

  test("matches with a regex value", async () => {
    const mcp = await make();
    const result = await mcp.callTool("echo", { message: "hello world" });
    expect(result).toHaveContent({ type: "text", text: /hello \w+/ });
  });
});

describe.each(majors)("toMatchOutputSchema (%s)", (_label, make) => {
  test("valid structured content passes against the declared schema", async () => {
    const mcp = await make();
    const result = await mcp.callTool("weather");
    expect(result).toMatchOutputSchema();
  });

  test("invalid structured content fails with validator errors", async () => {
    const mcp = await make();
    const result = await mcp.callTool("weather-bad");
    expect(() => expect(result).toMatchOutputSchema(weatherSchema)).toThrow(/temperature/i);
  });

  test("explicit schema argument works without call metadata", () => {
    const result = { content: [], structuredContent: { temperature: 21, unit: "c" } };
    expect(result).toMatchOutputSchema(weatherSchema);
  });

  test("reports when no schema is available at all", async () => {
    const mcp = await make();
    const result = await mcp.callTool("weather-bad");
    expect(() => expect(result).toMatchOutputSchema()).toThrow(/no output schema/i);
  });

  // Both SDK majors validate declared output schemas server-side, so a violating
  // tool never delivers bad structuredContent - the call comes back as a tool error.
  test("a tool violating its own declared schema returns a tool error", async () => {
    const mcp = await make();
    const result = await mcp.callTool("weather-strict");
    expect(result).toBeToolError(/validation/i);
    expect(result.structuredContent).toBeUndefined();
  });
});
