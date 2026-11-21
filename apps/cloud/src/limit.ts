// A rate limit per person (the same token bucket as the checker's): a bucket of `burst` requests that refills at
// `perMinute`. The editor saves about once a second while someone types, so the default is well above that.
export interface RateLimit { burst: number; perMinute: number }
export const DEFAULT_RATE: RateLimit = { burst: 120, perMinute: 120 };

export class Limiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly rate: RateLimit, private readonly now: () => number = Date.now) {}

  /** Take one request for `key`. Returns 0 when allowed, else the seconds to wait before the next one is allowed. */
  take(key: string): number {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.rate.burst, at: t };
    b.tokens = Math.min(this.rate.burst, b.tokens + ((t - b.at) / 60_000) * this.rate.perMinute);
    b.at = t;
    this.buckets.set(key, b);
    if (this.buckets.size > 50_000) this.buckets.delete(this.buckets.keys().next().value!);
    if (b.tokens >= 1) { b.tokens -= 1; return 0; }
    return Math.ceil(((1 - b.tokens) * 60) / this.rate.perMinute);
  }
}
