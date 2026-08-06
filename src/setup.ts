import { registerMatchers } from './matchers.js'

registerMatchers()

// Re-exported so this entry's .d.ts pulls in matchers.d.ts, which carries the
// `declare module 'vitest'` augmentation. Without it, projects that register
// matchers only through setupFiles get them at runtime but not in the types.
export { mcpMatchers, registerMatchers } from './matchers.js'
