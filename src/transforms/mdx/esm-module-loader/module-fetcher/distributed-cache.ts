/****
 * Distributed transform cache read/write operations.
 *
 * MDX primary transforms and recovery payloads use the provider-neutral
 * revision capability. HTTP manifest IDs authenticate canonical bundle-hash
 * graphs; their metadata remains refreshable in the HTTP-cache namespace.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/distributed-cache
 */

import type { Logger } from "#veryfront/utils";
import { detokenizeAllCachePaths, tokenizeAllVeryFrontPaths } from "#veryfront/cache/paths.ts";
import {
  buildRevisionedCacheKey,
  type CacheRevisionSnapshot,
  requireCacheExchangeResult,
  type RevisionedCacheBackend,
  snapshotCacheRevisionResult,
} from "#veryfront/cache/backend.ts";
import { extractHttpBundlePaths } from "#veryfront/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts";
import { computeManifestId, validateBundleGroup } from "../../../esm/bundle-manifest.ts";
import {
  type AcknowledgedBundleManifestAuthority,
  ensureHttpBundlesExist,
  inspectAcknowledgedBundleManifestAuthority,
} from "../../../esm/http-cache.ts";
import {
  isValidHttpBundleHash,
  MAX_HTTP_BUNDLE_GRAPH_ENTRIES,
} from "../../../esm/http-bundle-file.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { getDistributedTransformBackend } from "#veryfront/transforms/esm/transform-cache.ts";
import { TRANSFORM_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { hasUnresolvedImports } from "./nested-imports.ts";
import {
  findMissingFileDependenciesInCode,
  hasIncompatibleFrameworkPaths,
} from "./framework-validator.ts";
import { ensureMdxModuleDependencies } from "./dependency-recovery.ts";
import {
  buildMdxEsmModuleRecoveryCacheKey,
  MDX_DISTRIBUTED_TRANSFORM_ENVELOPE_VERSION,
} from "../cache-format.ts";
import {
  createMdxModuleRecoveryPayload,
  MAX_MDX_MODULE_CODE_BYTES,
  serializeMdxModuleRecoveryPayload,
  utf8ByteLength,
} from "./recovery-payload.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { classifyThrownValue } from "./error-classification.ts";

const TRANSFORM_CACHE_TTL_SECONDS = TRANSFORM_DISTRIBUTED_TTL_SEC;
const DISTRIBUTED_TRANSFORM_CACHE_PREFIX = "transform";
const API_CACHE_KEY_MAX_LENGTH = 512;
const API_CACHE_KEY_PATTERN = /^[a-zA-Z0-9_:.\-/]+$/;
const SHA256_CACHE_KEY_PREFIX = "sha256:";
const MAX_MDX_DISTRIBUTED_TRANSFORM_ENTRY_BYTES = MAX_MDX_MODULE_CODE_BYTES + 64 * 1024;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const MDX_DISTRIBUTED_TRANSFORM_ENTRY_KEYS = new Set([
  "formatVersion",
  "code",
  "codeHash",
  "bundleManifestId",
  "envelopeHash",
]);
const MDX_DISTRIBUTED_TRANSFORM_HASH_DOMAIN = "veryfront:mdx-distributed-transform:v2";
const BUNDLE_MANIFEST_AUTHORITY_KEYS = new Set(["manifestId", "bundleHashes"]);

interface MdxDistributedTransformEnvelope {
  formatVersion: typeof MDX_DISTRIBUTED_TRANSFORM_ENVELOPE_VERSION;
  code: string;
  codeHash: string;
  bundleManifestId: string | null;
  envelopeHash: string;
}

interface MdxPrimaryPublicationPermitState {
  readonly backend: RevisionedCacheBackend;
  readonly reservedKey: string;
  readonly revision: string;
  readonly expiresAtMs: number;
  used: boolean;
}

const mdxPrimaryPublicationPermitBrand: unique symbol = Symbol(
  "MdxPrimaryPublicationPermit",
);

/** Opaque single-use condition for publishing one observed MDX primary. */
export interface MdxPrimaryPublicationPermit {
  readonly [mdxPrimaryPublicationPermitBrand]: true;
}

const mdxPrimaryPublicationPermitStates = new WeakMap<
  MdxPrimaryPublicationPermit,
  MdxPrimaryPublicationPermitState
>();

export interface DistributedCacheReadResult {
  readonly code: string | null;
  readonly publicationPermit: MdxPrimaryPublicationPermit | null;
}

function createPrimaryPublicationPermit(
  state: Omit<MdxPrimaryPublicationPermitState, "used">,
): MdxPrimaryPublicationPermit {
  const permit = Object.freeze({}) as MdxPrimaryPublicationPermit;
  mdxPrimaryPublicationPermitStates.set(permit, { ...state, used: false });
  return permit;
}

function consumePrimaryPublicationPermit(
  permit: MdxPrimaryPublicationPermit,
): MdxPrimaryPublicationPermitState {
  const state = mdxPrimaryPublicationPermitStates.get(permit);
  if (!state || state.used) {
    throw new TypeError("MDX primary publication permit is invalid or already used");
  }
  state.used = true;
  return state;
}

function getOwnData(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor ||
    descriptor.get !== undefined ||
    descriptor.set !== undefined ||
    !("value" in descriptor)
  ) {
    return undefined;
  }
  return descriptor.value;
}

