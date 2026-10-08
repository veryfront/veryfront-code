export type RegistryFailureClassification =
  | "missing-version"
  | "wrong-name"
  | "wrong-version"
  | "provenance"
  | "timeout"
  | "lookup";

export interface RegistryReleaseErrorContext {
  readonly packageName?: string;
  readonly version?: string;
  readonly safeReason?: string;
}

export class RegistryReleaseError extends Error {
  readonly packageName?: string;
  readonly version?: string;
  readonly safeReason?: string;

  constructor(
    readonly classification: RegistryFailureClassification,
    message: string,
    readonly context: RegistryReleaseErrorContext = {},
  ) {
    super(message);
    this.name = "RegistryReleaseError";
    this.packageName = context.packageName;
    this.version = context.version;
    this.safeReason = context.safeReason;
  }
}

export interface RegistryPackageMetadata {
  name?: string;
  version?: string;
  gitHead?: string;
  dist?: {
    tarball?: string;
    integrity?: string;
    attestations?: {
      provenance?: {
        predicateType?: string;
      };
    };
  };
}

export interface PollRegistryPackageOptions {
  packageName: string;
  version: string;
  expectedGitHead: string;
  registryUrl?: string;
  maxAttempts: number;
  retryDelayMs: number;
  requestTimeoutMs: number;
  requireRcTag?: boolean;
  /** Check version presence only when diagnosing a failed publish. */
  versionOnly?: boolean;
  fetcher?: typeof fetch;
  delay?: (milliseconds: number) => Promise<void>;
  onRetry?: (message: string) => void;
  /**
   * How long the poll may keep STARTING lookups. A lookup that answers slowly
   * spends its request timeout on top of the retry delay, so counting
   * attempts alone does not bound the wall clock the surrounding job is sized
   * for. The last lookup may begin at the deadline and still take its request
   * timeout, so the poll ends within `budgetMs + requestTimeoutMs`: thirty
   * minutes and a quarter by default. The job holds that PLUS the setup
   * before it and the install smoke after it, which
   * tests/integration/ci/registry-release-workflow.test.ts checks against the
   * workflow itself.
   */
  budgetMs?: number;
  /** The clock, for tests. */
  now?: () => number;
}

