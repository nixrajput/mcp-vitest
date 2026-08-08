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

// v1 only, and present so a roots double can be proven over the pipe.
server.registerTool('list-roots', { description: "Lists the client's roots" }, async () => {
  const { roots } = await server.server.listRoots()
  return { content: [{ type: 'text', text: `roots: ${roots.map((r) => r.uri).join(',')}` }] }
})

server.registerResource(
  'greeting',
  'demo://greeting',
  { description: 'A fixed greeting' },
  async (uri) => ({ contents: [{ uri: uri.href, text: 'hello' }] }),
)

// Reports the spawn environment back to the test, so the env and cwd options on
// a stdio spec are covered rather than assumed to be forwarded.
server.registerTool('spawn-info', { description: 'Reports env and cwd' }, async () => ({
  content: [
    {
      type: 'text',
      text: `probe: ${process.env.MCP_VITEST_PROBE ?? '(unset)'} cwd: ${process.cwd()}`,
    },
  ],
}))

await server.connect(new StdioServerTransport())