function extractBoundedBundleHashes(code: string): string[] | null {
  // Portable cache code uses the reserved cache token in the file-URL host
  // position. Restore the local cache root before parsing URLs so the strict
  // file-URL decoder can validate them without weakening host confinement.
  const paths = extractHttpBundlePaths(detokenizeAllCachePaths(code));
  if (paths.length > MAX_HTTP_BUNDLE_GRAPH_ENTRIES) return null;
  const hashes = [...new Set(paths.map(({ hash }) => hash.toLowerCase()))].sort();
  if (
    hashes.length > MAX_HTTP_BUNDLE_GRAPH_ENTRIES ||
    hashes.some((hash) => !isValidHttpBundleHash(hash))
  ) {
    return null;
  }
  return hashes;
}

function snapshotBundleManifestAuthority(
  authority: AcknowledgedBundleManifestAuthority | null | undefined,
): AcknowledgedBundleManifestAuthority | null {
  const acknowledgedAuthority = inspectAcknowledgedBundleManifestAuthority(authority);
  if (
    !acknowledgedAuthority ||
    Array.isArray(acknowledgedAuthority) ||
    Object.getPrototypeOf(acknowledgedAuthority) !== Object.prototype ||
    !Object.isFrozen(acknowledgedAuthority)
  ) {
    return null;
  }
  const keys = Reflect.ownKeys(acknowledgedAuthority);
  if (
    keys.length !== BUNDLE_MANIFEST_AUTHORITY_KEYS.size ||
    keys.some((key) => typeof key !== "string" || !BUNDLE_MANIFEST_AUTHORITY_KEYS.has(key))
  ) {
    return null;
  }

  const manifestId = getOwnData(acknowledgedAuthority, "manifestId");
  const rawBundleHashes = getOwnData(acknowledgedAuthority, "bundleHashes");
  if (
    typeof manifestId !== "string" ||
    !SHA256_HEX_PATTERN.test(manifestId) ||
    !Array.isArray(rawBundleHashes) ||
    Object.getPrototypeOf(rawBundleHashes) !== Array.prototype ||
    !Object.isFrozen(rawBundleHashes) ||
    rawBundleHashes.length === 0 ||
    rawBundleHashes.length > MAX_HTTP_BUNDLE_GRAPH_ENTRIES
  ) {
    return null;
  }

  const bundleHashes: string[] = [];
  for (let index = 0; index < rawBundleHashes.length; index++) {
    const hash = getOwnData(rawBundleHashes, index);
    if (
      typeof hash !== "string" ||
      !isValidHttpBundleHash(hash) ||
      index > 0 && bundleHashes[index - 1]! >= hash
    ) {
      return null;
    }
    bundleHashes.push(hash);
  }
  if (Reflect.ownKeys(rawBundleHashes).length !== bundleHashes.length + 1) return null;

  return Object.freeze({
    manifestId,
    bundleHashes: Object.freeze(bundleHashes),
  });
}

async function computeEnvelopeHash(
  codeHash: string,
  bundleManifestId: string | null,
  bundleHashes: readonly string[],
): Promise<string> {
  return await computeHash(JSON.stringify([
    MDX_DISTRIBUTED_TRANSFORM_HASH_DOMAIN,
    codeHash,
    bundleManifestId,
    bundleHashes,
  ]));
}