/**
 * How long one registry lookup may take. The poll's last lookup may begin at
 * the deadline and still spend all of this, so the job that runs it is sized
 * for the budget plus one of these.
 *
 * @internal Exported for testing only.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

const SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1";
const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";
const INSTALL_ACCEPT = "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*";

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizedRegistryUrl(registryUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(
      registryUrl.endsWith("/") ? registryUrl : `${registryUrl}/`,
    );
  } catch {
    throw new Error("Registry URL must be a valid HTTP or HTTPS URL.");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username || parsed.password || parsed.search || parsed.hash
  ) {
    throw new Error(
      "Registry URL must use HTTP or HTTPS and must not include credentials, a query, or a fragment.",
    );
  }
  return parsed;
}

function registryPackageUrl(
  registryUrl: string,
  packageName: string,
): string {
  const encodedPackageName = packageName.startsWith("@")
    ? `@${encodeURIComponent(packageName.slice(1))}`
    : encodeURIComponent(packageName);
  return new URL(
    encodedPackageName,
    normalizedRegistryUrl(registryUrl),
  ).href;
}

function registryVersionUrl(
  registryUrl: string,
  packageName: string,
  version: string,
): string {
  return `${registryPackageUrl(registryUrl, packageName)}/${encodeURIComponent(version)}`;
}

function registryErrorContext(
  options: Pick<PollRegistryPackageOptions, "packageName" | "version">,
  safeReason?: string,
): RegistryReleaseErrorContext {
  return {
    packageName: options.packageName,
    version: options.version,
    ...(safeReason ? { safeReason } : {}),
  };
}

function validateMetadata(
  metadata: RegistryPackageMetadata,
  options: PollRegistryPackageOptions,
): void {
  const spec = `${options.packageName}@${options.version}`;
  if (metadata.name !== options.packageName) {
    throw new RegistryReleaseError(
      "wrong-name",
      `${spec} returned package name ${metadata.name ?? "<missing>"}.`,
      registryErrorContext(options, "package name mismatch"),
    );
  }
  if (metadata.version !== options.version) {
    throw new RegistryReleaseError(
      "wrong-version",
      `${spec} returned version ${metadata.version ?? "<missing>"}.`,
      registryErrorContext(options, "wrong version"),
    );
  }
  if (metadata.gitHead !== options.expectedGitHead) {
    throw new RegistryReleaseError(
      "provenance",
      `${spec} has wrong gitHead ${
        metadata.gitHead ?? "<missing>"
      }; expected ${options.expectedGitHead}.`,
      registryErrorContext(options, "gitHead mismatch"),
    );
  }
  const predicateType = metadata.dist?.attestations?.provenance?.predicateType;
  if (predicateType !== SLSA_PROVENANCE_V1) {
    throw new RegistryReleaseError(
      "provenance",
      `${spec} does not expose npm SLSA provenance (${predicateType ?? "missing"}).`,
      registryErrorContext(options, "SLSA provenance missing"),
    );
  }
}

function incompleteMetadataError(
  metadata: RegistryPackageMetadata,
  options: PollRegistryPackageOptions,
): RegistryReleaseError | undefined {
  const spec = `${options.packageName}@${options.version}`;
  if (metadata.version === undefined) {
    return new RegistryReleaseError(
      "missing-version",
      `${spec} registry metadata does not include a version yet.`,
      registryErrorContext(options, "version metadata missing"),
    );
  }
  if (metadata.gitHead === undefined) {
    return new RegistryReleaseError(
      "provenance",
      `${spec} registry metadata does not include gitHead yet.`,
      registryErrorContext(options, "gitHead metadata missing"),
    );
  }
  if (metadata.dist?.attestations?.provenance?.predicateType === undefined) {
    return new RegistryReleaseError(
      "provenance",
      `${spec} does not expose npm SLSA provenance yet.`,
      registryErrorContext(options, "SLSA provenance missing"),
    );
  }
  if (
    typeof metadata.dist?.tarball !== "string" || !metadata.dist.tarball ||
    typeof metadata.dist.integrity !== "string" || !metadata.dist.integrity
  ) {
    return new RegistryReleaseError(
      "provenance",
      `${spec} distribution metadata is incomplete.`,
      registryErrorContext(options, "distribution metadata missing"),
    );
  }
  return undefined;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError");
}

type RegistryAttempt =
  | { readonly kind: "metadata"; readonly metadata: RegistryPackageMetadata }
  | {
    readonly kind: "failure";
    readonly failure: RegistryReleaseError;
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** npm installs from this package index, which can lag the version endpoint. */
async function verifyInstallIndex(
  metadata: RegistryPackageMetadata,
  options: PollRegistryPackageOptions,
  fetcher: typeof fetch,
  spec: string,
  signal: AbortSignal,
): Promise<RegistryReleaseError | undefined> {
  const missing = () =>
    new RegistryReleaseError(
      "missing-version",
      `${spec} is not available in the install index yet.`,
      registryErrorContext(options, "install index metadata missing"),
    );
  signal.throwIfAborted();
  const url = registryPackageUrl(options.registryUrl ?? DEFAULT_REGISTRY_URL, options.packageName);
  let response = await fetcher(url, { signal, headers: { accept: INSTALL_ACCEPT } });
  // Match npm's fallback when a registry does not support abbreviated metadata.
  if (response.status === 404) {
    await response.body?.cancel();
    signal.throwIfAborted();
    response = await fetcher(url, { signal, headers: { accept: "application/json" } });
  }
  if (response.status === 404) return missing();
  if (!response.ok) {
    throw new RegistryReleaseError(
      "lookup",
      `${spec} install index lookup failed.`,
      registryErrorContext(
        options,
        `install index lookup failed with HTTP ${response.status}`,
      ),
    );
  }
  const index: unknown = await response.json();
  signal.throwIfAborted();
  if (!isRecord(index) || index.name !== options.packageName) {
    throw new RegistryReleaseError(
      "wrong-name",
      `${spec} install index name does not match.`,
      registryErrorContext(options, "install index package name mismatch"),
    );
  }
  if (
    !isRecord(index.versions) || !Object.hasOwn(index.versions, options.version)
  ) return missing();
  const entry = index.versions[options.version];
  if (!isRecord(entry) || entry.version === undefined) return missing();
  if (entry.name !== options.packageName) {
    throw new RegistryReleaseError(
      "wrong-name",
      `${spec} install entry name does not match.`,
      registryErrorContext(options, "install entry package name mismatch"),
    );
  }
  if (entry.version !== options.version) {
    throw new RegistryReleaseError(
      "wrong-version",
      `${spec} install entry version does not match.`,
      registryErrorContext(options, "install entry version mismatch"),
    );
  }
  if (
    !isRecord(entry.dist) || typeof entry.dist.tarball !== "string" ||
    !entry.dist.tarball ||
    typeof entry.dist.integrity !== "string" || !entry.dist.integrity
  ) return missing();
  if (
    entry.dist.tarball !== metadata.dist?.tarball ||
    entry.dist.integrity !== metadata.dist?.integrity
  ) {
    throw new RegistryReleaseError(
      "provenance",
      `${spec} install distribution does not match.`,
      registryErrorContext(options, "install index distribution mismatch"),
    );
  }
  return undefined;
}

