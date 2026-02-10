export interface APISearchCircuitBreakerOptions {
  threshold: number;
  cooldownMs: number;
}

export class APISearchCircuitBreaker {
  private failures = 0;
  private disabledUntil = 0;

  constructor(private readonly options: APISearchCircuitBreakerOptions) {}

  canSearch(now = Date.now()): boolean {
    return now >= this.disabledUntil;
  }

  recordSuccess(): void {
    this.failures = 0;
  }

  recordFailure(now = Date.now()): { tripped: boolean; failures: number } {
    this.failures++;
    if (this.failures < this.options.threshold) {
      return { tripped: false, failures: this.failures };
    }

    this.disabledUntil = now + this.options.cooldownMs;
    this.failures = 0;
    return { tripped: true, failures: this.options.threshold };
  }
}
