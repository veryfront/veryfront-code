import { PERMISSION_DENIED, PROJECT_EXECUTION_UNAVAILABLE } from "#veryfront/errors";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { createVeryfrontApiTransport } from "#veryfront/platform/adapters/veryfront-api-transport.ts";
import { getHostedExecutorImageSchema } from "#veryfront/agent/hosted/executor-session-schema.ts";
import type { RenderGenerationBinding } from "#veryfront/rendering/render-generation-binding.ts";
import { fetchProjectEnvVars } from "../project-env/fetcher.ts";
import { ProjectEnvironmentIdentityResolver } from "../project-env/production-environment-resolver.ts";
import { filterSharedRuntimeProjectEnv } from "../project-env/reserved-env.ts";
import { resolveProjectTraceConfig } from "../project-env/telemetry-config.ts";
import type { HostedHttpInput } from "./hosted-http-broker.ts";
import type {
  HostedHttpIngressOptions,
  HostedHttpRequestAuthority,
} from "./hosted-http-ingress.ts";

const PROJECT_LOOKUP_TIMEOUT_MS = 5_000;
const PROJECT_RESPONSE_MAX_BYTES = 64 * 1024;
const MAX_SOURCE_TOKEN_CHARS = 8192;
const MAX_SOURCE_RECORDS = 4096;
const DEFAULT_PREPARE_TIMEOUT_MS = 60_000;
const DEFAULT_HARD_TIMEOUT_MS = 5 * 60_000;
// The isolated application has no host config evaluator, so the authorized
// project environment alone decides whether its own trace exporter is enabled.
const PROJECT_TRACE_EXTENSIONS = Object.freeze([
  Object.freeze({ name: "ext-observability-opentelemetry" }),
]);
const freeze = Object.freeze;

/** Token-free output of the tenant-source explicit-reference lookup. */
const getSourceRecordSchema = defineSchema((v) =>
  v.object({
    schema_version: v.literal(1),
    status: v.literal("resolved"),
    api_origin: v.string().min(1).max(2048),
    project_id: v.string().uuid(),
    release_id: v.string().uuid(),
    manifest_hash: v.string().regex(/^[a-f0-9]{64}$/),
    image: getHostedExecutorImageSchema(),
  }).passthrough()
);

const getProjectIdentitySchema = defineSchema((v) =>
  v.object({ id: v.string().min(1).max(256), slug: v.string().min(1).max(256) }).passthrough()
);

export interface HostedHttpResolverOptions {
  /** Host-owned Veryfront API base URL used with the request's source token. */
  apiBaseUrl: string;
  /** Source API origin that each publication record must name. */
  sourceApiOrigin: string;
  /** Private repository that holds tenant-source images, without tag or digest. */
  sourceImageRepository: string;
  /**
   * Service account that the edge's project-bound source credentials name as `userId`.
   * Each request's credential must name this account and the exact requested project.
   */
  serviceAccountId: string;
  /**
   * Host-owned explicit-reference lookup for one exact project release. Returns the
   * lookup's token-free record. Records are data; this resolver binds them to the
   * authorized identity and never accepts another project's or release's image.
   */
  lookupSourceImage(
    request: { projectId: string; releaseId: string },
    signal: AbortSignal,
  ): Promise<unknown>;
  /** Host-owned allocator, transport and broker identity. */
  session: Pick<
    HostedHttpInput["session"],
    | "expectedBrokerInstanceId"
    | "allocator"
    | "connectTransport"
    | "ownerSignal"
    | "pollIntervalMs"
    | "requestTimeoutMs"
    | "cleanupTimeoutMs"
  >;
  /** Default 60 seconds, maximum 10 minutes. */
  prepareTimeoutMs?: number;
  /** Default 5 minutes, maximum 1 hour, and not shorter than preparation. */
  hardTimeoutMs?: number;
  /** @internal Replaces the Veryfront API reads in hermetic tests. */
  api?: HostedHttpResolverApi;
}

