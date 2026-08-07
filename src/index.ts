export { detectServerKind, type ServerKind } from './detect.js'
export type {
  ElicitationDouble,
  ElicitationRequest,
  ElicitationResult,
  Root,
  SamplingDouble,
  SamplingMessage,
  SamplingRequest,
  SamplingResult,
} from './doubles.js'
// DoubleRegistry is exported because McpHarness's constructor requires one; without
// it the exported class would be externally unconstructible.
export { DoubleRegistry } from './doubles.js'
export { createMcpTest, type LifecycleMcpTest } from './fixture.js'
export { McpHarness, mcpTest } from './harness.js'
export { mcpMatchers, registerMatchers } from './matchers.js'
export { type CollectedNotification, NotificationCollector } from './notifications.js'
export { type FetchHandler, type ServedHandler, serveHandler } from './serve.js'
export {
  capabilitiesManifest,
  promptManifest,
  resourceManifest,
  toolManifest,
} from './snapshot.js'
export type {
  CallToolOptions,
  CompletionArgument,
  CompletionRef,
  CompletionResult,
  McpLifecycle,
  McpServerInput,
  McpTestOptions,
  McpToolResult,
  RawConnection,
  SdkClientLike,
  StdioServerSpec,
} from './types.js'
