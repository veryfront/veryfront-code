import {
  canIdentifyProxyWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import type { WorkerGenerationIdentity } from "#veryfront/security/sandbox/worker-generation.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { isWellFormedString } from "#veryfront/utils/is-well-formed-string.ts";

/** Host-owned immutable input identities, never credentials or mutable branch aliases. */
export interface RenderGenerationBinding {
  readonly projectId: string;
  readonly environmentId: string;
  /** Covers the complete source view, including routes and client assets. */
  readonly sourceSnapshotId: string;
  /** Covers resolved configuration and environment values without exposing them. */
  readonly configurationId: string;
  readonly dependencySnapshotId: string;
  /** Content identity of the prepared graph, never its replica-local directory. */
  readonly artifactId: string;
  /** Exact framework build, including its release identity. */
  readonly frameworkId: string;
  /** Exact runtime build and native package/asset bindings. */
  readonly runtimeId: string;
  /** Filesystem, network, resource and process-lifetime policy revision. */
  readonly executionPolicyId: string;
}

const freeze = Object.freeze;
const ownKeys = Reflect.ownKeys;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const fields = freeze(
  [
    "projectId",
    "environmentId",
    "sourceSnapshotId",
    "configurationId",
    "dependencySnapshotId",
    "artifactId",
    "frameworkId",
    "runtimeId",
    "executionPolicyId",
  ] as const,
);

/**
 * Derive the existing render pool identity from a complete host binding.
 * Every field must be an own data property containing 1 to 1024 well-formed
 * UTF-16 code units. All fields are captured before asynchronous hashing.
 * Field order, framing and hash domains are versioned and replica-independent.
 *
 * The trusted caller must first authorize the project/environment and capture
 * the actual immutable inputs named here. This checks their identity shape,
 * not their contents, permissions, or isolation. It issues no execution grant.
 * Standalone hosts use their own project/environment identities; no Cloud
 * service, shared local path, process ID, or request data enters these keys.
 */
export async function resolveRenderGenerationIdentity(
  binding: RenderGenerationBinding,
): Promise<Readonly<WorkerGenerationIdentity>> {
  if (
    !canIdentifyProxyWithoutHooks || binding === null || typeof binding !== "object" ||
    isProxyWithoutHooks(binding) || ownKeys(binding).length !== fields.length
  ) throw new TypeError("Render generation binding requires exactly its non-proxy data fields");

  let scope = "veryfront-render-scope:v1:";
  let generation = "veryfront-render-generation:v1:";
  for (let index = 0; index < fields.length; index++) {
    const descriptor = getOwnPropertyDescriptor(binding, fields[index]!);
    if (!descriptor || !hasOwn(descriptor, "value")) {
      throw new TypeError("Render generation binding fields must be own data properties");
    }
    const value: unknown = descriptor.value;
    if (
      typeof value !== "string" || value.length < 1 || value.length > 1024 ||
      !isWellFormedString(value)
    ) throw new TypeError("Render generation binding fields must be bounded non-empty text");
    const framed = `${value.length}:${value}`;
    if (index < 2) scope += framed;
    generation += framed;
  }
  return freeze({ scopeId: await computeHash(scope), generationId: await computeHash(generation) });
}