/** Veryfront API reads, each authenticated with the request's source token. */
export interface HostedHttpResolverApi {
  /** Read the project addressed by its exact ID. */
  readProject(authority: HostedHttpRequestAuthority, signal: AbortSignal): Promise<unknown>;
  /** Reject unless the named environment has the expected ID and active release. */
  authorizeEnvironment(
    authority: HostedHttpRequestAuthority,
    signal: AbortSignal,
  ): Promise<unknown>;
  /** Read the variables of the authorized environment. */
  readEnvironment(
    authority: HostedHttpRequestAuthority,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, string>>>;
}

function createVeryfrontApi(apiBaseUrl: string): HostedHttpResolverApi {
  const environments = new ProjectEnvironmentIdentityResolver();
  return {
    readProject(authority, signal) {
      const transport = createVeryfrontApiTransport<unknown>({
        baseUrl: apiBaseUrl,
        getToken: () => authority.sourceToken,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        timeoutMs: PROJECT_LOOKUP_TIMEOUT_MS,
        wrapFinalError: (error) => error,
      });
      return transport.request(`/projects/${encodeURIComponent(authority.projectId)}`, {
        headers: { Accept: "application/json" },
        maxResponseBytes: PROJECT_RESPONSE_MAX_BYTES,
        redirect: "error",
        includeErrorBodyInDiagnostics: false,
        signal,
      });
    },
    authorizeEnvironment(authority, signal) {
      return environments.resolveNamedForActiveRelease({
        apiBaseUrl,
        // The exact project ID addresses the environments, not a mutable slug.
        projectSlug: authority.projectId,
        projectId: authority.projectId,
        token: authority.sourceToken,
        environmentName: authority.environmentName,
        expectedEnvironmentId: authority.environmentId,
        expectedReleaseId: authority.releaseId,
      }, signal);
    },
    readEnvironment(authority, signal) {
      // The exact project ID addresses every read, so all of them target one project.
      return fetchProjectEnvVars(
        apiBaseUrl,
        authority.projectId,
        authority.environmentId,
        authority.sourceToken,
        signal,
      );
    },
  };
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}

function httpsOrigin(value: unknown, name: string, allowPath: boolean): string {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new TypeError(`Hosted HTTP resolver requires an HTTPS ${name}`);
  }
  if (
    typeof value !== "string" || url.protocol !== "https:" || url.username || url.password ||
    url.search || url.hash || (!allowPath && url.pathname !== "/")
  ) throw new TypeError(`Hosted HTTP resolver requires an HTTPS ${name}`);
  return allowPath ? trimTrailingSlashes(value) : url.origin;
}

/**
 * Accept only a project-bound service credential for exactly `projectId`. This reads
 * the JWT payload without verifying the signature; the API verifies every credential.
 * Opaque credentials, user sessions and credentials without a project are refused
 * here, before any API call.
 */
function isProjectBoundServiceCredential(
  token: string,
  projectId: string,
  serviceAccountId: string,
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return false;
  let claims: unknown;
  try {
    const base64 = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), "="));
    claims = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      ),
    );
  } catch {
    return false;
  }
  if (claims === null || typeof claims !== "object" || Array.isArray(claims)) return false;
  const { projectId: claimedProject, userId, scope } = claims as Record<string, unknown>;
  const scopes = typeof scope === "string" ? scope.split(" ") : scope;
  return typeof claimedProject === "string" && claimedProject === projectId &&
    typeof userId === "string" && userId === serviceAccountId &&
    Array.isArray(scopes) &&
    scopes.every((entry) => typeof entry === "string" && !entry.startsWith("user_read_id_"));
}

function limit(value: number | undefined, fallback: number, maximum: number, name: string) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1_000 || result > maximum) {
    throw new TypeError(`Hosted HTTP resolver requires a bounded ${name}`);
  }
  return result;
}

function refuse(detail: string): Error {
  return PERMISSION_DENIED.create({ detail });
}

/** Key-sorted JSON, so equal records compare equal regardless of key order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Serve publication records produced by the tenant-source lookup from a host-owned snapshot.
 * Records are indexed by exact project and release; differing records for one release are
 * refused. The resolver binds `image` to the authorized project release, and the executor
 * session refuses an allocation whose running image differs from that digest.
 */
export function createHostedHttpSourceRecordLookup(
  records: readonly unknown[],
): HostedHttpResolverOptions["lookupSourceImage"] {
  if (!Array.isArray(records) || records.length > MAX_SOURCE_RECORDS) {
    throw new TypeError("Hosted HTTP source records must be a bounded list");
  }
  const index = new Map<string, { record: Readonly<Record<string, unknown>>; text: string }>();
  for (const value of records) {
    const snapshot = snapshotBoundedJsonValue(value);
    const parsed = snapshot.success
      ? getSourceRecordSchema().safeParse(snapshot.value)
      : { success: false as const };
    if (!parsed.success) throw new TypeError("Hosted HTTP source record is invalid");
    const key = `${parsed.data.project_id}/${parsed.data.release_id}`;
    const text = canonicalJson(parsed.data);
    const existing = index.get(key);
    if (existing && existing.text !== text) {
      throw new TypeError("Hosted HTTP source records conflict for one release");
    }
    index.set(key, { record: freeze({ ...parsed.data }), text });
  }
  return ({ projectId, releaseId }, signal) => {
    signal.throwIfAborted();
    const found = index.get(`${projectId}/${releaseId}`)?.record;
    if (!found) {
      return Promise.reject(
        PROJECT_EXECUTION_UNAVAILABLE.create({ detail: "No published source for this release" }),
      );
    }
    return Promise.resolve(found);
  };
}

