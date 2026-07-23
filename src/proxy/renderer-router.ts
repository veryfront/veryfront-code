import { resolve4 } from "node:dns/promises";
import { isIPv4 } from "node:net";
import { proxyLogger } from "./logger.ts";
import { getEnv, unrefTimer } from "#veryfront/platform/compat/process.ts";

const DEFAULT_REFRESH_MS = 15_000;
const DEFAULT_SERVER_PORT = 20000;
const MIN_REFRESH_MS = 1_000;
const MAX_REFRESH_MS = 4 * 60 * 1_000;
const DNS_RESOLUTION_TIMEOUT_MS = 5_000;

function fnv1a64(input: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

/** Maps a string key to one of a positive number of stable hash buckets. */
export function jumpHash(keyStr: string, numBuckets: number): number {
  if (!Number.isSafeInteger(numBuckets) || numBuckets <= 0) {
    throw new RangeError("numBuckets must be a positive safe integer");
  }
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

function parseServerPort(rawValue: string | undefined): number {
  if (!rawValue || !/^\d+$/u.test(rawValue)) return DEFAULT_SERVER_PORT;
  const parsed = Number(rawValue);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 65_535
    ? parsed
    : DEFAULT_SERVER_PORT;
}

function normalizeRefreshInterval(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < MIN_REFRESH_MS) {
    return DEFAULT_REFRESH_MS;
  }
  return Math.min(value, MAX_REFRESH_MS);
}

function normalizeTargets(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(isIPv4))].sort();
}

function normalizeRendererOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError("Renderer fallback must be a valid HTTP origin", { cause: error });
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new TypeError("Renderer fallback must be a valid HTTP origin");
  }
  return url.origin;
}

function validDiscoveryHost(value: string): boolean {
  if (value.length === 0 || value.length > 253 || value !== value.trim()) return false;
  for (let index = 0; index < value.length; index++) {
    const character = value.charAt(index);
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127 || "/\\?#@:".includes(character)) return false;
  }
  return true;
}

async function resolveTargets(host: string): Promise<string[]> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("DNS resolution timed out")),
      DNS_RESOLUTION_TIMEOUT_MS,
    );
    unrefTimer(timeoutId);
  });
  try {
    return normalizeTargets(await Promise.race([resolve4(host), timeout]));
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/** Resolves project slugs to discovered or statically configured renderer targets. */
export class RendererRouter {
  private targets: string[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;
  private serverPort: number;
  private lastSuccessfulRefresh = 0;
  private _ready: Promise<void>;
  private closed = false;
  private readonly usesStaticTargets: boolean;

  /** Creates a router and starts DNS discovery when static targets are not configured. */
  constructor(
    private discoveryHost: string,
    private fallbackUrl: string,
    refreshMs?: number,
  ) {
    this.fallbackUrl = normalizeRendererOrigin(this.fallbackUrl);
    this.serverPort = parseServerPort(getEnv("VERYFRONT_SERVER_PORT"));

    // Support static server targets via env var (bypasses DNS discovery)
    const staticTargets = getEnv("VERYFRONT_SERVER_TARGETS");
    this.usesStaticTargets = Boolean(staticTargets);
    if (staticTargets) {
      this.targets = normalizeTargets(staticTargets.split(","));
      this.lastSuccessfulRefresh = Date.now();
      this._ready = Promise.resolve();
      proxyLogger.debug("[RendererRouter] Using static targets", { targets: this.targets.length });
      return;
    }

    if (!validDiscoveryHost(this.discoveryHost)) {
      throw new TypeError("Renderer discovery host is invalid");
    }

    this._ready = this.refreshTargets();
    const interval = normalizeRefreshInterval(refreshMs);
    this.refreshTimer = setInterval(() => this.refreshTargets(), interval);
    unrefTimer(this.refreshTimer);
  }

  /** Resolves when the initial target discovery attempt finishes. */
  ready(): Promise<void> {
    return this._ready;
  }

  /** Resolves a project slug to a renderer origin or the configured fallback. */
  resolve(projectSlug: string | undefined): string {
    if (!projectSlug || this.targets.length === 0) return this.fallbackUrl;
    if (
      !this.usesStaticTargets &&
      this.lastSuccessfulRefresh > 0 &&
      Date.now() - this.lastSuccessfulRefresh > MAX_STALENESS_MS
    ) {
      proxyLogger.debug("[RendererRouter] Target list stale, falling back to default");
      return this.fallbackUrl;
    }
    const idx = jumpHash(projectSlug, this.targets.length);
    return `http://${this.targets[idx]}:${this.serverPort}`;
  }

  /** Stops periodic discovery while retaining the last target snapshot. */
  close(): void {
    this.closed = true;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Number of currently usable renderer targets. */
  get targetCount(): number {
    return this.targets.length;
  }

  /** Test helper: inject server IPs without DNS resolution */
  _setTargets(ips: string[]): void {
    this.targets = normalizeTargets(ips);
    this.lastSuccessfulRefresh = Date.now();
  }

  /** Test helper: override last successful refresh timestamp */
  _setLastRefresh(timestamp: number): void {
    this.lastSuccessfulRefresh = timestamp;
  }

  /** Refreshes the target snapshot from DNS when no refresh is already active. */
  private async refreshTargets(): Promise<void> {
    if (this.closed || this.refreshing) return;
    this.refreshing = true;
    try {
      const ips = await resolveTargets(this.discoveryHost);
      if (this.closed) return;
      this.targets = ips;
      this.lastSuccessfulRefresh = Date.now();
      proxyLogger.debug("[RendererRouter] DNS refresh", {
        targets: this.targets.length,
      });
    } catch {
      proxyLogger.debug("[RendererRouter] DNS resolution failed, keeping existing targets", {
        existingTargets: this.targets.length,
      });
    } finally {
      this.refreshing = false;
    }
  }
}
