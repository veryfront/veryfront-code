import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  toFileUrl,
} from "#veryfront/compat/path/index.ts";
import { isAlreadyExistsError, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { copyFixedUint8ArrayWithinLimit } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import { COMPONENT_LOADER_MAX_ENTRIES } from "#veryfront/utils/constants/cache.ts";
import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const OWNER_ID_PATTERN = /^[a-f0-9]{32}$/;
const RESERVATION_NAME_PATTERN = /^[a-f0-9]{64}\.[a-f0-9]{64}$/;
const CLAIM_FILE_NAME_PATTERN = /^(0|[1-9][0-9]*)\.([a-f0-9]{32})$/;
const SLOT_DIRECTORY_NAME = ".transformed-module-slots-v2";
const CLAIMS_DIRECTORY_NAME = "claims";
const OWNERS_DIRECTORY_NAME = "owners";
const PINS_DIRECTORY_NAME = "pins";
const RESERVATIONS_DIRECTORY_NAME = "reservations";
const HEARTBEAT_FILE_NAME = "heartbeat";
const MUTATION_LOCKS_DIRECTORY_NAME = "locks";
const LOCK_INTENTS_DIRECTORY_NAME = "intents";
const LOCK_TICKETS_DIRECTORY_NAME = "tickets";
const TEMPORARY_ARTIFACT_NAME = "module.tmp";
const TEMPORARY_CLAIM_NAME = "claim.tmp";
const CLAIM_FORMAT_VERSION = 1;
const CLAIM_MAX_BYTES = 16 * 1024;
const OWNER_FILE_MAX_BYTES = 256;
const DEFAULT_LEASE_DURATION_MS = 30_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_LOCK_POLL_INTERVAL_MS = 10;
const DEFAULT_LOCK_POLL_ATTEMPTS = 200;
const LOCK_TICKET_NAME_PATTERN = /^(0|[1-9][0-9]*)\.([a-f0-9]{32})$/;
const textEncoder = new TextEncoder();
const strictTextDecoder = new TextDecoder("utf-8", { fatal: true });

interface TransformedModuleDirectoryEntry {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymlink?: boolean;
}

interface TransformedModuleFileInfo {
  readonly size: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly mtime: Date | null;
}

export interface TransformedModuleFileStore {
  createFileBytesExclusive?(path: string, content: Uint8Array): Promise<void>;
  readFileBytesWithinLimit?(path: string, byteLimit: number): Promise<Uint8Array>;
  writeFile?(path: string, content: Uint8Array): Promise<void>;
  rename?(from: string, to: string): Promise<void>;
  mkdir?(path: string, options?: { recursive?: boolean }): Promise<void>;
  readDir?(path: string): AsyncIterable<TransformedModuleDirectoryEntry>;
  stat?(path: string): Promise<TransformedModuleFileInfo>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
}

export type TransformedModuleImporter = (
  specifier: string,
) => Promise<Record<string, unknown>>;

interface TransformedModuleCoordinatorOptions {
  maxArtifacts?: number;
  maxArtifactBytes?: number;
  ownerId?: string;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  lockPollIntervalMs?: number;
  lockPollAttempts?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

interface ArtifactClaim {
  readonly version: typeof CLAIM_FORMAT_VERSION;
  readonly ownerId: string;
  readonly generationId: string;
  readonly componentHash: string;
  readonly relativeComponentFile: string;
  readonly contentHash: string;
  readonly artifactBytes: number;
}

interface StoredClaim {
  readonly slot: number;
  readonly claimId: string;
  readonly claimPath: string;
  readonly claim: ArtifactClaim;
  readonly reservationName: string;
  readonly artifactPath: string;
  readonly artifactValid: boolean;
}

interface MaterializedArtifact {
  readonly path: string;
  readonly slotRoot: string;
  readonly claimId: string;
  readonly ownerId: string;
}

interface ActivePin {
  readonly reservationName: string;
  readonly ownerIds: Set<string>;
}

interface LedgerInventory {
  readonly claims: Map<number, StoredClaim>;
  readonly activePins: Map<string, ActivePin>;
}

interface StoreCapabilities {
  readonly createExclusive: NonNullable<
    TransformedModuleFileStore["createFileBytesExclusive"]
  >;
  readonly readWithinLimit: NonNullable<
    TransformedModuleFileStore["readFileBytesWithinLimit"]
  >;
  readonly writeFile: NonNullable<TransformedModuleFileStore["writeFile"]>;
  readonly rename: NonNullable<TransformedModuleFileStore["rename"]>;
  readonly mkdir: NonNullable<TransformedModuleFileStore["mkdir"]>;
  readonly readDir: NonNullable<TransformedModuleFileStore["readDir"]>;
  readonly stat: NonNullable<TransformedModuleFileStore["stat"]>;
}

interface LedgerPaths {
  readonly slotRoot: string;
  readonly claimsRoot: string;
  readonly ownersRoot: string;
  readonly reservationsRoot: string;
  readonly lockIntentsRoot: string;
  readonly lockTicketsRoot: string;
}

interface MutationLock {
  readonly operationId: string;
  readonly sequence: number;
  readonly ticketPath: string;
  readonly ownerId: string;
}

type ActiveLockTicket = MutationLock;

function validateContentHash(contentHash: string): void {
  if (!CONTENT_HASH_PATTERN.test(contentHash)) {
    throw new TypeError("Transformed module content hash must be a lowercase SHA-256 digest");
  }
}

function validateOwnerId(ownerId: string): void {
  if (!OWNER_ID_PATTERN.test(ownerId)) {
    throw new TypeError("Transformed module owner ID must be a 128-bit lowercase hex value");
  }
}

function validatePositiveSafeInteger(value: number, description: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${description} must be a positive safe integer`);
  }
}

function validateSlotIndex(slot: number): void {
  if (!Number.isSafeInteger(slot) || slot < 0) {
    throw new RangeError("Transformed module slot index must be a non-negative safe integer");
  }
}

function resolveComponentIdentity(
  componentFile: string,
  lifecycleRoot: string,
): { relativeComponentFile: string; slotRoot: string } {
  if (componentFile.length === 0 || lifecycleRoot.length === 0) {
    throw new TypeError("Transformed module paths must not be empty");
  }

  const relativeComponentFile = relative(lifecycleRoot, componentFile);
  if (
    relativeComponentFile.length === 0 ||
    relativeComponentFile === ".." ||
    relativeComponentFile.startsWith("../") ||
    relativeComponentFile.startsWith("..\\") ||
    isAbsolute(relativeComponentFile)
  ) {
    throw new TypeError("Transformed module path must remain inside its lifecycle root");
  }
  const portableComponentFile = relativeComponentFile.replaceAll("\\", "/");
  if (
    portableComponentFile === SLOT_DIRECTORY_NAME ||
    portableComponentFile.startsWith(`${SLOT_DIRECTORY_NAME}/`)
  ) {
    throw new TypeError("Transformed module path overlaps the lifecycle slot ledger");
  }

  return {
    relativeComponentFile: portableComponentFile,
    slotRoot: join(lifecycleRoot, SLOT_DIRECTORY_NAME),
  };
}

export function buildTransformedModuleSlotPath(
  componentFile: string,
  slot: number,
  contentHash: string,
  generationId?: string,
): string {
  if (componentFile.length === 0) {
    throw new TypeError("Transformed module path must not be empty");
  }
  validateSlotIndex(slot);
  validateContentHash(contentHash);
  if (generationId !== undefined) validateOwnerId(generationId);

  const extension = extname(componentFile);
  const stem = extension.length > 0 ? componentFile.slice(0, -extension.length) : componentFile;
  if (generationId === undefined) {
    return `${stem}.vf-slot-${slot}.${contentHash}${extension || ".js"}`;
  }
  return join(
    dirname(componentFile),
    `.vf-slot-${slot}-${generationId}.${contentHash}${extension || ".js"}`,
  );
}

export function buildTransformedModuleSpecifier(
  versionedFile: string,
  retryAttempt: number,
): string {
  if (!Number.isSafeInteger(retryAttempt) || retryAttempt < 0) {
    throw new RangeError("Transformed module retry attempt must be a non-negative safe integer");
  }
  const moduleUrl = toFileUrl(versionedFile);
  if (retryAttempt > 0) moduleUrl.searchParams.set("retry", String(retryAttempt));
  return moduleUrl.href;
}

function encodeUtf8WithinLimit(source: string, byteLimit: number): Uint8Array {
  if (source.length > byteLimit) {
    throw new RangeError(`Transformed module exceeds ${byteLimit} bytes`);
  }

  const maximumEncodedLength = Math.min(byteLimit + 1, Math.max(1, source.length * 3));
  const buffer = new Uint8Array(maximumEncodedLength);
  const result = textEncoder.encodeInto(source, buffer);
  if (result.read !== source.length || result.written > byteLimit) {
    throw new RangeError(`Transformed module exceeds ${byteLimit} bytes`);
  }
  return buffer.slice(0, result.written);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function reservationNameFor(claim: Pick<ArtifactClaim, "componentHash" | "contentHash">) {
  return `${claim.componentHash}.${claim.contentHash}`;
}

function encodeClaim(claim: ArtifactClaim): Uint8Array {
  const bytes = textEncoder.encode(JSON.stringify(claim));
  if (bytes.byteLength > CLAIM_MAX_BYTES) {
    throw new RangeError(`Transformed module claim exceeds ${CLAIM_MAX_BYTES} bytes`);
  }
  return bytes;
}

function decodeClaim(bytes: Uint8Array): ArtifactClaim {
  let parsed: unknown;
  try {
    parsed = JSON.parse(strictTextDecoder.decode(bytes));
  } catch (cause) {
    throw new TypeError("Transformed module claim is not valid JSON", { cause });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Transformed module claim must be an object");
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.version !== CLAIM_FORMAT_VERSION ||
    typeof record.ownerId !== "string" ||
    typeof record.generationId !== "string" ||
    typeof record.componentHash !== "string" ||
    typeof record.relativeComponentFile !== "string" ||
    typeof record.contentHash !== "string" ||
    !Number.isSafeInteger(record.artifactBytes) ||
    (record.artifactBytes as number) < 0
  ) {
    throw new TypeError("Transformed module claim has invalid fields");
  }
  validateOwnerId(record.ownerId);
  validateOwnerId(record.generationId);
  validateContentHash(record.componentHash);
  validateContentHash(record.contentHash);
  return {
    version: CLAIM_FORMAT_VERSION,
    ownerId: record.ownerId,
    generationId: record.generationId,
    componentHash: record.componentHash,
    relativeComponentFile: record.relativeComponentFile,
    contentHash: record.contentHash,
    artifactBytes: record.artifactBytes as number,
  };
}

function createOwnerId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function ledgerPaths(slotRoot: string): LedgerPaths {
  const locksRoot = join(slotRoot, MUTATION_LOCKS_DIRECTORY_NAME);
  return {
    slotRoot,
    claimsRoot: join(slotRoot, CLAIMS_DIRECTORY_NAME),
    ownersRoot: join(slotRoot, OWNERS_DIRECTORY_NAME),
    reservationsRoot: join(slotRoot, RESERVATIONS_DIRECTORY_NAME),
    lockIntentsRoot: join(locksRoot, LOCK_INTENTS_DIRECTORY_NAME),
    lockTicketsRoot: join(locksRoot, LOCK_TICKETS_DIRECTORY_NAME),
  };
}

function compareLockTickets(left: ActiveLockTicket, right: ActiveLockTicket): number {
  const sequenceDifference = left.sequence - right.sequence;
  if (sequenceDifference !== 0) return sequenceDifference;
  if (left.operationId === right.operationId) return 0;
  return left.operationId < right.operationId ? -1 : 1;
}

/**
 * Publishes immutable transformed modules through a bounded lease ledger.
 * A live coordinator pins every artifact it has imported. At capacity, only
 * artifacts without a live pin may be recycled, so delayed relative imports
 * keep their immutable base while crashed or restarted owners cannot brick the
 * project cache permanently.
 */
export class TransformedModuleCoordinator {
  readonly #store: TransformedModuleFileStore;
  readonly #importer: TransformedModuleImporter;
  readonly #maxArtifacts: number;
  readonly #maxArtifactBytes: number;
  readonly #initialOwnerId: string;
  readonly #leaseDurationMs: number;
  readonly #heartbeatIntervalMs: number;
  readonly #lockPollIntervalMs: number;
  readonly #lockPollAttempts: number;
  readonly #now: () => number;
  readonly #wait: (milliseconds: number) => Promise<void>;
  readonly #pendingMaterializations = new Map<string, Promise<MaterializedArtifact>>();
  readonly #retryAttempts = new Map<string, number>();
  readonly #pendingImports = new Map<string, number>();
  readonly #successfulClaims = new Set<string>();
  readonly #evictedPendingClaims = new Set<string>();
  readonly #leaseOwners = new Map<string, string>();
  readonly #leaseRenewals = new Map<string, Promise<string>>();
  readonly #leaseFailures = new Map<string, unknown>();
  #heartbeatTimer?: ReturnType<typeof setInterval>;
  #heartbeatPromise?: Promise<void>;
  #disposed = false;

  constructor(
    store: TransformedModuleFileStore,
    importer: TransformedModuleImporter = (specifier) => import(specifier),
    options: TransformedModuleCoordinatorOptions = {},
  ) {
    const maxArtifacts = options.maxArtifacts ?? COMPONENT_LOADER_MAX_ENTRIES;
    const maxArtifactBytes = options.maxArtifactBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    const ownerId = options.ownerId ?? createOwnerId();
    const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    const heartbeatIntervalMs = options.heartbeatIntervalMs ??
      DEFAULT_HEARTBEAT_INTERVAL_MS;
    const lockPollIntervalMs = options.lockPollIntervalMs ?? DEFAULT_LOCK_POLL_INTERVAL_MS;
    const lockPollAttempts = options.lockPollAttempts ?? DEFAULT_LOCK_POLL_ATTEMPTS;

    validatePositiveSafeInteger(maxArtifacts, "Transformed module artifact limit");
    validatePositiveSafeInteger(maxArtifactBytes, "Transformed module byte limit");
    validatePositiveSafeInteger(leaseDurationMs, "Transformed module lease duration");
    validatePositiveSafeInteger(heartbeatIntervalMs, "Transformed module heartbeat interval");
    validatePositiveSafeInteger(lockPollIntervalMs, "Transformed module lock poll interval");
    validatePositiveSafeInteger(lockPollAttempts, "Transformed module lock poll attempts");
    if (heartbeatIntervalMs >= leaseDurationMs) {
      throw new RangeError("Transformed module heartbeat interval must be shorter than its lease");
    }
    validateOwnerId(ownerId);

    this.#store = store;
    this.#importer = importer;
    this.#maxArtifacts = maxArtifacts;
    this.#maxArtifactBytes = maxArtifactBytes;
    this.#initialOwnerId = ownerId;
    this.#leaseDurationMs = leaseDurationMs;
    this.#heartbeatIntervalMs = heartbeatIntervalMs;
    this.#lockPollIntervalMs = lockPollIntervalMs;
    this.#lockPollAttempts = lockPollAttempts;
    this.#now = options.now ?? Date.now;
    this.#wait = options.wait ?? defaultWait;
  }

  async importTransformedModule(
    componentFile: string,
    transformedCode: string,
    contentHash: string,
    lifecycleRoot: string,
  ): Promise<Record<string, unknown>> {
    if (this.#disposed) throw new Error("Transformed module coordinator has been disposed");
    validateContentHash(contentHash);
    const { relativeComponentFile, slotRoot } = resolveComponentIdentity(
      componentFile,
      lifecycleRoot,
    );
    const expected = encodeUtf8WithinLimit(transformedCode, this.#maxArtifactBytes);
    const materializationKey = `${slotRoot}\0${relativeComponentFile}\0${contentHash}`;
    const materialized = await this.#materialize(
      materializationKey,
      componentFile,
      lifecycleRoot,
      slotRoot,
      relativeComponentFile,
      expected,
      contentHash,
    );

    const claimKey = this.#claimKey(materialized.slotRoot, materialized.claimId);
    this.#pendingImports.set(claimKey, (this.#pendingImports.get(claimKey) ?? 0) + 1);
    const retryAttempt = this.#readRetryAttempt(materialized.path);
    try {
      const imported = await this.#importer(
        buildTransformedModuleSpecifier(materialized.path, retryAttempt),
      );
      if (this.#evictedPendingClaims.has(claimKey)) {
        throw new Error("Transformed module evaluation was superseded by a newer version");
      }
      this.#successfulClaims.add(claimKey);
      this.#finishImportAttempt(claimKey);
      return imported;
    } catch (error) {
      if ((this.#retryAttempts.get(materialized.path) ?? 0) === retryAttempt) {
        this.#rememberRetryAttempt(materialized.path, retryAttempt + 1);
      }
      this.#finishImportAttempt(claimKey);
      try {
        await this.#releaseRejectedClaimPin(materialized, claimKey);
      } catch (pinError) {
        throw new AggregateError(
          [error, pinError],
          "Transformed module import and rejected-claim cleanup both failed",
        );
      }
      throw error;
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#heartbeatTimer !== undefined) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = undefined;
    await this.#heartbeatPromise;

    const failures: unknown[] = [];
    for (const [slotRoot, ownerId] of this.#leaseOwners) {
      for (
        const path of [
          join(slotRoot, RESERVATIONS_DIRECTORY_NAME, ownerId),
          join(slotRoot, OWNERS_DIRECTORY_NAME, ownerId),
        ]
      ) {
        try {
          await this.#store.remove(path, { recursive: true });
        } catch (error) {
          if (!isNotFoundError(error)) failures.push(error);
        }
      }
    }
    this.#leaseOwners.clear();
    this.#leaseRenewals.clear();
    this.#leaseFailures.clear();
    this.#pendingImports.clear();
    this.#successfulClaims.clear();
    this.#evictedPendingClaims.clear();
    if (failures.length > 0) {
      throw new AggregateError(failures, "Transformed module lease disposal failed");
    }
  }

  async #materialize(
    materializationKey: string,
    componentFile: string,
    lifecycleRoot: string,
    slotRoot: string,
    relativeComponentFile: string,
    expected: Uint8Array,
    contentHash: string,
  ): Promise<MaterializedArtifact> {
    const pendingPromise = this.#pendingMaterializations.get(materializationKey);
    if (pendingPromise) return await pendingPromise;

    const operationPromise = this.#findOrCreateArtifact(
      componentFile,
      lifecycleRoot,
      slotRoot,
      relativeComponentFile,
      expected,
      contentHash,
    );
    this.#pendingMaterializations.set(materializationKey, operationPromise);
    try {
      return await operationPromise;
    } finally {
      const currentPromise = this.#pendingMaterializations.get(materializationKey);
      // Compare promise identity: only the operation that installed this entry may remove it.
      if (Object.is(currentPromise, operationPromise)) {
        this.#pendingMaterializations.delete(materializationKey);
      }
    }
  }

  async #findOrCreateArtifact(
    componentFile: string,
    lifecycleRoot: string,
    slotRoot: string,
    relativeComponentFile: string,
    expected: Uint8Array,
    contentHash: string,
  ): Promise<MaterializedArtifact> {
    const capabilities = this.#requireCapabilities();
    const ownerId = await this.#renewLease(slotRoot, capabilities);

    return await this.#withMutationLock(slotRoot, ownerId, capabilities, async (lock) => {
      const paths = ledgerPaths(slotRoot);
      const inventory = await this.#readInventory(
        lifecycleRoot,
        paths,
        lock,
        capabilities,
      );
      const requestedReservation = reservationNameFor({
        componentHash: await computeHash(relativeComponentFile),
        contentHash,
      });
      await this.#pruneInventoryToLimit(
        paths,
        inventory,
        requestedReservation,
        lock,
        capabilities,
      );
      const existingArtifact = await this.#reuseMatchingClaim(
        paths,
        inventory,
        requestedReservation,
        relativeComponentFile,
        expected,
        lock,
        capabilities,
      );
      if (existingArtifact !== undefined) return existingArtifact;

      const slot = await this.#reserveAvailableSlot(paths, inventory, lock, capabilities);

      return await this.#publishClaim(
        componentFile,
        paths,
        slot,
        relativeComponentFile,
        expected,
        contentHash,
        lock,
        capabilities,
      );
    });
  }

  async #reuseMatchingClaim(
    paths: LedgerPaths,
    inventory: LedgerInventory,
    requestedReservation: string,
    relativeComponentFile: string,
    expected: Uint8Array,
    lock: MutationLock,
    capabilities: StoreCapabilities,
  ): Promise<MaterializedArtifact | undefined> {
    for (const stored of inventory.claims.values()) {
      if (stored.reservationName !== requestedReservation) continue;
      if (stored.claim.relativeComponentFile !== relativeComponentFile) {
        throw new Error("Transformed module reservation identity is ambiguous");
      }
      if (!stored.artifactValid) {
        throw new Error("Transformed module matching artifact is invalid while actively pinned");
      }
      await this.#verifyExisting(stored.artifactPath, expected, capabilities);
      await this.#assertMutationLock(paths, lock, capabilities);
      await this.#pinClaim(paths, stored, lock.ownerId, capabilities);
      return {
        path: stored.artifactPath,
        slotRoot: paths.slotRoot,
        claimId: stored.claimId,
        ownerId: lock.ownerId,
      };
    }
    return undefined;
  }

  async #reserveAvailableSlot(
    paths: LedgerPaths,
    inventory: LedgerInventory,
    lock: MutationLock,
    capabilities: StoreCapabilities,
  ): Promise<number> {
    const recyclable = [...inventory.claims.values()]
      .sort((left, right) => left.slot - right.slot)
      .filter((stored) => !inventory.activePins.has(stored.claimId));
    while (inventory.claims.size >= this.#maxArtifacts) {
      const stored = recyclable.shift() ?? await this.#evictOldestPendingPin(
        paths,
        inventory,
        lock,
        capabilities,
      );
      if (stored === undefined) {
        throw new RangeError(
          `Transformed module artifact limit of ${this.#maxArtifacts} is held by active leases`,
        );
      }
      await this.#assertMutationLock(paths, lock, capabilities);
      await this.#removeClaim(paths, stored, capabilities);
      inventory.claims.delete(stored.slot);
    }

    const freeSlot = this.#firstFreeSlot(inventory.claims);
    if (freeSlot === undefined) {
      throw new Error("Transformed module slot inventory has no free bounded slot");
    }
    return freeSlot;
  }

  async #evictOldestPendingPin(
    paths: LedgerPaths,
    inventory: LedgerInventory,
    lock: MutationLock,
    capabilities: StoreCapabilities,
  ): Promise<StoredClaim | undefined> {
    for (const claimKey of this.#pendingImports.keys()) {
      if (
        this.#successfulClaims.has(claimKey) ||
        this.#evictedPendingClaims.has(claimKey)
      ) {
        continue;
      }
      const stored = [...inventory.claims.values()].find((candidate) =>
        this.#claimKey(paths.slotRoot, candidate.claimId) === claimKey
      );
      if (stored === undefined) continue;
      const activePin = inventory.activePins.get(stored.claimId);
      if (
        activePin === undefined ||
        activePin.ownerIds.size !== 1 ||
        !activePin.ownerIds.has(lock.ownerId)
      ) {
        continue;
      }

      await this.#assertMutationLock(paths, lock, capabilities);
      await this.#removeIfPresent(
        join(
          paths.ownersRoot,
          lock.ownerId,
          PINS_DIRECTORY_NAME,
          stored.claimId,
        ),
        false,
      );
      inventory.activePins.delete(stored.claimId);
      this.#evictedPendingClaims.add(claimKey);
      return stored;
    }
    return undefined;
  }

  async #pruneInventoryToLimit(
    paths: LedgerPaths,
    inventory: LedgerInventory,
    preservedReservation: string,
    lock: MutationLock,
    capabilities: StoreCapabilities,
  ): Promise<void> {
    const recyclable = [...inventory.claims.values()]
      .sort((left, right) => left.slot - right.slot)
      .filter((stored) =>
        stored.reservationName !== preservedReservation &&
        !inventory.activePins.has(stored.claimId)
      );
    while (inventory.claims.size > this.#maxArtifacts) {
      const stored = recyclable.shift() ?? await this.#evictOldestPendingPin(
        paths,
        inventory,
        lock,
        capabilities,
      );
      if (stored === undefined) {
        throw new RangeError(
          `Transformed module artifact limit of ${this.#maxArtifacts} is held by active leases`,
        );
      }
      await this.#assertMutationLock(paths, lock, capabilities);
      await this.#removeClaim(paths, stored, capabilities);
      inventory.claims.delete(stored.slot);
    }
  }

  #requireCapabilities(): StoreCapabilities {
    const createExclusive = this.#store.createFileBytesExclusive;
    const readWithinLimit = this.#store.readFileBytesWithinLimit;
    const writeFile = this.#store.writeFile;
    const rename = this.#store.rename;
    const mkdir = this.#store.mkdir;
    const readDir = this.#store.readDir;
    const stat = this.#store.stat;
    if (typeof createExclusive !== "function") {
      throw new TypeError("Transformed modules require exclusive file creation");
    }
    if (typeof readWithinLimit !== "function") {
      throw new TypeError("Transformed modules require exact reads to verify existing content");
    }
    if (typeof writeFile !== "function") {
      throw new TypeError("Transformed modules require lease heartbeat writes");
    }
    if (typeof rename !== "function") {
      throw new TypeError("Transformed modules require atomic file publication");
    }
    if (
      typeof mkdir !== "function" || typeof readDir !== "function" || typeof stat !== "function"
    ) {
      throw new TypeError("Transformed modules require persistent lease-directory operations");
    }
    return { createExclusive, readWithinLimit, writeFile, rename, mkdir, readDir, stat };
  }

  async #renewLease(slotRoot: string, capabilities: StoreCapabilities): Promise<string> {
    const pending = this.#leaseRenewals.get(slotRoot);
    if (pending !== undefined) return await pending;

    const renewal = this.#renewLeaseEpoch(slotRoot, capabilities);
    this.#leaseRenewals.set(slotRoot, renewal);
    try {
      return await renewal;
    } finally {
      if (Object.is(this.#leaseRenewals.get(slotRoot), renewal)) {
        this.#leaseRenewals.delete(slotRoot);
      }
    }
  }

  async #renewLeaseEpoch(
    slotRoot: string,
    capabilities: StoreCapabilities,
  ): Promise<string> {
    const paths = ledgerPaths(slotRoot);
    let ownerId = this.#leaseOwners.get(slotRoot);
    if (ownerId !== undefined) {
      const heartbeatPath = join(paths.ownersRoot, ownerId, HEARTBEAT_FILE_NAME);
      if (!await this.#isFresh(heartbeatPath, this.#leaseDurationMs, capabilities)) {
        this.#supersedeRootEpoch(slotRoot);
        ownerId = createOwnerId();
        await this.#initializeLease(paths, ownerId, capabilities);
      }
    } else {
      ownerId = this.#initialOwnerId;
      await this.#initializeLease(paths, ownerId, capabilities);
    }
    await capabilities.writeFile.call(
      this.#store,
      join(paths.ownersRoot, ownerId, HEARTBEAT_FILE_NAME),
      new Uint8Array([1]),
    );
    this.#leaseOwners.set(slotRoot, ownerId);
    this.#leaseFailures.delete(slotRoot);
    this.#startHeartbeat();
    return ownerId;
  }

  async #initializeLease(
    paths: LedgerPaths,
    ownerId: string,
    capabilities: StoreCapabilities,
  ): Promise<void> {
    await capabilities.mkdir.call(this.#store, paths.claimsRoot, { recursive: true });
    await capabilities.mkdir.call(this.#store, paths.reservationsRoot, { recursive: true });
    await capabilities.mkdir.call(
      this.#store,
      join(paths.reservationsRoot, ownerId),
      { recursive: true },
    );
    await capabilities.mkdir.call(this.#store, paths.lockIntentsRoot, { recursive: true });
    await capabilities.mkdir.call(this.#store, paths.lockTicketsRoot, { recursive: true });
    await capabilities.mkdir.call(
      this.#store,
      join(paths.ownersRoot, ownerId, PINS_DIRECTORY_NAME),
      {
        recursive: true,
      },
    );
  }

  #supersedeRootEpoch(slotRoot: string): void {
    const prefix = `${slotRoot}\0`;
    for (const claimKey of this.#pendingImports.keys()) {
      if (claimKey.startsWith(prefix)) this.#evictedPendingClaims.add(claimKey);
    }
    for (const claimKey of this.#successfulClaims) {
      if (claimKey.startsWith(prefix)) this.#successfulClaims.delete(claimKey);
    }
  }

  #startHeartbeat(): void {
    if (this.#heartbeatTimer !== undefined || this.#disposed) return;
    this.#heartbeatTimer = setInterval(() => {
      if (this.#heartbeatPromise !== undefined || this.#disposed) return;
      const renewal = this.#renewAllLeases();
      this.#heartbeatPromise = renewal;
      void renewal.finally(() => {
        if (Object.is(this.#heartbeatPromise, renewal)) {
          this.#heartbeatPromise = undefined;
        }
      });
    }, this.#heartbeatIntervalMs);

    const rawTimer: unknown = this.#heartbeatTimer;
    const timer = rawTimer as { unref?: () => void };
    if (typeof timer.unref === "function") timer.unref();
    const deno = (globalThis as { Deno?: { unrefTimer?: (id: number) => void } }).Deno;
    if (typeof this.#heartbeatTimer === "number" && typeof deno?.unrefTimer === "function") {
      deno.unrefTimer(this.#heartbeatTimer);
    }
  }

  async #renewAllLeases(): Promise<void> {
    let capabilities: StoreCapabilities;
    try {
      capabilities = this.#requireCapabilities();
    } catch (error) {
      for (const slotRoot of this.#leaseOwners.keys()) this.#leaseFailures.set(slotRoot, error);
      return;
    }
    await Promise.all([...this.#leaseOwners.keys()].map(async (slotRoot) => {
      try {
        await this.#renewLease(slotRoot, capabilities);
      } catch (error) {
        this.#leaseFailures.set(slotRoot, error);
      }
    }));
  }

  async #withMutationLock<T>(
    slotRoot: string,
    ownerId: string,
    capabilities: StoreCapabilities,
    operation: (lock: MutationLock) => Promise<T>,
  ): Promise<T> {
    const leaseFailure = this.#leaseFailures.get(slotRoot);
    if (leaseFailure !== undefined) {
      throw new AggregateError(
        [leaseFailure],
        "Transformed module lease heartbeat failed",
      );
    }
    const paths = ledgerPaths(slotRoot);
    const lock = await this.#acquireMutationLock(paths, ownerId, capabilities);

    let result: T | undefined;
    let operationError: unknown;
    let operationFailed = false;
    try {
      result = await operation(lock);
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }

    try {
      await this.#releaseMutationLock(lock);
    } catch (releaseError) {
      if (operationFailed) {
        throw new AggregateError(
          [operationError, releaseError],
          "Transformed module operation and lock release both failed",
        );
      }
      throw releaseError;
    }
    if (operationFailed) throw operationError;
    return result as T;
  }

  async #acquireMutationLock(
    paths: LedgerPaths,
    ownerId: string,
    capabilities: StoreCapabilities,
  ): Promise<MutationLock> {
    const operationId = createOwnerId();
    const ownerBytes = textEncoder.encode(ownerId);
    const intentPath = join(paths.lockIntentsRoot, operationId);
    await capabilities.createExclusive.call(this.#store, intentPath, ownerBytes);

    let lock: MutationLock | undefined;
    let ticketCreationError: unknown;
    try {
      const existingTickets = await this.#collectActiveLockTickets(paths, capabilities);
      let maximumSequence = -1;
      for (const ticket of existingTickets) {
        maximumSequence = Math.max(maximumSequence, ticket.sequence);
      }
      const sequence = maximumSequence + 1;
      validateSlotIndex(sequence);
      const ticketPath = join(paths.lockTicketsRoot, `${sequence}.${operationId}`);
      await capabilities.createExclusive.call(this.#store, ticketPath, ownerBytes);
      lock = { operationId, sequence, ticketPath, ownerId };
    } catch (error) {
      ticketCreationError = error;
    }

    try {
      await this.#store.remove(intentPath);
    } catch (intentRemovalError) {
      if (!isNotFoundError(intentRemovalError)) {
        if (ticketCreationError !== undefined) {
          throw new AggregateError(
            [ticketCreationError, intentRemovalError],
            "Transformed module lock ticket creation and intent cleanup both failed",
          );
        }
        if (lock !== undefined) {
          try {
            await this.#store.remove(lock.ticketPath);
          } catch (ticketRemovalError) {
            if (!isNotFoundError(ticketRemovalError)) {
              throw new AggregateError(
                [intentRemovalError, ticketRemovalError],
                "Transformed module lock intent and ticket cleanup both failed",
              );
            }
          }
        }
        throw intentRemovalError;
      }
    }
    if (ticketCreationError !== undefined) throw ticketCreationError;
    if (lock === undefined) {
      throw new Error("Transformed module lock ticket was not created");
    }

    let acquisitionError: unknown;
    try {
      for (let attempt = 0; attempt < this.#lockPollAttempts; attempt++) {
        const activeIntents = await this.#collectActiveLockIntents(paths, capabilities);
        const activeTickets = await this.#collectActiveLockTickets(paths, capabilities);
        const winner = activeTickets.toSorted(compareLockTickets)[0];
        const ownsTicket = activeTickets.some((ticket) => ticket.ticketPath === lock.ticketPath);
        if (!ownsTicket) {
          throw new Error("Transformed module publication lock ownership was lost");
        }
        if (activeIntents.size === 0 && winner?.ticketPath === lock.ticketPath) return lock;

        if (attempt + 1 < this.#lockPollAttempts) {
          await this.#wait(this.#lockPollIntervalMs);
        }
      }
      throw new Error("Transformed module publication lock is held by an active owner");
    } catch (error) {
      acquisitionError = error;
    }
    try {
      await this.#releaseMutationLock(lock);
    } catch (releaseError) {
      throw new AggregateError(
        [acquisitionError, releaseError],
        "Transformed module lock wait and ticket cleanup both failed",
      );
    }
    throw acquisitionError;
  }

  async #releaseMutationLock(lock: MutationLock): Promise<void> {
    try {
      await this.#store.remove(lock.ticketPath);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  async #assertMutationLock(
    paths: LedgerPaths,
    lock: MutationLock,
    capabilities: StoreCapabilities,
  ): Promise<void> {
    const activeTickets = await this.#collectActiveLockTickets(paths, capabilities);
    const winner = activeTickets.toSorted(compareLockTickets)[0];
    if (winner?.ticketPath !== lock.ticketPath) {
      throw new Error("Transformed module publication lease expired during mutation");
    }
  }

  async #collectActiveLockIntents(
    paths: LedgerPaths,
    capabilities: StoreCapabilities,
  ): Promise<Set<string>> {
    const activeIntents = new Set<string>();
    for await (const entry of capabilities.readDir.call(this.#store, paths.lockIntentsRoot)) {
      if (
        entry.isSymlink === true ||
        !entry.isFile ||
        entry.isDirectory ||
        !OWNER_ID_PATTERN.test(entry.name)
      ) {
        throw new Error("Transformed module lock intent ledger contains an unexpected entry");
      }
      const intentPath = join(paths.lockIntentsRoot, entry.name);
      const ownerId = await this.#readActiveLockOwner(intentPath, paths, capabilities);
      if (ownerId === null) {
        await this.#removeIfPresent(intentPath, false);
      } else {
        activeIntents.add(intentPath);
      }
    }
    return activeIntents;
  }

  async #collectActiveLockTickets(
    paths: LedgerPaths,
    capabilities: StoreCapabilities,
  ): Promise<ActiveLockTicket[]> {
    const activeTickets: ActiveLockTicket[] = [];
    for await (const entry of capabilities.readDir.call(this.#store, paths.lockTicketsRoot)) {
      const match = LOCK_TICKET_NAME_PATTERN.exec(entry.name);
      if (
        entry.isSymlink === true ||
        !entry.isFile ||
        entry.isDirectory ||
        match === null
      ) {
        throw new Error("Transformed module lock ticket ledger contains an unexpected entry");
      }
      const sequence = Number(match[1]);
      validateSlotIndex(sequence);
      const operationId = match[2]!;
      const ticketPath = join(paths.lockTicketsRoot, entry.name);
      const ownerId = await this.#readActiveLockOwner(ticketPath, paths, capabilities);
      if (ownerId === null) {
        await this.#removeIfPresent(ticketPath, false);
      } else {
        activeTickets.push({ operationId, sequence, ticketPath, ownerId });
      }
    }
    return activeTickets;
  }

  async #readActiveLockOwner(
    path: string,
    paths: LedgerPaths,
    capabilities: StoreCapabilities,
  ): Promise<string | null> {
    const ownerId = await this.#readOwnerFile(path, capabilities);
    if (ownerId === null) {
      if (await this.#isFresh(path, this.#leaseDurationMs, capabilities)) {
        throw new Error("Transformed module lock ledger contains a corrupt live entry");
      }
      return null;
    }
    if (!await this.#isFresh(path, this.#leaseDurationMs, capabilities)) return null;
    return await this.#isOwnerActive(paths, ownerId, capabilities) ? ownerId : null;
  }

  async #readOwnerFile(
    path: string,
    capabilities: StoreCapabilities,
  ): Promise<string | null> {
    let bytes: Uint8Array;
    try {
      bytes = await capabilities.readWithinLimit.call(
        this.#store,
        path,
        OWNER_FILE_MAX_BYTES,
      );
    } catch (error) {
      if (isNotFoundError(error) || error instanceof RangeError) return null;
      throw error;
    }
    let ownerId: string;
    try {
      ownerId = strictTextDecoder.decode(bytes);
    } catch {
      return null;
    }
    return OWNER_ID_PATTERN.test(ownerId) ? ownerId : null;
  }

  async #isOwnerActive(
    paths: LedgerPaths,
    ownerId: string,
    capabilities: StoreCapabilities,
  ): Promise<boolean> {
    return await this.#isFresh(
      join(paths.ownersRoot, ownerId, HEARTBEAT_FILE_NAME),
      this.#leaseDurationMs,
      capabilities,
    );
  }

  async #isFresh(
    path: string,
    durationMs: number,
    capabilities: StoreCapabilities,
  ): Promise<boolean> {
    let info: TransformedModuleFileInfo;
    try {
      info = await capabilities.stat.call(this.#store, path);
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
    if (!info.isFile || info.isDirectory || !(info.mtime instanceof Date)) return false;
    const modifiedAt = info.mtime.getTime();
    if (!Number.isFinite(modifiedAt)) return false;
    return modifiedAt >= this.#now() - durationMs;
  }

  async #readInventory(
    lifecycleRoot: string,
    paths: LedgerPaths,
    lock: MutationLock,
    capabilities: StoreCapabilities,
  ): Promise<LedgerInventory> {
    const activeOwners = await this.#collectActiveOwners(paths, lock, capabilities);
    await this.#cleanupAbandonedReservations(paths, activeOwners, lock, capabilities);
    const activePins = await this.#collectActivePins(paths, activeOwners, capabilities);
    const claims = await this.#collectStoredClaims(
      lifecycleRoot,
      paths,
      activePins,
      lock,
      capabilities,
    );

    const claimIds = new Set([...claims.values()].map((stored) => stored.claimId));
    for (const claimId of activePins.keys()) {
      if (!claimIds.has(claimId)) {
        throw new Error("Transformed module active pin has no artifact claim");
      }
    }
    return { claims, activePins };
  }

  async #cleanupAbandonedReservations(
    paths: LedgerPaths,
    activeOwners: Set<string>,
    lock: MutationLock,
    capabilities: StoreCapabilities,
  ): Promise<void> {
    for await (const entry of capabilities.readDir.call(this.#store, paths.reservationsRoot)) {
      if (
        entry.isSymlink === true ||
        !entry.isDirectory ||
        entry.isFile ||
        !OWNER_ID_PATTERN.test(entry.name)
      ) {
        throw new Error("Transformed module reservation ledger contains an unexpected entry");
      }
      const ownerRoot = join(paths.reservationsRoot, entry.name);
      if (!activeOwners.has(entry.name)) {
        await this.#assertMutationLock(paths, lock, capabilities);
        await this.#store.remove(ownerRoot, { recursive: true });
        continue;
      }
      for await (const operation of capabilities.readDir.call(this.#store, ownerRoot)) {
        if (
          operation.isSymlink === true ||
          !operation.isDirectory ||
          operation.isFile ||
          !OWNER_ID_PATTERN.test(operation.name)
        ) {
          throw new Error("Transformed module owner reservation contains an unexpected entry");
        }
        await this.#assertMutationLock(paths, lock, capabilities);
        await this.#store.remove(join(ownerRoot, operation.name), { recursive: true });
      }
    }
  }

  async #collectStoredClaims(
    lifecycleRoot: string,
    paths: LedgerPaths,
    activePins: Map<string, ActivePin>,
    lock: MutationLock,
    capabilities: StoreCapabilities,
  ): Promise<Map<number, StoredClaim>> {
    const claims = new Map<number, StoredClaim>();
    for await (const entry of capabilities.readDir.call(this.#store, paths.claimsRoot)) {
      const match = CLAIM_FILE_NAME_PATTERN.exec(entry.name);
      if (entry.isSymlink === true || !entry.isFile || entry.isDirectory || match === null) {
        throw new Error("Transformed module claim ledger contains an unexpected entry");
      }
      const slot = Number(match[1]);
      validateSlotIndex(slot);
      const stored = await this.#readStoredClaim(
        lifecycleRoot,
        paths,
        slot,
        entry.name,
        match[2]!,
        capabilities,
      );
      const activePin = activePins.get(stored.claimId);
      if (
        activePin !== undefined && activePin.reservationName !== stored.reservationName
      ) {
        throw new Error("Transformed module active pin does not match its artifact claim");
      }

      const artifactStatus = await this.#inspectArtifactMetadata(stored, capabilities);
      if (artifactStatus !== "valid" && activePin === undefined) {
        await this.#assertMutationLock(paths, lock, capabilities);
        await this.#removeClaim(paths, stored, capabilities);
        continue;
      }
      if (claims.has(slot)) {
        throw new Error("Transformed module slot has multiple artifact claims");
      }
      claims.set(
        slot,
        artifactStatus === "valid" ? stored : { ...stored, artifactValid: false },
      );
    }
    return claims;
  }

  async #readStoredClaim(
    lifecycleRoot: string,
    paths: LedgerPaths,
    slot: number,
    claimId: string,
    generationId: string,
    capabilities: StoreCapabilities,
  ): Promise<StoredClaim> {
    const claimPath = join(paths.claimsRoot, claimId);
    const claimBytes = await capabilities.readWithinLimit.call(
      this.#store,
      claimPath,
      CLAIM_MAX_BYTES,
    );
    const claim = decodeClaim(claimBytes);
    if (claim.generationId !== generationId) {
      throw new Error("Transformed module claim generation does not match its ledger entry");
    }
    const componentFile = join(lifecycleRoot, claim.relativeComponentFile);
    const identity = resolveComponentIdentity(componentFile, lifecycleRoot);
    if (identity.relativeComponentFile !== claim.relativeComponentFile) {
      throw new Error("Transformed module claim path is not canonical");
    }
    if (await computeHash(claim.relativeComponentFile) !== claim.componentHash) {
      throw new Error("Transformed module claim path does not match its component hash");
    }
    const reservationName = reservationNameFor(claim);
    if (!RESERVATION_NAME_PATTERN.test(reservationName)) {
      throw new Error("Transformed module claim reservation is invalid");
    }
    return {
      slot,
      claimId,
      claimPath,
      claim,
      reservationName,
      artifactPath: buildTransformedModuleSlotPath(
        componentFile,
        slot,
        claim.contentHash,
        claim.generationId,
      ),
      artifactValid: true,
    };
  }

  async #collectActiveOwners(
    paths: LedgerPaths,
    lock: MutationLock,
    capabilities: StoreCapabilities,
  ): Promise<Set<string>> {
    const activeOwners = new Set<string>();
    for await (const entry of capabilities.readDir.call(this.#store, paths.ownersRoot)) {
      if (
        entry.isSymlink === true ||
        !entry.isDirectory ||
        entry.isFile ||
        !OWNER_ID_PATTERN.test(entry.name)
      ) {
        throw new Error("Transformed module owner ledger contains an unexpected entry");
      }
      if (await this.#isOwnerActive(paths, entry.name, capabilities)) {
        activeOwners.add(entry.name);
      } else {
        await this.#assertMutationLock(paths, lock, capabilities);
        await this.#removeIfPresent(
          join(paths.reservationsRoot, entry.name),
          true,
        );
        await this.#store.remove(join(paths.ownersRoot, entry.name), { recursive: true });
      }
    }
    return activeOwners;
  }

  async #collectActivePins(
    paths: LedgerPaths,
    activeOwners: Set<string>,
    capabilities: StoreCapabilities,
  ): Promise<Map<string, ActivePin>> {
    const pins = new Map<string, ActivePin>();
    for (const ownerId of activeOwners) {
      const pinsRoot = join(paths.ownersRoot, ownerId, PINS_DIRECTORY_NAME);
      for await (const entry of capabilities.readDir.call(this.#store, pinsRoot)) {
        if (
          entry.isSymlink === true ||
          !entry.isFile ||
          entry.isDirectory ||
          !CLAIM_FILE_NAME_PATTERN.test(entry.name)
        ) {
          throw new Error("Transformed module owner pin ledger contains an unexpected entry");
        }
        const value = await capabilities.readWithinLimit.call(
          this.#store,
          join(pinsRoot, entry.name),
          OWNER_FILE_MAX_BYTES,
        );
        let reservationName: string;
        try {
          reservationName = strictTextDecoder.decode(value);
        } catch (cause) {
          throw new TypeError("Transformed module owner pin is not UTF-8", { cause });
        }
        if (!RESERVATION_NAME_PATTERN.test(reservationName)) {
          throw new Error("Transformed module owner pin has an invalid reservation");
        }
        const previousPin = pins.get(entry.name);
        if (
          previousPin !== undefined && previousPin.reservationName !== reservationName
        ) {
          throw new Error("Transformed module owners disagree about an artifact pin");
        }
        const ownerIds = previousPin?.ownerIds ?? new Set<string>();
        ownerIds.add(ownerId);
        pins.set(entry.name, { reservationName, ownerIds });
      }
    }
    return pins;
  }

  async #inspectArtifactMetadata(
    stored: StoredClaim,
    capabilities: StoreCapabilities,
  ): Promise<"valid" | "missing" | "invalid"> {
    let info: TransformedModuleFileInfo;
    try {
      info = await capabilities.stat.call(this.#store, stored.artifactPath);
    } catch (error) {
      if (isNotFoundError(error)) return "missing";
      throw error;
    }
    if (!info.isFile || info.isDirectory || !Number.isSafeInteger(info.size) || info.size < 0) {
      return "invalid";
    }
    if (info.size !== stored.claim.artifactBytes) {
      return "invalid";
    }
    if (info.size > this.#maxArtifactBytes) {
      return "invalid";
    }
    return "valid";
  }

  #firstFreeSlot(claims: Map<number, StoredClaim>): number | undefined {
    for (let slot = 0; slot < this.#maxArtifacts; slot++) {
      if (!claims.has(slot)) return slot;
    }
    return undefined;
  }

  async #publishClaim(
    componentFile: string,
    paths: LedgerPaths,
    slot: number,
    relativeComponentFile: string,
    expected: Uint8Array,
    contentHash: string,
    lock: MutationLock,
    capabilities: StoreCapabilities,
  ): Promise<MaterializedArtifact> {
    const claim: ArtifactClaim = {
      version: CLAIM_FORMAT_VERSION,
      ownerId: lock.ownerId,
      generationId: lock.operationId,
      componentHash: await computeHash(relativeComponentFile),
      relativeComponentFile,
      contentHash,
      artifactBytes: expected.byteLength,
    };
    const reservationName = reservationNameFor(claim);
    const claimId = `${slot}.${lock.operationId}`;
    const claimPath = join(paths.claimsRoot, claimId);
    const artifactPath = buildTransformedModuleSlotPath(
      componentFile,
      slot,
      contentHash,
      lock.operationId,
    );
    const stored = {
      slot,
      claimId,
      claimPath,
      claim,
      reservationName,
      artifactPath,
      artifactValid: true,
    };
    const reservationPath = join(
      paths.reservationsRoot,
      lock.ownerId,
      lock.operationId,
    );
    const temporaryArtifactPath = join(reservationPath, TEMPORARY_ARTIFACT_NAME);
    const temporaryClaimPath = join(reservationPath, TEMPORARY_CLAIM_NAME);
    let claimPublished = false;
    let pinPublished = false;

    try {
      await capabilities.mkdir.call(this.#store, reservationPath);
      await capabilities.createExclusive.call(this.#store, temporaryArtifactPath, expected);
      await capabilities.createExclusive.call(
        this.#store,
        temporaryClaimPath,
        encodeClaim(claim),
      );
      await this.#assertMutationLock(paths, lock, capabilities);
      await capabilities.rename.call(this.#store, temporaryClaimPath, claimPath);
      claimPublished = true;
      await this.#publishClaimArtifact(
        paths,
        temporaryArtifactPath,
        artifactPath,
        expected,
        lock,
        capabilities,
      );
      await this.#assertMutationLock(paths, lock, capabilities);
      await this.#pinClaim(paths, stored, lock.ownerId, capabilities);
      pinPublished = true;
      await this.#removeIfPresent(reservationPath, true);
      return { path: artifactPath, slotRoot: paths.slotRoot, claimId, ownerId: lock.ownerId };
    } catch (creationError) {
      return await this.#cleanupFailedPublication(
        paths,
        stored,
        creationError,
        reservationPath,
        claimPublished,
        pinPublished,
        lock,
        capabilities,
      );
    }
  }

  async #publishClaimArtifact(
    paths: LedgerPaths,
    temporaryArtifactPath: string,
    artifactPath: string,
    expected: Uint8Array,
    lock: MutationLock,
    capabilities: StoreCapabilities,
  ): Promise<void> {
    await this.#assertMutationLock(paths, lock, capabilities);
    try {
      await capabilities.rename.call(this.#store, temporaryArtifactPath, artifactPath);
    } catch (publicationError) {
      try {
        await this.#verifyExisting(artifactPath, expected, capabilities);
      } catch (verificationError) {
        throw new AggregateError(
          [publicationError, verificationError],
          "Transformed module publication failed with an unverifiable target",
        );
      }
    }
  }

  async #cleanupFailedPublication(
    paths: LedgerPaths,
    stored: StoredClaim,
    creationError: unknown,
    reservationPath: string,
    claimPublished: boolean,
    pinPublished: boolean,
    lock: MutationLock,
    capabilities: StoreCapabilities,
  ): Promise<never> {
    try {
      // A stale publisher may resume after another owner has fenced and
      // replaced its slot. Only the current lock owner may clean the claim.
      await this.#assertMutationLock(paths, lock, capabilities);
      if (claimPublished) {
        if (pinPublished) await this.#removePin(paths, lock.ownerId, stored.claimId);
        await this.#removeClaim(paths, stored, capabilities);
      } else {
        await this.#removeIfPresent(reservationPath, true);
      }
    } catch (cleanupError) {
      if (isNotFoundError(cleanupError)) throw creationError;
      throw new AggregateError(
        [creationError, cleanupError],
        "Transformed module creation and claim cleanup both failed",
      );
    }
    throw creationError;
  }

  async #removeIfPresent(path: string, recursive: boolean): Promise<void> {
    try {
      await this.#store.remove(path, { recursive });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  async #pinClaim(
    paths: LedgerPaths,
    stored: StoredClaim,
    ownerId: string,
    capabilities: StoreCapabilities,
  ): Promise<void> {
    const pinPath = join(
      paths.ownersRoot,
      ownerId,
      PINS_DIRECTORY_NAME,
      stored.claimId,
    );
    const expected = textEncoder.encode(stored.reservationName);
    try {
      await capabilities.createExclusive.call(this.#store, pinPath, expected);
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        try {
          await this.#store.remove(pinPath);
        } catch (cleanupError) {
          if (!isNotFoundError(cleanupError)) {
            throw new AggregateError(
              [error, cleanupError],
              "Transformed module pin creation and cleanup both failed",
            );
          }
        }
        throw error;
      }
      const existing = await capabilities.readWithinLimit.call(
        this.#store,
        pinPath,
        OWNER_FILE_MAX_BYTES,
      );
      if (!equalBytes(existing, expected)) {
        await this.#removePin(paths, ownerId, stored.claimId);
        throw new Error("Transformed module owner attempted to replace a live slot pin");
      }
    }
  }

  async #removePin(paths: LedgerPaths, ownerId: string, claimId: string): Promise<void> {
    await this.#removeIfPresent(
      join(
        paths.ownersRoot,
        ownerId,
        PINS_DIRECTORY_NAME,
        claimId,
      ),
      false,
    );
  }

  async #removeClaim(
    paths: LedgerPaths,
    stored: StoredClaim,
    _capabilities: StoreCapabilities,
  ): Promise<void> {
    const failures: unknown[] = [];
    const reservationPath = join(
      paths.reservationsRoot,
      stored.claim.ownerId,
      stored.claim.generationId,
    );
    try {
      await this.#store.remove(reservationPath, { recursive: true });
    } catch (error) {
      if (!isNotFoundError(error)) failures.push(error);
    }

    try {
      await this.#store.remove(stored.artifactPath);
    } catch (error) {
      if (!isNotFoundError(error)) {
        failures.push(error);
        throw new AggregateError(
          failures,
          "Transformed module artifact cleanup failed; its claim was retained",
        );
      }
    }

    try {
      await this.#store.remove(stored.claimPath);
    } catch (error) {
      if (!isNotFoundError(error)) failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Transformed module claim cleanup failed");
    }
  }

  async #verifyExisting(
    path: string,
    expected: Uint8Array,
    capabilities: StoreCapabilities,
  ): Promise<void> {
    const byteLimit = Math.max(1, expected.byteLength);
    const existing = copyFixedUint8ArrayWithinLimit(
      await capabilities.readWithinLimit.call(this.#store, path, byteLimit),
      byteLimit,
      "Existing transformed module",
    );
    if (!equalBytes(existing, expected)) {
      throw new Error("Existing content-addressed transformed module does not match its digest");
    }
  }

  #claimKey(slotRoot: string, claimId: string): string {
    return `${slotRoot}\0${claimId}`;
  }

  #finishImportAttempt(claimKey: string): void {
    const pending = this.#pendingImports.get(claimKey);
    if (pending === undefined || pending <= 1) {
      this.#pendingImports.delete(claimKey);
    } else {
      this.#pendingImports.set(claimKey, pending - 1);
    }
  }

  async #releaseRejectedClaimPin(
    materialized: MaterializedArtifact,
    claimKey: string,
  ): Promise<void> {
    if (this.#evictedPendingClaims.has(claimKey)) {
      if (!this.#pendingImports.has(claimKey)) this.#evictedPendingClaims.delete(claimKey);
      return;
    }
    if (this.#pendingImports.has(claimKey) || this.#successfulClaims.has(claimKey)) return;

    const capabilities = this.#requireCapabilities();
    const ownerId = await this.#renewLease(materialized.slotRoot, capabilities);
    await this.#withMutationLock(materialized.slotRoot, ownerId, capabilities, async () => {
      if (
        this.#pendingImports.has(claimKey) ||
        this.#successfulClaims.has(claimKey) ||
        this.#evictedPendingClaims.has(claimKey)
      ) {
        return;
      }
      await this.#removeIfPresent(
        join(
          materialized.slotRoot,
          OWNERS_DIRECTORY_NAME,
          materialized.ownerId,
          PINS_DIRECTORY_NAME,
          materialized.claimId,
        ),
        false,
      );
    });
  }

  #readRetryAttempt(path: string): number {
    const attempt = this.#retryAttempts.get(path) ?? 0;
    if (attempt > 0) {
      this.#retryAttempts.delete(path);
      this.#retryAttempts.set(path, attempt);
    }
    return attempt;
  }

  #rememberRetryAttempt(path: string, attempt: number): void {
    this.#retryAttempts.delete(path);
    this.#retryAttempts.set(path, attempt);
    while (this.#retryAttempts.size > this.#maxArtifacts) {
      const oldest = this.#retryAttempts.keys().next().value;
      if (oldest === undefined) break;
      this.#retryAttempts.delete(oldest);
    }
  }
}
