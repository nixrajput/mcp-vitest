import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export function createV1Server(): McpServer {
  const server = new McpServer({ name: 'fixture-v1', version: '1.0.0' })

  server.registerTool(
    'echo',
    {
      description: 'Echoes back the message',
      inputSchema: { message: z.string() },
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
    { description: 'Sleeps with progress', inputSchema: { ms: z.number().optional() } },
    async ({ ms }, extra) => {
      const total = ms ?? 2000
      const progressToken = extra._meta?.progressToken
      for (let i = 1; i <= 10; i++) {
        if (extra.signal.aborted) throw new Error('cancelled')
        await new Promise((r) => setTimeout(r, total / 10))
        if (progressToken !== undefined) {
          await extra.sendNotification({
            method: 'notifications/progress',
            params: { progressToken, progress: i, total: 10 },
          })
        }
      }
      return { content: [{ type: 'text', text: 'done' }] }
    },
  )

  const weatherOutput = { temperature: z.number(), unit: z.string() }

  server.registerTool(
    'weather',
    { description: 'Structured weather', outputSchema: weatherOutput },
    async () => ({
      content: [{ type: 'text', text: '21C' }],
      structuredContent: { temperature: 21, unit: 'celsius' },
    }),
  )

  server.registerTool(
    'weather-bad',
    { description: 'Broken structured weather', outputSchema: weatherOutput },
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
    { description: 'Greeting prompt', argsSchema: { name: z.string() } },
    ({ name }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: `Greet ${name}` } }],
    }),
  )

  return server
}