async function parseMdxDistributedTransformEnvelope(
  serialized: string,
): Promise<MdxDistributedTransformEnvelope | null> {
  if (
    serialized.length === 0 ||
    serialized.length > MAX_MDX_DISTRIBUTED_TRANSFORM_ENTRY_BYTES ||
    utf8ByteLength(serialized) > MAX_MDX_DISTRIBUTED_TRANSFORM_ENTRY_BYTES
  ) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }

  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== MDX_DISTRIBUTED_TRANSFORM_ENTRY_KEYS.size ||
    keys.some((key) => typeof key !== "string" || !MDX_DISTRIBUTED_TRANSFORM_ENTRY_KEYS.has(key))
  ) {
    return null;
  }

  const formatVersion = getOwnData(value, "formatVersion");
  const code = getOwnData(value, "code");
  const codeHash = getOwnData(value, "codeHash");
  const bundleManifestId = getOwnData(value, "bundleManifestId");
  const envelopeHash = getOwnData(value, "envelopeHash");
  if (
    formatVersion !== MDX_DISTRIBUTED_TRANSFORM_ENVELOPE_VERSION ||
    typeof code !== "string" ||
    code.length > MAX_MDX_MODULE_CODE_BYTES ||
    utf8ByteLength(code) > MAX_MDX_MODULE_CODE_BYTES ||
    typeof codeHash !== "string" ||
    !SHA256_HEX_PATTERN.test(codeHash) ||
    bundleManifestId !== null &&
      (typeof bundleManifestId !== "string" || !SHA256_HEX_PATTERN.test(bundleManifestId)) ||
    typeof envelopeHash !== "string" ||
    !SHA256_HEX_PATTERN.test(envelopeHash) ||
    await computeHash(code) !== codeHash
  ) {
    return null;
  }

  const bundleHashes = extractBoundedBundleHashes(code);
  if (bundleHashes === null) return null;
  if (bundleHashes.length === 0) {
    if (bundleManifestId !== null) return null;
  } else if (typeof bundleManifestId !== "string") {
    return null;
  }
  if (await computeEnvelopeHash(codeHash, bundleManifestId, bundleHashes) !== envelopeHash) {
    return null;
  }

  return Object.freeze({
    formatVersion,
    code,
    codeHash,
    bundleManifestId,
    envelopeHash,
  });
}

async function serializeMdxDistributedTransformEnvelope(
  code: string,
  bundleManifestId: string | null,
  bundleHashes: readonly string[],
): Promise<string | null> {
  const codeHash = await computeHash(code);
  const serialized = JSON.stringify(
    {
      formatVersion: MDX_DISTRIBUTED_TRANSFORM_ENVELOPE_VERSION,
      code,
      codeHash,
      bundleManifestId,
      envelopeHash: await computeEnvelopeHash(codeHash, bundleManifestId, bundleHashes),
    } satisfies MdxDistributedTransformEnvelope,
  );
  if (
    serialized.length > MAX_MDX_DISTRIBUTED_TRANSFORM_ENTRY_BYTES ||
    utf8ByteLength(serialized) > MAX_MDX_DISTRIBUTED_TRANSFORM_ENTRY_BYTES
  ) {
    return null;
  }
  return serialized;
}

function getFullyPrefixedTransformCacheKey(cacheKey: string): string {
  return `${DISTRIBUTED_TRANSFORM_CACHE_PREFIX}:${cacheKey}`;
}

function isValidApiTransformCacheKey(cacheKey: string): boolean {
  const fullyPrefixedKey = getFullyPrefixedTransformCacheKey(cacheKey);
  return fullyPrefixedKey.length <= API_CACHE_KEY_MAX_LENGTH &&
    API_CACHE_KEY_PATTERN.test(fullyPrefixedKey);
}

/** Resolve one bounded external primary identity before reserving it for CAS. */
export async function resolveMdxDistributedTransformCacheKey(
  cacheKey: string,
): Promise<string> {
  const fullyPrefixedKey = getFullyPrefixedTransformCacheKey(cacheKey);
  if (isValidApiTransformCacheKey(cacheKey)) return cacheKey;
  return `${SHA256_CACHE_KEY_PREFIX}${await computeHash(fullyPrefixedKey)}`;
}

function computePrimaryExpiry(): number {
  const expiresAtMs = Date.now() + TRANSFORM_CACHE_TTL_SECONDS * 1_000;
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
    throw new RangeError("MDX primary cache expiry is outside the supported range");
  }
  return expiresAtMs;
}

