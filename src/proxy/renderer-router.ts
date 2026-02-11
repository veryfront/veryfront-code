/**
 * RendererRouter — sticky session routing using jump consistent hash.
 *
 * Resolves renderer pod endpoints via DNS A record lookup on a headless
 * Kubernetes Service. Uses Google's jump consistent hash to map a projectSlug
 * to a stable pod index, ensuring the same project hits the same pod for
 * maximum local cache reuse.
 *
 * Falls back to the ClusterIP service URL when:
 * - No headless service is configured
 * - DNS resolution fails
 * - No project slug is available (health checks, error paths)
 */

import { resolve4 } from "node:dns/promises";
import { proxyLogger } from "./logger.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

const DEFAULT_REFRESH_MS = 15_000;
const DEFAULT_SERVER_PORT = 20000;

/**
 * FNV-1a hash producing a 64-bit BigInt seed from a string.
 */
function fnv1a64(input: string): bigint {
  // FNV offset basis and prime for 64-bit
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

/**
 * Jump consistent hash (Lamping & Veach, 2014).
 * Maps a 64-bit key to a bucket in [0, numBuckets).
 * When numBuckets changes by 1, only ~1/n keys are remapped.
 *
 * Uses BigInt for correct 64-bit arithmetic.
 */
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

    // Kick off initial DNS resolution
    this.refreshPods();

    // Periodic refresh
    const interval = refreshMs ?? DEFAULT_REFRESH_MS;
    this.refreshTimer = setInterval(() => this.refreshPods(), interval);

    // Unref so the timer doesn't keep the process alive during shutdown
    if (typeof this.refreshTimer === "object" && "unref" in this.refreshTimer) {
      this.refreshTimer.unref();
    }
  }

  /**
   * Resolve a renderer URL for the given project slug.
   * Returns a direct pod URL for sticky routing, or the ClusterIP fallback.
   */
  resolve(projectSlug: string | undefined): string {
    if (!projectSlug || this.pods.length === 0) {
      return this.fallbackUrl;
    }

    const idx = jumpHash(projectSlug, this.pods.length);
    return `http://${this.pods[idx]}:${this.serverPort}`;
  }

  /** Stop the refresh timer. */
  close(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Current pod list (for testing / diagnostics). */
  get podCount(): number {
    return this.pods.length;
  }

  /** Inject pod list directly (for testing). */
  _setPods(ips: string[]): void {
    this.pods = ips.sort();
  }

  private async refreshPods(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;

    try {
      const ips = await resolve4(this.headlessService);
      // Sort for stable ordering across refreshes
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
      // Keep existing pod list — don't wipe on transient DNS failure
    } finally {
      this.refreshing = false;
    }
  }
}
