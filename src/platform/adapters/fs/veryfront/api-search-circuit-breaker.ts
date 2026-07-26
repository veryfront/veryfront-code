interface ApiSearchCircuitBreakerOptions {
  threshold: number;
  cooldownMs: number;
}

export class ApiSearchCircuitBreaker {
  private failures = 0;
  private disabledUntil = 0;

  constructor(private readonly options: ApiSearchCircuitBreakerOptions) {
    if (!Number.isSafeInteger(options.threshold) || options.threshold < 1) {
      throw new RangeError("threshold must be a positive safe integer");
    }
    if (!Number.isSafeInteger(options.cooldownMs) || options.cooldownMs < 0) {
      throw new RangeError("cooldownMs must be a non-negative safe integer");
    }
  }

  canSearch(now = Date.now()): boolean {
    if (!Number.isFinite(now)) throw new RangeError("now must be finite");
    return now >= this.disabledUntil;
  }

  recordSuccess(): void {
    this.failures = 0;
  }

  recordFailure(now = Date.now()): { tripped: boolean; failures: number } {
    if (!Number.isFinite(now)) throw new RangeError("now must be finite");
    this.failures++;
    if (this.failures < this.options.threshold) {
      return { tripped: false, failures: this.failures };
    }

    this.disabledUntil = Math.min(
      Number.MAX_SAFE_INTEGER,
      now + this.options.cooldownMs,
    );
    this.failures = 0;
    return { tripped: true, failures: this.options.threshold };
  }
}
