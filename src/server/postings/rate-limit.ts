/**
 * Per-user sliding-window limiter for outbound job-board reads. In-process:
 * one instance's view only; behind multiple instances use a shared store.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now = () => Date.now()) {}
  /** Returns true if allowed (and records the hit). */
  take(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }
}
