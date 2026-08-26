import { getErrorMessage } from "#veryfront/errors";
import { isErrorAcrossRealms } from "#veryfront/platform/compat/error-introspection.ts";
import { getEnv, unrefTimer } from "#veryfront/platform/compat/process.ts";
import {
  hasProjectIdentityControlCharacters,
  isCanonicalProjectSlug,
} from "#veryfront/utils/project-identity.ts";
import { isIP } from "node:net";
import { resolve4 } from "node:dns/promises";
import { proxyLogger } from "./logger.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

const DEFAULT_REFRESH_MS = 15_000;
const DEFAULT_REFRESH_TIMEOUT_MS = 5_000;
const DEFAULT_SERVER_PORT = 20_000;
const MAX_STALENESS_MS = 5 * 60 * 1_000;
const MIN_REFRESH_MS = 1_000;
const MAX_REFRESH_MS = MAX_STALENESS_MS;
const MAX_REFRESH_TIMEOUT_MS = 60_000;
const MAX_TARGETS = 4_096;
const MAX_STATIC_TARGETS_CODE_UNITS = 64 * 1_024;
const MAX_DISCOVERY_HOST_CODE_UNITS = 253;
const MAX_FALLBACK_URL_CODE_UNITS = 4_096;
// Decimal BigInt literals, matching the FNV-1a constants in
// src/cache/keys/utils.ts. Hexadecimal BigInt literals are not modelled by
// CodeQL's abstract interpreter, which reports them as undefined operands.
const FNV_OFFSET_BASIS = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const JUMP_HASH_MULTIPLIER = 2_862_933_555_777_941_757n;
const JUMP_HASH_SCALE = 2_147_483_648;
const UINT64_MODULUS = 1n << 64n;

const logger = proxyLogger.child({ module: "renderer-router" });
const EMPTY_TARGETS: readonly string[] = Object.freeze([]);

type ResolveTargets = (hostname: string) => Promise<readonly string[]>;
type ReadEnvironment = (name: string) => string | undefined;

export interface RendererRouterOptions {
  refreshMs?: number;
  refreshTimeoutMs?: number;
  serverPort?: number;
  staticTargets?: readonly string[];
  resolveTargets?: ResolveTargets;
  now?: () => number;
}

function monotonicMilliseconds(): number {
  return Math.floor(performance.now());
}

function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < input.length; index++) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * FNV_PRIME) % UINT64_MODULUS;
  }
  return hash;
}

export function jumpHash(keyValue: string, numBuckets: number): number {
  if (!isCanonicalProjectSlug(keyValue)) {
    throw new TypeError("Jump hash key must be a canonical project slug");
  }
  if (
    !Number.isSafeInteger(numBuckets) ||
    numBuckets < 1 ||
    numBuckets > MAX_TARGETS
  ) {
    throw new RangeError(
      `Jump hash bucket count must be an integer between 1 and ${MAX_TARGETS}`,
    );
  }

  let key = fnv1a64(keyValue);
  let previous = -1n;
  let next = 0n;
  const bucketCount = BigInt(numBuckets);
  while (next < bucketCount) {
    previous = next;
    key = ((key * JUMP_HASH_MULTIPLIER) + 1n) % UINT64_MODULUS;
    next = BigInt(
      Math.floor(
        Number(previous + 1n) * JUMP_HASH_SCALE /
          (Number(key >> 33n) + 1),
      ),
    );
  }
  return Number(previous);
}

function assertPlainOptions(options: RendererRouterOptions): void {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Renderer router options must be an object");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(options);
    keys = Reflect.ownKeys(options);
  } catch (error) {
    throw new TypeError("Renderer router options are unreadable", {
      cause: error,
    });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Renderer router options must be a plain object");
  }
  const allowed = new Set([
    "refreshMs",
    "refreshTimeoutMs",
    "serverPort",
    "staticTargets",
    "resolveTargets",
    "now",
  ]);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new TypeError("Renderer router options contain an unknown option");
  }
}

