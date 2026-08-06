import type { CallToolOptions, McpToolResult } from '../types.js'

type Notification = { method: string; params: unknown }
type ProgressPayload = { progress: number; total?: number; message?: string }

/** SDK request options both majors accept; only callTool's arity differs. */
export interface SdkRequestOptions {
  onprogress?: (p: ProgressPayload) => void
  signal?: AbortSignal
  timeout?: number
}

export interface NotificationBus {
  onNotification(cb: (n: Notification) => void): void
  /**
   * Maps CallToolOptions onto SDK request options. `onprogress` is set only when
   * the caller asked for progress: the SDK adds `_meta.progressToken` to the
   * request whenever it is present, and servers branch on that token, so
   * attaching one unconditionally would change what the server sees.
   */
  requestOptions(opts?: CallToolOptions): SdkRequestOptions
}

/**
 * Wires a client's fallback notification handler into a listener set. Progress
 * never arrives there - both majors register a dedicated progress handler at
 * construction - so it is fanned out from requestOptions() instead.
 */
export function createNotificationBus(client: unknown): NotificationBus {
  const listeners = new Set<(n: Notification) => void>()
  const emit = (method: string, params: unknown) => {
    for (const l of listeners) l({ method, params })
  }

  ;(
    client as { fallbackNotificationHandler?: (n: unknown) => Promise<void> }
  ).fallbackNotificationHandler = async (n) => {
    const note = n as Notification
    emit(note.method, note.params)
  }

  return {
    onNotification: (cb) => {
      listeners.add(cb)
    },
    requestOptions: (opts) => ({
      onprogress: opts?.onProgress
        ? (p) => {
            emit('notifications/progress', p)
            opts.onProgress?.(p)
          }
        : undefined,
      signal: opts?.signal,
      timeout: opts?.timeoutMs,
    }),
  }
}

export type { McpToolResult }
