import type { CallToolOptions } from "../types.js";

type Notification = { method: string; params: unknown };
type ProgressPayload = { progress: number; total?: number; message?: string };

/** SDK request options both majors accept; only callTool's arity differs. */
interface SdkRequestOptions {
  onprogress?: (p: ProgressPayload) => void;
  signal?: AbortSignal;
  timeout?: number;
}

export interface NotificationBus {
  onNotification(cb: (n: Notification) => void): void;
  /**
   * `onprogress` is set only when asked: the SDK adds `_meta.progressToken`
   * whenever it is present, and servers branch on that token.
   */
  requestOptions(opts?: CallToolOptions): SdkRequestOptions;
}

/**
 * Progress never reaches the fallback handler on either major, so it is fanned
 * out from requestOptions() instead.
 */
export function createNotificationBus(client: unknown): NotificationBus {
  const listeners = new Set<(n: Notification) => void>();
  const emit = (method: string, params: unknown) => {
    for (const l of listeners) l({ method, params });
  };

  (
    client as { fallbackNotificationHandler?: (n: unknown) => Promise<void> }
  ).fallbackNotificationHandler = async (n) => {
    const note = n as Notification;
    emit(note.method, note.params);
  };

  return {
    onNotification: (cb) => {
      listeners.add(cb);
    },
    requestOptions: (opts) => ({
      onprogress: opts?.onProgress
        ? (p) => {
            emit("notifications/progress", p);
            opts.onProgress?.(p);
          }
        : undefined,
      signal: opts?.signal,
      timeout: opts?.timeoutMs,
    }),
  };
}