// Keep ordering in parity with the publisher's precision-safe rc_key comparator.
function prereleaseParts(version: string): string[] | undefined {
  const match =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)$/
      .exec(version);
  if (!match) return undefined;
  const prerelease = match[4].split(".");
  if (prerelease.some((part) => /^0[0-9]+$/.test(part))) return undefined;
  return [...match.slice(1, 4), ...prerelease];
}

function comparePrereleases(left: string[], right: string[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const a = left[index];
    const b = right[index];
    const numericA = /^[0-9]+$/.test(a);
    const numericB = /^[0-9]+$/.test(b);
    if (numericA !== numericB) return numericA ? -1 : 1;
    if (numericA && a.length !== b.length) return a.length - b.length;
    if (a !== b) return a < b ? -1 : 1;
  }
  return left.length - right.length;
}

async function verifyRcTag(
  options: PollRegistryPackageOptions,
  fetcher: typeof fetch,
  spec: string,
  signal: AbortSignal,
): Promise<RegistryReleaseError | undefined> {
  signal.throwIfAborted();
  const packageUrl = registryPackageUrl(
    options.registryUrl ?? DEFAULT_REGISTRY_URL,
    options.packageName,
  );
  const base = new URL(
    normalizedRegistryUrl(options.registryUrl ?? DEFAULT_REGISTRY_URL),
  );
  const encodedName = packageUrl.slice(base.href.length);
  const response = await fetcher(
    new URL(`-/package/${encodedName}/dist-tags`, base).href,
    {
      signal,
      headers: { "Cache-Control": "no-cache" },
    },
  );
  const missing = () =>
    new RegistryReleaseError(
      "missing-version",
      `${spec} registry RC tag has not converged yet.`,
      registryErrorContext(options, "RC tag missing or older than candidate"),
    );
  if (response.status === 404) {
    await response.body?.cancel();
    return missing();
  }
  if (!response.ok) {
    throw new RegistryReleaseError(
      "lookup",
      `${spec} registry RC tag lookup failed.`,
      registryErrorContext(
        options,
        `RC tag lookup failed with HTTP ${response.status}`,
      ),
    );
  }
  const tags: unknown = await response.json();
  signal.throwIfAborted();
  if (isRecord(tags) && tags.rc === undefined) return missing();
  const current = isRecord(tags) && typeof tags.rc === "string"
    ? prereleaseParts(tags.rc)
    : undefined;
  const candidate = prereleaseParts(options.version);
  if (!current || !candidate) {
    throw new RegistryReleaseError(
      "wrong-version",
      `${spec} registry RC tag is malformed.`,
      registryErrorContext(options, "RC tag or candidate format invalid"),
    );
  }
  return comparePrereleases(current, candidate) < 0 ? missing() : undefined;
}

/** One registry lookup. Throws terminal failures; returns retryable ones. */
async function attemptRegistryLookup(
  options: PollRegistryPackageOptions,
  fetcher: typeof fetch,
  spec: string,
): Promise<RegistryAttempt> {
  let stage = "version metadata";
  try {
    // All registry surfaces share one request deadline; retries retain the existing poll budget.
    const signal = AbortSignal.timeout(options.requestTimeoutMs);
    const response = await fetcher(
      registryVersionUrl(
        options.registryUrl ?? DEFAULT_REGISTRY_URL,
        options.packageName,
        options.version,
      ),
      { signal },
    );
    if (response.status === 404) {
      return {
        kind: "failure",
        failure: new RegistryReleaseError(
          "missing-version",
          `${spec} is not available yet.`,
          registryErrorContext(options, "version is not available yet"),
        ),
      };
    }
    if (!response.ok) {
      throw new RegistryReleaseError(
        "lookup",
        `${spec} registry lookup failed with HTTP ${response.status}.`,
        registryErrorContext(
          options,
          `registry lookup failed with HTTP ${response.status}`,
        ),
      );
    }
    const metadata = await response.json() as RegistryPackageMetadata;
    if (options.versionOnly) {
      if (metadata.name !== options.packageName || metadata.version !== options.version) {
        throw new RegistryReleaseError(
          "wrong-version",
          `${spec} returned different package metadata.`,
          registryErrorContext(options, "exact version metadata mismatch"),
        );
      }
      return { kind: "metadata", metadata };
    }
    const incomplete = incompleteMetadataError(metadata, options);
    if (incomplete) return { kind: "failure", failure: incomplete };
    validateMetadata(metadata, options);
    stage = "install index";
    const installFailure = await verifyInstallIndex(
      metadata,
      options,
      fetcher,
      spec,
      signal,
    );
    if (installFailure) return { kind: "failure", failure: installFailure };
    if (options.requireRcTag) {
      stage = "RC tag";
      const tagFailure = await verifyRcTag(options, fetcher, spec, signal);
      if (tagFailure) return { kind: "failure", failure: tagFailure };
    }
    return { kind: "metadata", metadata };
  } catch (error) {
    if (error instanceof RegistryReleaseError) throw error;
    if (!isTimeoutError(error)) {
      throw new RegistryReleaseError(
        "lookup",
        `${spec} registry lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }.`,
        registryErrorContext(options, "registry lookup failed"),
      );
    }
    return {
      kind: "failure",
      failure: new RegistryReleaseError(
        "timeout",
        `${spec} registry lookup timed out.`,
        registryErrorContext(options, `${stage} lookup timed out`),
      ),
    };
  }
}

