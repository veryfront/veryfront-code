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

const MAX_STALENESS_MS = 5 * 60 * 1_000; // 5 minutes

export class RendererRouter {
  private targets: string[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;
  private serverPort: number;
  private lastSuccessfulRefresh = 0;
  private _ready: Promise<void>;

  constructor(
    private discoveryHost: string,
    private fallbackUrl: string,
    refreshMs?: number,
  ) {
    const portEnv = getEnv("VERYFRONT_SERVER_PORT");
    const parsed = portEnv ? parseInt(portEnv) : NaN;
    this.serverPort = Number.isNaN(parsed) ? DEFAULT_SERVER_PORT : parsed;

    // Support static server targets via env var (bypasses DNS discovery)
    const staticTargets = getEnv("VERYFRONT_SERVER_TARGETS");
    if (staticTargets) {
      this.targets = staticTargets.split(",").map((ip) => ip.trim()).filter(Boolean).sort();
      this.lastSuccessfulRefresh = Date.now();
      this._ready = Promise.resolve();
      proxyLogger.debug("[RendererRouter] Using static targets", { targets: this.targets.length });
      return;
    }

    this._ready = this.refreshTargets();
    const interval = refreshMs ?? DEFAULT_REFRESH_MS;
    this.refreshTimer = setInterval(() => this.refreshTargets(), interval);
    unrefTimer(this.refreshTimer);
  }

  ready(): Promise<void> {
    return this._ready;
  }

  resolve(projectSlug: string | undefined): string {
    if (!projectSlug || this.targets.length === 0) return this.fallbackUrl;
    if (
      this.lastSuccessfulRefresh > 0 && Date.now() - this.lastSuccessfulRefresh > MAX_STALENESS_MS
    ) {
      proxyLogger.debug("[RendererRouter] Target list stale, falling back to default");
      return this.fallbackUrl;
    }
    const idx = jumpHash(projectSlug, this.targets.length);
    return `http://${this.targets[idx]}:${this.serverPort}`;
  }

  close(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  get targetCount(): number {
    return this.targets.length;
  }

  /** Test helper: inject server IPs without DNS resolution */
  _setTargets(ips: string[]): void {
    this.targets = ips.sort();
    this.lastSuccessfulRefresh = Date.now();
  }

  /** Test helper: override last successful refresh timestamp */
  _setLastRefresh(timestamp: number): void {
    this.lastSuccessfulRefresh = timestamp;
  }

  private async refreshTargets(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const ips = await resolve4(this.discoveryHost);
      this.targets = ips.sort();
      this.lastSuccessfulRefresh = Date.now();
      proxyLogger.debug("[RendererRouter] DNS refresh", {
        host: this.discoveryHost,
        targets: this.targets.length,
      });
    } catch (error) {
      proxyLogger.debug("[RendererRouter] DNS resolution failed, keeping existing targets", {
        host: this.discoveryHost,
        error: error instanceof Error ? error.message : String(error),
        existingTargets: this.targets.length,
      });
    } finally {
      this.refreshing = false;
    }
  }
}