/** Covers every field emitted into the application configuration. */
async function deriveConfigurationId(
  key: Promise<CryptoKey>,
  identity: {
    projectId: string;
    projectSlug: string;
    releaseId: string;
    environmentId: string;
    environmentName: string;
  },
  variables: Readonly<Record<string, string>>,
): Promise<string> {
  const frame = (value: string) => `${value.length}:${value}`;
  let canonical = "veryfront-hosted-http-configuration:v2:" + frame(identity.projectId) +
    frame(identity.projectSlug) + frame(identity.releaseId) + frame(identity.environmentId) +
    frame(identity.environmentName);
  for (const name of Object.keys(variables).sort((a, b) => a.localeCompare(b))) {
    canonical += frame(name) + frame(variables[name]!);
  }
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", await key, new TextEncoder().encode(canonical)),
  );
  return `config-${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Build the hosted HTTP `resolve()` callback. Each call authorizes the project, its
 * slug, the named environment and its active release with the request's source token,
 * binds the published tenant-source image to that exact project release, and then
 * reads the authorized project environment. Any mismatch rejects; the ingress turns
 * rejection into a non-cacheable unavailable response with no host execution.
 */
export function createHostedHttpResolver(
  options: HostedHttpResolverOptions,
): HostedHttpIngressOptions["resolve"] {
  const apiBaseUrl = httpsOrigin(options.apiBaseUrl, "API base URL", true);
  const sourceApiOrigin = httpsOrigin(options.sourceApiOrigin, "source API origin", false);
  const repository = options.sourceImageRepository;
  if (typeof repository !== "string" || !/^[a-z0-9][a-z0-9._/-]{0,255}$/.test(repository)) {
    throw new TypeError("Hosted HTTP resolver requires a source image repository");
  }
  const serviceAccountId = options.serviceAccountId;
  if (typeof serviceAccountId !== "string" || !serviceAccountId.trim()) {
    throw new TypeError("Hosted HTTP resolver requires the source service account ID");
  }
  if (typeof options.lookupSourceImage !== "function") {
    throw new TypeError("Hosted HTTP resolver requires a source image lookup");
  }
  const session = { ...options.session };
  if (
    typeof session.expectedBrokerInstanceId !== "string" || !session.expectedBrokerInstanceId ||
    typeof session.connectTransport !== "function" || typeof session.allocator !== "object"
  ) throw new TypeError("Hosted HTTP resolver requires a host executor session");
  const prepareMs = limit(
    options.prepareTimeoutMs,
    DEFAULT_PREPARE_TIMEOUT_MS,
    600_000,
    "preparation",
  );
  const hardMs = limit(options.hardTimeoutMs, DEFAULT_HARD_TIMEOUT_MS, 3_600_000, "lifetime");
  if (hardMs < prepareMs) throw new TypeError("Hosted HTTP resolver requires a bounded lifetime");
  const lookup = options.lookupSourceImage.bind(options);
  const api = options.api ?? createVeryfrontApi(apiBaseUrl);
  // Process-local key: configuration identities never reveal variable values.
  let configurationKey: Promise<CryptoKey> | undefined;

  async function authorizeProject(authority: HostedHttpRequestAuthority, signal: AbortSignal) {
    const body = await api.readProject(authority, signal);
    const project = getProjectIdentitySchema().safeParse(body);
    if (
      !project.success || project.data.id !== authority.projectId ||
      project.data.slug !== authority.projectSlug
    ) throw refuse("Project identity does not match the authorized project");
  }

  async function resolvePublishedImage(authority: HostedHttpRequestAuthority, signal: AbortSignal) {
    const value = await lookup(
      { projectId: authority.projectId, releaseId: authority.releaseId },
      signal,
    );
    const snapshot = snapshotBoundedJsonValue(value);
    const parsed = snapshot.success
      ? getSourceRecordSchema().safeParse(snapshot.value)
      : { success: false as const };
    if (
      !parsed.success || parsed.data.project_id !== authority.projectId ||
      parsed.data.release_id !== authority.releaseId ||
      trimTrailingSlashes(parsed.data.api_origin) !== sourceApiOrigin ||
      !parsed.data.image.startsWith(`${repository}@sha256:`)
    ) throw refuse("Published source does not match the authorized project release");
    return parsed.data.image;
  }

  return async (authority, signal) => {
    signal.throwIfAborted();
    const token = authority.sourceToken;
    if (typeof token !== "string" || !token || token.length > MAX_SOURCE_TOKEN_CHARS) {
      throw refuse("A source credential is required");
    }
    if (!isProjectBoundServiceCredential(token, authority.projectId, serviceAccountId)) {
      throw refuse("The source credential is not bound to the requested project");
    }
    const identity = freeze({
      projectId: authority.projectId,
      projectSlug: authority.projectSlug,
      releaseId: authority.releaseId,
      environmentId: authority.environmentId,
      environmentName: authority.environmentName,
    });
    // Authorize identity and resolve the image before any secret-bearing read.
    // The first refusal cancels the other checks, which settle before it is reported.
    const checks = new AbortController();
    const checkSignal = AbortSignal.any([signal, checks.signal]);
    const pending = [
      authorizeProject(authority, checkSignal),
      api.authorizeEnvironment(authority, checkSignal),
      resolvePublishedImage(authority, checkSignal),
    ] as const;
    let image: string;
    try {
      [, , image] = await Promise.all(pending);
    } catch (error) {
      checks.abort();
      await Promise.allSettled(pending);
      throw error;
    }
    signal.throwIfAborted();
    const environment = await api.readEnvironment(authority, signal);
    signal.throwIfAborted();
    const projectTracing = await resolveProjectTraceConfig(
      { projectId: identity.projectId, environmentId: identity.environmentId },
      PROJECT_TRACE_EXTENSIONS,
      environment,
    );
    const variables = filterSharedRuntimeProjectEnv({ ...environment });
    configurationKey ??= crypto.subtle.generateKey(
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ) as Promise<CryptoKey>;
    const configurationId = await deriveConfigurationId(configurationKey, identity, variables);
    signal.throwIfAborted();

    const owner = { scopeKind: "project" as const, projectId: identity.projectId };
    const source = { type: "release" as const, releaseId: identity.releaseId };
    const now = Date.now();
    return {
      session: {
        ...session,
        expectedImage: image,
        request: {
          allocationId: crypto.randomUUID(),
          invocationId: crypto.randomUUID(),
          owner,
          source,
          executionProfile: "http" as const,
          requestedAt: now,
          prepareDeadlineAt: now + prepareMs,
          hardDeadlineAt: now + hardMs,
        },
      },
      installation: {
        version: 1 as const,
        mode: "http" as const,
        owner,
        source,
        root: "project" as const,
        environmentId: identity.environmentId,
        configurationId,
      },
      configuration: { ...identity, configurationId, variables },
      projectTracing,
    };
  };
}

/** Immutable generation identity inputs known after authorization, for generation-bound executors. */
export type HostedHttpGenerationBindingInput = Readonly<
  Pick<
    RenderGenerationBinding,
    "projectId" | "environmentId" | "sourceSnapshotId" | "configurationId"
  >
>;

/**
 * Derive the authorized parts of a render generation binding from one resolved input.
 * The digest-pinned tenant-source image is the source snapshot identity. Framework,
 * runtime, dependency, artifact and execution-policy identities come from the image
 * receipt and operator policy, which this resolver does not observe.
 */
export function buildHostedHttpGenerationBindingInput(
  input: Pick<HostedHttpInput, "session" | "installation">,
): HostedHttpGenerationBindingInput {
  const owner = input.installation.owner;
  const allocationOwner = input.session.request.owner;
  if (
    owner.scopeKind !== "project" || allocationOwner.scopeKind !== "project" ||
    owner.projectId !== allocationOwner.projectId ||
    !getHostedExecutorImageSchema().safeParse(input.session.expectedImage).success
  ) throw new TypeError("Hosted HTTP generation binding requires one project-owned image");
  return freeze({
    projectId: owner.projectId,
    environmentId: input.installation.environmentId,
    sourceSnapshotId: input.session.expectedImage,
    configurationId: input.installation.configurationId,
  });
}
