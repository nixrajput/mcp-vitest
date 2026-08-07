// Runnable v1 stdio server, spawned by test/external.test.ts. Plain JS on
// purpose: it must start with bare `node` and no build step.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'fixture-stdio', version: '1.0.0' })

server.registerTool(
  'echo',
  { description: 'Echoes back the message', inputSchema: { message: z.string() } },
  async ({ message }) => ({ content: [{ type: 'text', text: `echo: ${message}` }] }),
)

// Present so the doubles path is proven over a real process boundary, not just
// in memory - the client's handlers have to answer across the pipe.
server.registerTool(
  'ask',
  { description: 'Asks the user via elicitation', inputSchema: { question: z.string() } },
  async ({ question }) => {
    const res = await server.server.elicitInput({
      message: question,
      requestedSchema: {
        type: 'object',
        properties: { confirm: { type: 'boolean' } },
        required: ['confirm'],
      },
    })
    return res.action === 'accept'
      ? { content: [{ type: 'text', text: `answer: ${JSON.stringify(res.content)}` }] }
      : { content: [{ type: 'text', text: 'declined' }] }
  },
)

server.registerResource(
  'greeting',
  'demo://greeting',
  { description: 'A fixed greeting' },
  async (uri) => ({ contents: [{ uri: uri.href, text: 'hello' }] }),
)

await server.connect(new StdioServerTransport())
