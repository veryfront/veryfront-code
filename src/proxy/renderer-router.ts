import { resolve4 } from "node:dns/promises";
import { proxyLogger } from "./logger.ts";
import { getEnv, unrefTimer } from "#veryfront/platform/compat/process.ts";

const DEFAULT_REFRESH_MS = 15_000;
const DEFAULT_SERVER_PORT = 20000;

function fnv1a64(input: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

export function jumpHash(keyStr: string, numBuckets: number): number {
  let key = fnv1a64(keyStr);
  let b = -1n;
  let j = 0n;
  const nb = BigInt(numBuckets);
  while (j < nb) {
    b = j;
    key = ((key * 2862933555777941757n) + 1n) & 0xffffffffffffffffn;
    j = BigInt(Math.floor(Number(b + 1n) * 2147483648.0 / (Number(key >> 33n) + 1)));
  }
  return Number(b);
}

export class RendererRouter {
  private pods: string[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;
  private serverPort: number;

  constructor(
    private headlessService: string,
    private fallbackUrl: string,
    refreshMs?: number,
  ) {
    this.serverPort = parseInt(getEnv("VERYFRONT_SERVER_PORT") || String(DEFAULT_SERVER_PORT));
    this.refreshPods();
    const interval = refreshMs ?? DEFAULT_REFRESH_MS;
    this.refreshTimer = setInterval(() => this.refreshPods(), interval);
    unrefTimer(this.refreshTimer);
  }

  resolve(projectSlug: string | undefined): string {
    if (!projectSlug || this.pods.length === 0) return this.fallbackUrl;
    const idx = jumpHash(projectSlug, this.pods.length);
    return `http://${this.pods[idx]}:${this.serverPort}`;
  }

  close(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  get podCount(): number {
    return this.pods.length;
  }

  /** Test helper: inject pod IPs without DNS resolution */
  _setPods(ips: string[]): void {
    this.pods = ips.sort();
  }

  private async refreshPods(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const ips = await resolve4(this.headlessService);
      this.pods = ips.sort();
      proxyLogger.debug("[RendererRouter] DNS refresh", {
        service: this.headlessService,
        pods: this.pods.length,
      });
    } catch (error) {
      proxyLogger.debug("[RendererRouter] DNS resolution failed, keeping existing pods", {
        service: this.headlessService,
        error: error instanceof Error ? error.message : String(error),
        existingPods: this.pods.length,
      });
    } finally {
      this.refreshing = false;
    }
  }
}
