import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const NAMES = ["Ada", "Alan", "Grace"];

const CONFIRM_SCHEMA = {
  type: "object" as const,
  properties: { confirm: { type: "boolean" as const } },
  required: ["confirm"],
};

export function createV1Server(): McpServer {
  const server = new McpServer({ name: "fixture-v1", version: "1.0.0" });

  server.registerTool(
    "echo",
    {
      description: "Echoes back the message",
      inputSchema: { message: z.string() },
    },
    async ({ message }) => ({
      content: [{ type: "text", text: `echo: ${message}` }],
    }),
  );

  server.registerTool("boom", { description: "Always fails" }, async () => ({
    isError: true,
    content: [{ type: "text", text: "kaboom" }],
  }));

  server.registerTool(
    "slow",
    { description: "Sleeps with progress", inputSchema: { ms: z.number().optional() } },
    async ({ ms }, extra) => {
      const total = ms ?? 2000;
      const progressToken = extra._meta?.progressToken;
      for (let i = 1; i <= 10; i++) {
        if (extra.signal.aborted) throw new Error("cancelled");
        await new Promise((r) => setTimeout(r, total / 10));
        if (progressToken !== undefined) {
          await extra.sendNotification({
            method: "notifications/progress",
            params: { progressToken, progress: i, total: 10 },
          });
        }
      }
      return { content: [{ type: "text", text: "done" }] };
    },
  );

  const weatherOutput = { temperature: z.number(), unit: z.string() };

  server.registerTool(
    "weather",
    { description: "Structured weather", outputSchema: weatherOutput },
    async () => ({
      content: [{ type: "text", text: "21C" }],
      structuredContent: { temperature: 21, unit: "celsius" },
    }),
  );

  // No outputSchema on purpose: both SDK majors validate declared output schemas
  // server-side and convert a violation into an isError result, so a tool that
  // declares one can never hand invalid structuredContent to the client.
  server.registerTool("weather-bad", { description: "Broken structured weather" }, async () => ({
    content: [{ type: "text", text: "hot" }],
    structuredContent: { temperature: "hot" },
  }));

  server.registerTool(
    "weather-strict",
    { description: "Declares a schema its output violates", outputSchema: weatherOutput },
    async () => ({
      content: [{ type: "text", text: "hot" }],
      structuredContent: { temperature: "hot" } as never,
    }),
  );

  // Server-initiated interaction. v1 keeps the 2025 push model: the server sends
  // a request and awaits the client's answer over the open connection.
  server.registerTool(
    "ask",
    { description: "Asks the user via elicitation", inputSchema: { question: z.string() } },
    async ({ question }) => {
      const res = await server.server.elicitInput({
        message: question,
        requestedSchema: CONFIRM_SCHEMA,
      });
      return res.action === "accept"
        ? { content: [{ type: "text", text: `answer: ${JSON.stringify(res.content)}` }] }
        : { content: [{ type: "text", text: "declined" }] };
    },
  );

  server.registerTool(
    "summarize",
    { description: "Summarizes text via sampling", inputSchema: { text: z.string() } },
    async ({ text }) => {
      const res = await server.server.createMessage({
        messages: [{ role: "user", content: { type: "text", text } }],
        maxTokens: 50,
      });
      const summary = res.content.type === "text" ? res.content.text : "";
      return { content: [{ type: "text", text: `summary: ${summary}` }] };
    },
  );

  // v1 only: roots is deprecated in the 2026-07-28 revision.
  server.registerTool("list-roots", { description: "Lists the client's roots" }, async () => {
    const { roots } = await server.server.listRoots();
    return { content: [{ type: "text", text: `roots: ${roots.map((r) => r.uri).join(",")}` }] };
  });

  server.registerResource(
    "greeting",
    "demo://greeting",
    { description: "A fixed greeting" },
    async (uri) => ({ contents: [{ uri: uri.href, text: "hello" }] }),
  );

  // Exists so the ref/resource half of complete() is covered, not just ref/prompt.
  server.registerResource(
    "person",
    new ResourceTemplate("demo://person/{name}", {
      list: undefined,
      complete: { name: (value) => NAMES.filter((n) => n.startsWith(value)) },
    }),
    { description: "A templated person resource" },
    async (uri) => ({ contents: [{ uri: uri.href, text: "person" }] }),
  );

  server.registerPrompt(
    "greet",
    {
      description: "Greeting prompt",
      argsSchema: {
        name: completable(z.string(), (value) => NAMES.filter((n) => n.startsWith(value))),
      },
    },
    ({ name }) => ({
      messages: [{ role: "user", content: { type: "text", text: `Greet ${name}` } }],
    }),
  );

  return server;
}