export async function pollRegistryPackage(
  options: PollRegistryPackageOptions,
): Promise<RegistryPackageMetadata> {
  const fetcher = options.fetcher ?? fetch;
  const delay = options.delay ?? defaultDelay;
  const spec = `${options.packageName}@${options.version}`;
  let lastFailure = new RegistryReleaseError(
    "missing-version",
    `${spec} is not available yet.`,
    registryErrorContext(options, "version is not available yet"),
  );

  const now = options.now ?? Date.now;
  const budgetMs = options.budgetMs ??
    (options.maxAttempts - 1) * options.retryDelayMs;
  const deadline = now() + budgetMs;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    const result = await attemptRegistryLookup(options, fetcher, spec);
    if (result.kind === "metadata") return result.metadata;
    lastFailure = result.failure;

    // The budget is spent, so this was the last lookup. A caller that sets no
    // delay (the unit tests) states its bound in attempts alone.
    const remainingMs = deadline - now();
    if (budgetMs > 0 && remainingMs <= 0) break;

    if (attempt < options.maxAttempts) {
      options.onRetry?.(
        `Waiting for ${spec} registry propagation (attempt ${attempt}/${options.maxAttempts}): ${lastFailure.safeReason}.`,
      );
      // The last wait is shortened to what is left, so a lookup still begins
      // at the deadline however long each one takes.
      await delay(
        budgetMs > 0 ? Math.min(options.retryDelayMs, remainingMs) : options.retryDelayMs,
      );
    }
  }

  if (lastFailure.classification === "timeout") {
    throw new RegistryReleaseError(
      "timeout",
      `${spec} registry lookup timed out after ${options.maxAttempts} attempts.`,
      lastFailure.context,
    );
  }
  throw new RegistryReleaseError(
    lastFailure.classification,
    `${lastFailure.message} Still incomplete after ${options.maxAttempts} propagation attempts.`,
    lastFailure.context,
  );
}

interface CliOptions {
  version: string;
  gitHead: string;
  registryUrl: string;
  packages: string[];
  requireRcTag: boolean;
  diagnostic: boolean;
}

function readCliOptions(args: string[]): CliOptions {
  let version = "";
  let gitHead = "";
  let registryUrl = DEFAULT_REGISTRY_URL;
  const packages: string[] = [];
  let requireRcTag = false;
  let diagnostic = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--diagnostic") diagnostic = true;
    else if (argument === "--require-rc-tag") requireRcTag = true;
    else if (argument === "--version") version = args[++index] ?? "";
    else if (argument === "--git-head") gitHead = args[++index] ?? "";
    else if (argument === "--registry-url") registryUrl = args[++index] ?? "";
    else if (argument === "--package") packages.push(args[++index] ?? "");
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (
    !version || !gitHead || packages.length === 0 ||
    packages.some((name) => !name)
  ) {
    throw new Error(
      "Usage: registry-release-integrity.ts --version <VERSION> --git-head <SHA> [--registry-url <URL>] [--require-rc-tag] [--diagnostic] --package <NAME> [--package <NAME> ...]",
    );
  }
  normalizedRegistryUrl(registryUrl);
  return { version, gitHead, registryUrl, packages, requireRcTag, diagnostic };
}

function sanitizeFailureContextPart(value: string): string {
  return value.replace(/[^A-Za-z0-9@./_+-]/g, "?").slice(0, 128);
}

function formatFailureContext(
  context: RegistryReleaseErrorContext,
): string {
  if (!context.packageName || !context.version) return "";
  return ` for ${sanitizeFailureContextPart(context.packageName)}@${
    sanitizeFailureContextPart(context.version)
  }`;
}

