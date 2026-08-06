import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

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

  server.registerResource(
    'greeting',
    'demo://greeting',
    { description: 'A fixed greeting' },
    async (uri) => ({ contents: [{ uri: uri.href, text: 'hello' }] }),
  )

  server.registerPrompt(
    'greet',
    {
      description: 'Greeting prompt',
      argsSchema: z.object({ name: z.string() }),
    },
    ({ name }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: `Greet ${name}` } }],
    }),
  )

  return server
}