function readOwnOption(
  options: RendererRouterOptions,
  key: keyof RendererRouterOptions,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(options, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Renderer router option ${key} must be a data property`);
  }
  return descriptor.value;
}

function resolveInteger(
  value: unknown,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function parseEnvironmentInteger(
  value: string | undefined,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) {
    throw new TypeError(`${label} must be a decimal integer`);
  }
  return resolveInteger(
    Number(value),
    fallback,
    label,
    minimum,
    maximum,
  );
}

function normalizeFallbackUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_FALLBACK_URL_CODE_UNITS ||
    value !== value.trim() ||
    value.includes("@") ||
    value.includes("\\") ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw new TypeError("Renderer fallback URL is invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Renderer fallback URL is invalid");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.href !== `${parsed.origin}/`
  ) {
    throw new TypeError("Renderer fallback URL must be an HTTP(S) origin");
  }
  return parsed.origin;
}

function normalizeDiscoveryHost(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_DISCOVERY_HOST_CODE_UNITS ||
    value !== value.trim() ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw new TypeError("Renderer discovery host is invalid");
  }
  const normalized = value.toLowerCase();
  if (/^[0-9.]+$/.test(normalized) && isIP(normalized) !== 4) {
    throw new TypeError("Renderer discovery host is invalid");
  }
  const labels = normalized.endsWith(".")
    ? normalized.slice(0, -1).split(".")
    : normalized.split(".");
  if (
    labels.length === 0 ||
    labels.some((label) =>
      label.length === 0 ||
      label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  ) {
    throw new TypeError("Renderer discovery host is invalid");
  }
  return normalized;
}

function normalizeTargets(
  value: unknown,
  options: Readonly<{ allowEmpty: boolean }>,
): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_TARGETS) {
    throw new TypeError(
      `Renderer targets must be an array of at most ${MAX_TARGETS} IPv4 addresses`,
    );
  }
  if (!options.allowEmpty && value.length === 0) {
    throw new TypeError("Renderer static targets cannot be empty");
  }

  const unique = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    const target = descriptor && "value" in descriptor ? descriptor.value : undefined;
    if (
      typeof target !== "string" ||
      target !== target.trim() ||
      isIP(target) !== 4
    ) {
      throw new TypeError("Renderer targets must contain canonical IPv4 addresses");
    }
    unique.add(target);
  }
  return Object.freeze([...unique].sort(compareStrings));
}

function parseStaticTargets(value: string): readonly string[] {
  if (
    value.length === 0 ||
    value.length > MAX_STATIC_TARGETS_CODE_UNITS ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw new TypeError("VERYFRONT_SERVER_TARGETS is invalid");
  }
  return normalizeTargets(
    value.split(",").map((target) => target.trim()),
    { allowEmpty: false },
  );
}

function defaultResolveTargets(hostname: string): Promise<readonly string[]> {
  return resolve4(hostname);
}

function abortReason(signal: AbortSignal): Error {
  return isErrorAcrossRealms(signal.reason)
    ? signal.reason
    : new DOMException("Renderer target refresh was aborted", "AbortError");
}

export class RendererRouter {
  private readonly discoveryHost: string | null;
  private readonly fallbackUrl: string;
  private readonly refreshMs: number;
  private readonly refreshTimeoutMs: number;
  private readonly serverPort: number;
  private readonly resolveTargets: ResolveTargets;
  private readonly now: () => number;
  private readonly staticMode: boolean;
  private readonly lifecycleController = new AbortController();
  private readonly readyPromise: Promise<void>;
  private targets: readonly string[] = EMPTY_TARGETS;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private activeRefresh: Promise<readonly string[]> | null = null;
  private lastSuccessfulRefresh: number | null = null;
  private generation = 0;
  private closed = false;
  private staleLogEmitted = false;

  constructor(
    discoveryHost: string | undefined,
    fallbackUrl: string,
    options: RendererRouterOptions = {},
  ) {
    assertPlainOptions(options);
    this.fallbackUrl = normalizeFallbackUrl(fallbackUrl);
    this.refreshMs = resolveInteger(
      readOwnOption(options, "refreshMs"),
      DEFAULT_REFRESH_MS,
      "Renderer refresh interval",
      MIN_REFRESH_MS,
      MAX_REFRESH_MS,
    );
    this.refreshTimeoutMs = resolveInteger(
      readOwnOption(options, "refreshTimeoutMs"),
      DEFAULT_REFRESH_TIMEOUT_MS,
      "Renderer refresh timeout",
      1,
      MAX_REFRESH_TIMEOUT_MS,
    );
    this.serverPort = resolveInteger(
      readOwnOption(options, "serverPort"),
      DEFAULT_SERVER_PORT,
      "Renderer server port",
      1,
      65_535,
    );

    const resolver = readOwnOption(options, "resolveTargets");
    if (resolver !== undefined && typeof resolver !== "function") {
      throw new TypeError("Renderer resolveTargets option must be a function");
    }
    this.resolveTargets = (resolver as ResolveTargets | undefined) ??
      defaultResolveTargets;

    const now = readOwnOption(options, "now");
    if (now !== undefined && typeof now !== "function") {
      throw new TypeError("Renderer now option must be a function");
    }
    this.now = (now as (() => number) | undefined) ?? monotonicMilliseconds;
    this.readClock();

    const staticTargets = readOwnOption(options, "staticTargets");
    this.staticMode = staticTargets !== undefined;
    this.discoveryHost = discoveryHost === undefined || discoveryHost === ""
      ? null
      : normalizeDiscoveryHost(discoveryHost);
    if (!this.discoveryHost && !this.staticMode) {
      throw new TypeError(
        "Renderer discovery host is required when static targets are not configured",
      );
    }

    if (this.staticMode) {
      this.targets = normalizeTargets(staticTargets, { allowEmpty: false });
      this.readyPromise = Promise.resolve();
      logger.debug("[RendererRouter] Using static targets", {
        targets: this.targets.length,
      });
      return;
    }

    this.readyPromise = this.refresh();
    this.refreshTimer = setInterval(() => {
      void this.refresh();
    }, this.refreshMs);
    unrefTimer(this.refreshTimer);
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  async refresh(): Promise<void> {
    if (this.closed || this.staticMode || this.activeRefresh) return;
    const generation = this.generation;
    const request = Promise.resolve().then(() => this.resolveTargets(this.discoveryHost!));
    this.activeRefresh = request;
    const releaseRequest = (): void => {
      if (this.activeRefresh === request) this.activeRefresh = null;
    };
    void request.then(releaseRequest, releaseRequest);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let rejectForClose!: (reason: Error) => void;
    const closed = new Promise<never>((_resolve, reject) => {
      rejectForClose = reject;
    });
    const onClose = (): void => {
      rejectForClose(abortReason(this.lifecycleController.signal));
    };
    this.lifecycleController.signal.addEventListener("abort", onClose, {
      once: true,
    });
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(
          new DOMException(
            "Renderer target refresh timed out",
            "TimeoutError",
          ),
        );
      }, this.refreshTimeoutMs);
    });

    try {
      const nextTargets = normalizeTargets(
        await Promise.race([request, deadline, closed]),
        { allowEmpty: true },
      );
      if (this.closed || generation !== this.generation) return;
      const refreshedAt = this.readClock();
      this.targets = nextTargets;
      this.lastSuccessfulRefresh = refreshedAt;
      this.staleLogEmitted = false;
      logger.debug("[RendererRouter] DNS refresh", {
        host: this.discoveryHost,
        targets: this.targets.length,
      });
    } catch (error) {
      if (this.closed || generation !== this.generation) return;
      logger.debug(
        "[RendererRouter] DNS resolution failed, keeping existing targets",
        {
          host: this.discoveryHost,
          error: getErrorMessage(error),
          existingTargets: this.targets.length,
        },
      );
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      this.lifecycleController.signal.removeEventListener("abort", onClose);
    }
  }

  resolve(projectSlug: string | undefined): string {
    if (projectSlug === undefined || projectSlug === "" || this.targets.length === 0) {
      return this.fallbackUrl;
    }
    if (!isCanonicalProjectSlug(projectSlug)) {
      throw new TypeError("Renderer project slug is invalid");
    }
    if (
      !this.staticMode &&
      this.lastSuccessfulRefresh !== null &&
      this.readClock() - this.lastSuccessfulRefresh > MAX_STALENESS_MS
    ) {
      if (!this.staleLogEmitted) {
        this.staleLogEmitted = true;
        logger.debug(
          "[RendererRouter] Target list stale, falling back to default",
        );
      }
      return this.fallbackUrl;
    }
    const index = jumpHash(projectSlug, this.targets.length);
    return `http://${this.targets[index]}:${this.serverPort}`;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    this.lifecycleController.abort(
      new DOMException("Renderer router closed", "AbortError"),
    );
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  get targetCount(): number {
    return this.targets.length;
  }

  private readClock(): number {
    const value = this.now();
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new TypeError("Renderer router clock returned an invalid time");
    }
    return value;
  }
}