/**
 * How long to wait for npm to make a just-published version visible.
 *
 * A publish is not atomic across npm's metadata. `npm publish` returns as soon
 * as the tarball is accepted and says so itself -- "Your package is being
 * processed and may take a few minutes to become available" -- and nothing
 * calls back when it is. Polling is the only signal there is, so the budget
 * has to cover npm's slowest processing rather than its typical one.
 *
 * The record on main: a 30x10s budget gave up three times, fifteen minutes
 * gave up once more on 2026-09-21 (rc.19779 returned from `npm publish` at
 * 01:43:10Z and the registry recorded it at 02:03:27Z, twenty minutes later,
 * while the poll stopped at 02:01:49Z). Thirty minutes covers that with
 * headroom; CI can narrow it (the smoke tests do) through the environment.
 *
 * @internal Exported for testing only.
 */
export function readPropagationBudget(
  env: Readonly<Record<string, string | undefined>>,
): { maxAttempts: number; retryDelayMs: number } {
  const positiveInteger = (value: string | undefined, fallback: number) => {
    if (value === undefined || !/^\d+$/.test(value)) return fallback;
    const parsed = Number(value);
    // A digit-only value can still be unusable: `Infinity` never exhausts the
    // loop, and an unsafe integer stops the attempt counter advancing.
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    // The poll waits BETWEEN attempts, so 181 attempts spend 180 delays: the
    // thirty minutes this budget promises.
    maxAttempts: positiveInteger(env.VF_REGISTRY_PROPAGATION_ATTEMPTS, 181),
    retryDelayMs: positiveInteger(env.VF_REGISTRY_PROPAGATION_DELAY_MS, 10_000),
  };
}

/** Verify each package independently so propagation waits overlap. */
export async function pollRegistryPackages(
  packages: readonly PollRegistryPackageOptions[],
): Promise<void> {
  await Promise.all(packages.map(pollRegistryPackage));
}

/** Diagnose partial publication without spending the successful publish budget. */
export async function diagnoseRegistryPackages(
  packages: readonly PollRegistryPackageOptions[],
  report: (line: string) => void = console.log,
): Promise<never> {
  const results = await Promise.allSettled(packages.map((options) =>
    pollRegistryPackage({
      ...options,
      versionOnly: true,
      maxAttempts: 2,
      retryDelayMs: 120_000,
      budgetMs: 120_000,
    })
  ));
  results.forEach((result, index) => {
    const options = packages[index]!;
    const status = result.status === "fulfilled"
      ? "published"
      : result.reason instanceof RegistryReleaseError
      ? result.reason.classification
      : "lookup";
    report(`${options.packageName}@${options.version}: ${status}`);
  });
  throw new RegistryReleaseError(
    "lookup",
    "Publish did not succeed; registry diagnostics cannot authorize a release.",
  );
}

async function main(args: string[]): Promise<void> {
  const options = readCliOptions(args);
  // Read individually: enumerating the environment needs unrestricted access,
  // and the smoke script grants only these two variables.
  const budget = readPropagationBudget({
    VF_REGISTRY_PROPAGATION_ATTEMPTS: Deno.env.get(
      "VF_REGISTRY_PROPAGATION_ATTEMPTS",
    ),
    VF_REGISTRY_PROPAGATION_DELAY_MS: Deno.env.get(
      "VF_REGISTRY_PROPAGATION_DELAY_MS",
    ),
  });
  const packages = options.packages.map((packageName) => ({
    packageName,
    version: options.version,
    expectedGitHead: options.gitHead,
    requireRcTag: options.requireRcTag,
    registryUrl: options.registryUrl,
    ...budget,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    onRetry: console.log,
  }));
  if (options.diagnostic) await diagnoseRegistryPackages(packages);
  await pollRegistryPackages(packages);
  console.log(
    `Registry release integrity: ${options.packages.length} exact package versions verified.`,
  );
}

export function formatRegistryReleaseFailure(error: unknown): string {
  if (error instanceof RegistryReleaseError) {
    switch (error.classification) {
      case "missing-version":
      case "wrong-name":
      case "wrong-version":
      case "provenance":
      case "timeout":
      case "lookup": {
        const reasonSuffix = error.safeReason ? `: ${error.safeReason}` : "";
        return `REGISTRY RELEASE FAIL [${error.classification}]${
          formatFailureContext(error.context)
        }${reasonSuffix}.`;
      }
    }
  }
  return "REGISTRY RELEASE FAIL [configuration].";
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    console.error(formatRegistryReleaseFailure(error));
    Deno.exit(1);
  }
}
