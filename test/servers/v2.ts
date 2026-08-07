import {
  completable,
  inputRequired,
  inputResponse,
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/server'
import { z } from 'zod'

const NAMES = ['Ada', 'Alan', 'Grace']

const CONFIRM_SCHEMA = {
  type: 'object' as const,
  properties: { confirm: { type: 'boolean' as const } },
  required: ['confirm'],
}

export function createV2Server(): McpServer {
  const server = new McpServer({ name: 'fixture-v2', version: '1.0.0' })

  server.registerTool(
    'echo',
    {
      description: 'Echoes back the message',
      inputSchema: z.object({ message: z.string() }),
    },
    async ({ message }) => ({
      content: [{ type: 'text', text: `echo: ${message}` }],
    }),
  )

  server.registerTool('boom', { description: 'Always fails' }, async () => ({
    isError: true,
    content: [{ type: 'text', text: 'kaboom' }],
  }))

  server.registerTool(
    'slow',
    {
      description: 'Sleeps with progress',
      inputSchema: z.object({ ms: z.number().optional() }),
    },
    async ({ ms }, ctx) => {
      const total = ms ?? 2000
      const progressToken = ctx.mcpReq._meta?.progressToken
      for (let i = 1; i <= 10; i++) {
        if (ctx.mcpReq.signal.aborted) throw new Error('cancelled')
        await new Promise((r) => setTimeout(r, total / 10))
        if (progressToken !== undefined) {
          await ctx.mcpReq.notify({
            method: 'notifications/progress',
            params: { progressToken, progress: i, total: 10 },
          })
        }
      }
      return { content: [{ type: 'text', text: 'done' }] }
    },
  )

  const weatherOutput = z.object({ temperature: z.number(), unit: z.string() })

  server.registerTool(
    'weather',
    { description: 'Structured weather', outputSchema: weatherOutput },
    async () => ({
      content: [{ type: 'text', text: '21C' }],
      structuredContent: { temperature: 21, unit: 'celsius' },
    }),
  )

  // No outputSchema on purpose: both SDK majors validate declared output schemas
  // server-side and convert a violation into an isError result, so a tool that
  // declares one can never hand invalid structuredContent to the client.
  server.registerTool('weather-bad', { description: 'Broken structured weather' }, async () => ({
    content: [{ type: 'text', text: 'hot' }],
    structuredContent: { temperature: 'hot' },
  }))

  server.registerTool(
    'weather-strict',
    { description: 'Declares a schema its output violates', outputSchema: weatherOutput },
    async () => ({
      content: [{ type: 'text', text: 'hot' }],
      structuredContent: { temperature: 'hot' } as never,
    }),
  )

  // Server-initiated interaction, 2026 style. The push helpers on ctx.mcpReq are
  // unusable here: they throw on a 2026 connection and hang on a legacy one, so
  // these tools answer with inputRequired and read the reply on the client's retry.
  server.registerTool(
    'ask',
    {
      description: 'Asks the user via elicitation',
      inputSchema: z.object({ question: z.string() }),
    },
    async ({ question }, ctx) => {
      const reply = inputResponse(ctx.mcpReq.inputResponses, 'confirm')
      if (reply.kind === 'missing') {
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({ message: question, requestedSchema: CONFIRM_SCHEMA }),
          },
        })
      }
      return reply.kind === 'elicit' && reply.action === 'accept'
        ? { content: [{ type: 'text', text: `answer: ${JSON.stringify(reply.content)}` }] }
        : { content: [{ type: 'text', text: 'declined' }] }
    },
  )

  server.registerTool(
    'summarize',
    { description: 'Summarizes text via sampling', inputSchema: z.object({ text: z.string() }) },
    async ({ text }, ctx) => {
      const reply = inputResponse(ctx.mcpReq.inputResponses, 'summary')
      if (reply.kind === 'missing') {
        return inputRequired({
          inputRequests: {
            summary: inputRequired.createMessage({
              messages: [{ role: 'user', content: { type: 'text', text } }],
              maxTokens: 50,
            }),
          },
        })
      }
      // Tool-augmented sampling returns an array of blocks, plain sampling one block.
      const blocks = reply.kind === 'sampling' ? [reply.result.content].flat() : []
      const block = blocks.find((b) => b.type === 'text')
      const summary = block && 'text' in block ? block.text : ''
      return { content: [{ type: 'text', text: `summary: ${summary}` }] }
    },
  )

  server.registerResource(
    'greeting',
    'demo://greeting',
    { description: 'A fixed greeting' },
    async (uri) => ({ contents: [{ uri: uri.href, text: 'hello' }] }),
  )

  // Exists so the ref/resource half of complete() is covered, not just ref/prompt.
  server.registerResource(
    'person',
    new ResourceTemplate('demo://person/{name}', {
      list: undefined,
      complete: { name: (value) => NAMES.filter((n) => n.startsWith(value)) },
    }),
    { description: 'A templated person resource' },
    async (uri) => ({ contents: [{ uri: uri.href, text: 'person' }] }),
  )

  server.registerPrompt(
    'greet',
    {
      description: 'Greeting prompt',
      argsSchema: z.object({
        name: completable(z.string(), (value) => NAMES.filter((n) => n.startsWith(value))),
      }),
    },
    ({ name }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: `Greet ${name}` } }],
    }),
  )

  return server
}
