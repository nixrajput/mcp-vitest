export interface SamplingRequest {
  messages: unknown[]
  maxTokens?: number
  systemPrompt?: string
  [k: string]: unknown
}

export interface SamplingResult {
  model: string
  role: 'assistant'
  content: { type: 'text'; text: string }
  stopReason?: string
}

export type SamplingDouble = (req: SamplingRequest) => Promise<SamplingResult> | SamplingResult

export interface ElicitationRequest {
  message: string
  requestedSchema: unknown
}

export interface ElicitationResult {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
}

export type ElicitationDouble = (
  req: ElicitationRequest,
) => Promise<ElicitationResult> | ElicitationResult

export interface Root {
  uri: string
  name?: string
}

/**
 * Holds the registered doubles. Handlers read through it at call time rather than
 * capturing a double, so registration works before OR after connect.
 */
export class DoubleRegistry {
  sampling?: SamplingDouble
  elicitation?: ElicitationDouble
  roots?: Root[]

  requireSampling(): SamplingDouble {
    return this.sampling ?? missing('sampling', 'onSampling')
  }

  requireElicitation(): ElicitationDouble {
    return this.elicitation ?? missing('elicitation', 'onElicitation')
  }

  requireRoots(): Root[] {
    return this.roots ?? missing('roots', 'onRoots')
  }
}

function missing(what: string, method: string): never {
  throw new Error(
    `mcp-vitest: the server requested ${what} but no double is registered. ` +
      `Call harness.${method}(...) before triggering it.`,
  )
}