export function createRendererRouterFromEnvironment(
  fallbackUrl: string,
  readEnvironment: ReadEnvironment = getEnv,
): RendererRouter | null {
  if (typeof readEnvironment !== "function") {
    throw new TypeError("Renderer environment reader must be a function");
  }
  const discoveryHost = readEnvironment("VERYFRONT_SERVER_DISCOVERY_HOST");
  const staticTargetsValue = readEnvironment("VERYFRONT_SERVER_TARGETS");
  if (!discoveryHost && !staticTargetsValue) return null;

  const staticTargets = staticTargetsValue ? parseStaticTargets(staticTargetsValue) : undefined;
  return new RendererRouter(discoveryHost || undefined, fallbackUrl, {
    refreshMs: parseEnvironmentInteger(
      readEnvironment("VERYFRONT_SERVER_DISCOVERY_INTERVAL_MS"),
      DEFAULT_REFRESH_MS,
      "VERYFRONT_SERVER_DISCOVERY_INTERVAL_MS",
      MIN_REFRESH_MS,
      MAX_REFRESH_MS,
    ),
    serverPort: parseEnvironmentInteger(
      readEnvironment("VERYFRONT_SERVER_PORT"),
      DEFAULT_SERVER_PORT,
      "VERYFRONT_SERVER_PORT",
      1,
      65_535,
    ),
    staticTargets,
  });
}