/** Observe an MDX primary exactly once and retain its publication condition. */
export async function readDistributedCache(
  transformCacheKey: string,
  projectId: string,
  contentSourceId: string | undefined,
  normalizedPath: string,
  projectSlug: string,
  _projectDir: string,
  _reactVersion: string | undefined,
  log: Logger,
): Promise<DistributedCacheReadResult | null> {
  const backend = await getDistributedTransformBackend();
  if (!backend) return null;

  let snapshot: CacheRevisionSnapshot;
  let publicationPermit: MdxPrimaryPublicationPermit;
  try {
    const resolvedKey = await resolveMdxDistributedTransformCacheKey(transformCacheKey);
    const reservedKey = buildRevisionedCacheKey(resolvedKey);
    const expiresAtMs = computePrimaryExpiry();
    snapshot = snapshotCacheRevisionResult(await backend.getWithRevision(reservedKey));
    publicationPermit = createPrimaryPublicationPermit({
      backend,
      reservedKey,
      revision: snapshot.revision,
      expiresAtMs,
    });
  } catch (error) {
    log.debug(`${LOG_PREFIX_MDX_LOADER} Distributed cache observation failed`, {
      normalizedPath,
      errorName: classifyThrownValue(error),
    });
    return { code: null, publicationPermit: null };
  }

  if (snapshot.value === null) return { code: null, publicationPermit };

  try {
    const cachedEnvelope = await parseMdxDistributedTransformEnvelope(snapshot.value);
    if (!cachedEnvelope) {
      log.warn(`${LOG_PREFIX_MDX_LOADER} Invalid distributed transform cache entry`, {
        normalizedPath,
      });
      return { code: null, publicationPermit };
    }

    let moduleCode: string | null = detokenizeAllCachePaths(cachedEnvelope.code);
    log.debug(`${LOG_PREFIX_MDX_LOADER} Distributed transform cache HIT`, {
      projectSlug,
      normalizedPath,
    });

    if (moduleCode && cachedEnvelope.bundleManifestId !== null) {
      const directBundleHashes = extractBoundedBundleHashes(cachedEnvelope.code);
      if (!directBundleHashes || directBundleHashes.length === 0) {
        moduleCode = null;
      } else {
        const validation = await validateBundleGroup(
          cachedEnvelope.bundleManifestId,
          getHttpBundleCacheDir(),
          ensureHttpBundlesExist,
          directBundleHashes,
        );
        if (!validation.valid) {
          log.warn(`${LOG_PREFIX_MDX_LOADER} Cached HTTP bundle authority validation failed`, {
            normalizedPath,
            failedHashCount: validation.failedHashes.length,
            reason: validation.reason,
          });
          moduleCode = null;
        }
      }
    }

    if (moduleCode && await hasIncompatibleFrameworkPaths(moduleCode, log)) {
      log.warn(`${LOG_PREFIX_MDX_LOADER} Cached code has incompatible framework paths`, {
        normalizedPath,
      });
      moduleCode = null;
    }

    if (moduleCode) {
      const unresolved = hasUnresolvedImports(moduleCode);
      if (unresolved.count > 0) {
        log.warn(
          `${LOG_PREFIX_MDX_LOADER} Cached code has unresolved imports, invalidating`,
          { normalizedPath, unresolvedCount: unresolved.count },
        );
        moduleCode = null;
      }
    }

    if (moduleCode) {
      const missingDeps = await findMissingFileDependenciesInCode(moduleCode, log);
      if (missingDeps.length > 0 && contentSourceId) {
        const recovered = await ensureMdxModuleDependencies(moduleCode, {
          distributedCache: backend,
          projectId,
          contentSourceId,
          log,
        });
        if (recovered.recovered.length > 0) {
          log.debug(`${LOG_PREFIX_MDX_LOADER} Recovered missing vfmod dependencies`, {
            normalizedPath,
            recoveredCount: recovered.recovered.length,
          });
        }
      }

      const unresolvedDeps = await findMissingFileDependenciesInCode(moduleCode, log);
      if (unresolvedDeps.length > 0) {
        log.debug(`${LOG_PREFIX_MDX_LOADER} Cached code has missing dependencies`, {
          normalizedPath,
          missingCount: unresolvedDeps.length,
        });
        moduleCode = null;
      }
    }

    return { code: moduleCode, publicationPermit };
  } catch (error) {
    try {
      log.debug(`${LOG_PREFIX_MDX_LOADER} Distributed cache validation failed`, {
        normalizedPath,
        errorName: classifyThrownValue(error),
      });
    } catch {
      /* diagnostic logging must not replace the original validation failure */
    }
    throw error;
  }
}

