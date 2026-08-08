import { describe, expect, test } from "vitest";
import { mcpTest } from "../src/index.js";
import { createV1Server } from "./servers/v1.js";
import { createV2Server } from "./servers/v2.js";

describe.each([
  ["v1", () => mcpTest(createV1Server())],
  ["v2", () => mcpTest(() => createV2Server())],
])("complete (%s)", (_label, make) => {
  test("completes a prompt argument by prefix", async () => {
    const mcp = await make();
    const { completion } = await mcp.complete(
      { type: "ref/prompt", name: "greet" },
      { name: "name", value: "A" },
    );
    expect(completion.values.sort()).toEqual(["Ada", "Alan"]);
  });

  test("a non-matching prefix completes to nothing", async () => {
    const mcp = await make();
    const { completion } = await mcp.complete(
      { type: "ref/prompt", name: "greet" },
      { name: "name", value: "Zz" },
    );
    expect(completion.values).toEqual([]);
  });

  // CompletionRef is a two-member union; without this only ref/prompt was proven.
  test("completes a resource-template variable", async () => {
    const mcp = await make();
    const { completion } = await mcp.complete(
      { type: "ref/resource", uri: "demo://person/{name}" },
      { name: "name", value: "A" },
    );
    expect(completion.values.sort()).toEqual(["Ada", "Alan"]);
  });
});
