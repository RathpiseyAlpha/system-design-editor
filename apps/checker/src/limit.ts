// A rate limit per host key (SPEC section 10): a bucket of `burst` requests that refills at `perMinute`. A class that
// hands in at the deadline is a burst of about 100 checks, so the default bucket holds that many.
export interface RateLimit { burst: number; perMinute: number }
export const DEFAULT_RATE: RateLimit = { burst: 120, perMinute: 120 };

export class Limiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly rate: RateLimit, private readonly now: () => number = Date.now) {}

  /** Take one request for `host`. Returns 0 when allowed, else the seconds to wait before the next one is allowed. */
  take(host: string): number {
    const t = this.now();
    const b = this.buckets.get(host) ?? { tokens: this.rate.burst, at: t };
    b.tokens = Math.min(this.rate.burst, b.tokens + ((t - b.at) / 60_000) * this.rate.perMinute);
    b.at = t;
    this.buckets.set(host, b);
    if (b.tokens >= 1) { b.tokens -= 1; return 0; }
    return Math.ceil(((1 - b.tokens) * 60) / this.rate.perMinute);
  }
}
