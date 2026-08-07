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
    timer: ReturnType<typeof setTimeout>
  }> = []
  private readonly started = performance.now()

  constructor(readonly method?: string) {}

  /** Whether this collector would accept a progress notification. */
  get wantsProgress(): boolean {
    return !this.method || this.method === 'notifications/progress'
  }

  push(method: string, params: unknown): void {
    if (this.method && method !== this.method) return
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
      const timer = setTimeout(() => {
        // Drop the waiter, or its predicate keeps running on every later
        // notification and the dead closure pins this rejected promise.
        this.waiters = this.waiters.filter((w) => w.timer !== timer)
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.waiters.push({
        predicate,
        resolve: (n) => {
          clearTimeout(timer)
          resolve(n)
        },
        timer,
      })
    })
  }

  /**
   * Abandons pending waiters without settling them. Called by harness.close():
   * a rejection after the test has ended is reported against the next test.
   */
  dispose(): void {
    for (const w of this.waiters) clearTimeout(w.timer)
    this.waiters = []
  }
}
