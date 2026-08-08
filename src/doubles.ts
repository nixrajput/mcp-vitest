export interface SamplingMessage {
  role: string;
  content: unknown;
}

export interface SamplingRequest {
  messages: SamplingMessage[];
  maxTokens?: number;
  systemPrompt?: string;
  [k: string]: unknown;
}

export interface SamplingResult {
  model: string;
  role: "assistant";
  content: { type: "text"; text: string };
  stopReason?: string;
}

export type SamplingDouble = (req: SamplingRequest) => Promise<SamplingResult> | SamplingResult;

export interface ElicitationRequest {
  message: string;
  /** Absent in 2026 URL-mode elicitation, which carries a `url` instead. */
  requestedSchema?: unknown;
  [k: string]: unknown;
}

/**
 * `content` is narrowed to what the wire accepts. The spec's elicitation result
 * takes primitives and string arrays only, so a nested object here would
 * typecheck and then fail protocol validation at runtime.
 */
export interface ElicitationResult {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string | number | boolean | string[]>;
}

export type ElicitationDouble = (
  req: ElicitationRequest,
) => Promise<ElicitationResult> | ElicitationResult;

export interface Root {
  uri: string;
  name?: string;
}

/**
 * Holds the registered doubles. Handlers read through it at call time rather than
 * capturing a double, so registration works before OR after connect.
 */
export class DoubleRegistry {
  sampling?: SamplingDouble;
  elicitation?: ElicitationDouble;
  roots?: Root[];

  requireSampling(): SamplingDouble {
    return this.sampling ?? missing("sampling", "onSampling");
  }

  requireElicitation(): ElicitationDouble {
    return this.elicitation ?? missing("elicitation", "onElicitation");
  }

  requireRoots(): Root[] {
    return this.roots ?? missing("roots", "onRoots");
  }
}

function missing(what: string, method: string): never {
  throw new Error(
    `mcp-vitest: the server requested ${what} but no double is registered. ` +
      `Call harness.${method}(...) before triggering it.`,
  );
}