async function publishRecoveryPrerequisite(
  state: MdxPrimaryPublicationPermitState,
  projectId: string,
  contentSourceId: string,
  fileName: string,
  serializedPayload: string,
): Promise<boolean> {
  const recoveryKey = buildRevisionedCacheKey(
    buildMdxEsmModuleRecoveryCacheKey(projectId, contentSourceId, fileName),
  );
  const snapshot = snapshotCacheRevisionResult(
    await state.backend.getWithRevision(recoveryKey),
  );
  return requireCacheExchangeResult(
    await state.backend.compareExchange(
      recoveryKey,
      snapshot.revision,
      {
        kind: "set",
        value: serializedPayload,
        expiresAtMs: state.expiresAtMs,
      },
    ),
  );
}

/** Publish the recovery prerequisite, then conditionally publish the MDX primary last. */
export async function writeDistributedCache(
  publicationPermit: MdxPrimaryPublicationPermit,
  projectId: string,
  contentSourceId: string,
  moduleCode: string,
  bundleManifestAuthority: AcknowledgedBundleManifestAuthority | null,
  normalizedPath: string,
  log: Logger,
): Promise<void> {
  const state = consumePrimaryPublicationPermit(publicationPermit);

  try {
    const portableCode = tokenizeAllVeryFrontPaths(moduleCode);
    if (utf8ByteLength(portableCode) > MAX_MDX_MODULE_CODE_BYTES) {
      log.warn(`${LOG_PREFIX_MDX_LOADER} Skipping oversized distributed module cache write`, {
        normalizedPath,
      });
      return;
    }

    const bundleHashes = extractBoundedBundleHashes(portableCode);
    if (bundleHashes === null) {
      log.warn(`${LOG_PREFIX_MDX_LOADER} Skipping module with an invalid bundle set`, {
        normalizedPath,
      });
      return;
    }
    let bundleManifestId: string | null = null;
    if (bundleHashes.length === 0) {
      if (bundleManifestAuthority !== null) {
        log.debug(
          `${LOG_PREFIX_MDX_LOADER} Withholding bundle-free primary with manifest authority`,
          { normalizedPath },
        );
        return;
      }
    } else {
      const authority = snapshotBundleManifestAuthority(bundleManifestAuthority);
      if (
        !authority ||
        await computeManifestId([...authority.bundleHashes]) !== authority.manifestId ||
        bundleHashes.some((hash) => !authority.bundleHashes.includes(hash))
      ) {
        log.debug(
          `${LOG_PREFIX_MDX_LOADER} Withholding primary without matching graph authority`,
          {
            normalizedPath,
            directBundleCount: bundleHashes.length,
            hasManifestAuthority: bundleManifestAuthority !== null,
          },
        );
        return;
      }
      bundleManifestId = authority.manifestId;
    }
    const serializedTransformEnvelope = await serializeMdxDistributedTransformEnvelope(
      portableCode,
      bundleManifestId,
      bundleHashes,
    );
    if (!serializedTransformEnvelope) {
      log.warn(`${LOG_PREFIX_MDX_LOADER} Skipping oversized distributed module cache write`, {
        normalizedPath,
      });
      return;
    }

    const recoveryPayload = createMdxModuleRecoveryPayload(
      projectId,
      contentSourceId,
      normalizedPath,
      portableCode,
    );
    const serializedRecoveryPayload = serializeMdxModuleRecoveryPayload(recoveryPayload);

    const recoveryPublished = await publishRecoveryPrerequisite(
      state,
      projectId,
      contentSourceId,
      recoveryPayload.fileName,
      serializedRecoveryPayload,
    );
    if (recoveryPublished !== true) {
      log.debug(`${LOG_PREFIX_MDX_LOADER} Distributed recovery was not acknowledged`, {
        normalizedPath,
      });
      return;
    }

    const published = requireCacheExchangeResult(
      await state.backend.compareExchange(
        state.reservedKey,
        state.revision,
        {
          kind: "set",
          value: serializedTransformEnvelope,
          expiresAtMs: state.expiresAtMs,
        },
      ),
    );
    if (!published) {
      log.debug(`${LOG_PREFIX_MDX_LOADER} Distributed primary publication lost`, {
        normalizedPath,
      });
    }
  } catch (error) {
    log.debug(`${LOG_PREFIX_MDX_LOADER} Distributed publication failed`, {
      normalizedPath,
      errorName: classifyThrownValue(error),
    });
  }
}
