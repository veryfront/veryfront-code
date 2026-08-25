export type RegistryFailureClassification =
  | "missing-version"
  | "provenance"
  | "timeout"
  | "lookup";

export class RegistryReleaseError extends Error {
  constructor(
    readonly classification: RegistryFailureClassification,
    message: string,
  ) {
    super(message);
    this.name = "RegistryReleaseError";
  }
}

export interface RegistryPackageMetadata {
  name?: string;
  version?: string;
  gitHead?: string;
  dist?: {
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
  fetcher?: typeof fetch;
  delay?: (milliseconds: number) => Promise<void>;
  onRetry?: (message: string) => void;
}

const SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1";
const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";

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

function registryVersionUrl(
  registryUrl: string,
  packageName: string,
  version: string,
): string {
  return new URL(
    `${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
    normalizedRegistryUrl(registryUrl),
  ).href;
}

function validateMetadata(
  metadata: RegistryPackageMetadata,
  options: PollRegistryPackageOptions,
): void {
  const spec = `${options.packageName}@${options.version}`;
  if (metadata.version !== options.version) {
    throw new RegistryReleaseError(
      "missing-version",
      `${spec} returned version ${metadata.version ?? "<missing>"}.`,
    );
  }
  if (metadata.gitHead !== options.expectedGitHead) {
    throw new RegistryReleaseError(
      "provenance",
      `${spec} has wrong gitHead ${
        metadata.gitHead ?? "<missing>"
      }; expected ${options.expectedGitHead}.`,
    );
  }
  const predicateType = metadata.dist?.attestations?.provenance?.predicateType;
  if (predicateType !== SLSA_PROVENANCE_V1) {
    throw new RegistryReleaseError(
      "provenance",
      `${spec} does not expose npm SLSA provenance (${
        predicateType ?? "missing"
      }).`,
    );
  }
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError");
}

export async function pollRegistryPackage(
  options: PollRegistryPackageOptions,
): Promise<RegistryPackageMetadata> {
  const fetcher = options.fetcher ?? fetch;
  const delay = options.delay ?? defaultDelay;
  const spec = `${options.packageName}@${options.version}`;
  let lastFailure: "missing-version" | "timeout" = "missing-version";

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      const response = await fetcher(
        registryVersionUrl(
          options.registryUrl ?? DEFAULT_REGISTRY_URL,
          options.packageName,
          options.version,
        ),
        { signal: AbortSignal.timeout(options.requestTimeoutMs) },
      );
      if (response.status === 404) {
        lastFailure = "missing-version";
      } else if (!response.ok) {
        throw new RegistryReleaseError(
          "lookup",
          `${spec} registry lookup failed with HTTP ${response.status}.`,
        );
      } else {
        const metadata = await response.json() as RegistryPackageMetadata;
        validateMetadata(metadata, options);
        return metadata;
      }
    } catch (error) {
      if (error instanceof RegistryReleaseError) throw error;
      if (!isTimeoutError(error)) {
        throw new RegistryReleaseError(
          "lookup",
          `${spec} registry lookup failed: ${
            error instanceof Error ? error.message : String(error)
          }.`,
        );
      }
      lastFailure = "timeout";
    }

    if (attempt < options.maxAttempts) {
      options.onRetry?.(
        `Waiting for ${spec} registry propagation (attempt ${attempt}/${options.maxAttempts}).`,
      );
      await delay(options.retryDelayMs);
    }
  }

  if (lastFailure === "timeout") {
    throw new RegistryReleaseError(
      "timeout",
      `${spec} registry lookup timed out after ${options.maxAttempts} attempts.`,
    );
  }
  throw new RegistryReleaseError(
    "missing-version",
    `${spec} is still missing after ${options.maxAttempts} propagation attempts.`,
  );
}

interface CliOptions {
  version: string;
  gitHead: string;
  registryUrl: string;
  packages: string[];
}

function readCliOptions(args: string[]): CliOptions {
  let version = "";
  let gitHead = "";
  let registryUrl = DEFAULT_REGISTRY_URL;
  const packages: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--version") version = args[++index] ?? "";
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
      "Usage: registry-release-integrity.ts --version <VERSION> --git-head <SHA> [--registry-url <URL>] --package <NAME> [--package <NAME> ...]",
    );
  }
  normalizedRegistryUrl(registryUrl);
  return { version, gitHead, registryUrl, packages };
}

async function main(args: string[]): Promise<void> {
  const options = readCliOptions(args);
  await Promise.all(options.packages.map((packageName) =>
    pollRegistryPackage({
      packageName,
      version: options.version,
      expectedGitHead: options.gitHead,
      registryUrl: options.registryUrl,
      maxAttempts: 30,
      retryDelayMs: 10_000,
      requestTimeoutMs: 15_000,
      onRetry: console.log,
    })
  ));
  console.log(
    `Registry release integrity: ${options.packages.length} exact package versions verified.`,
  );
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    if (error instanceof RegistryReleaseError) {
      console.error(
        `REGISTRY RELEASE FAIL [${error.classification}]: ${error.message}`,
      );
    } else {
      console.error(
        `REGISTRY RELEASE FAIL [configuration]: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    Deno.exit(1);
  }
}
