export interface CollectedNotification {
  method: string
  params: unknown
  /** Milliseconds since this collector was created. */
  at: number
}

export class NotificationCollector {
  readonly items: CollectedNotification[] = []
  private waiters: Array<{
    predicate: (n: CollectedNotification) => boolean
    resolve: (n: CollectedNotification) => void
  }> = []
  private readonly started = performance.now()

  constructor(private readonly methodFilter?: string) {}

  push(method: string, params: unknown): void {
    if (this.methodFilter && method !== this.methodFilter) return
    const item = { method, params, at: performance.now() - this.started }
    this.items.push(item)
    this.waiters = this.waiters.filter((w) => {
      if (!w.predicate(item)) return true
      w.resolve(item)
      return false
    })
  }

  waitFor(
    predicate: (n: CollectedNotification) => boolean,
    timeoutMs = 5000,
  ): Promise<CollectedNotification> {
    const existing = this.items.find(predicate)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`waitFor timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
      this.waiters.push({
        predicate,
        resolve: (n) => {
          clearTimeout(timer)
          resolve(n)
        },
      })
    })
  }
}
