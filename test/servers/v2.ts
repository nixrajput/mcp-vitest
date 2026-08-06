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
