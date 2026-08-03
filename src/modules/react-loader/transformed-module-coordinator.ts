import { extname, isAbsolute, join, relative, toFileUrl } from "#veryfront/compat/path/index.ts";
import { isAlreadyExistsError, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { copyFixedUint8ArrayWithinLimit } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import { COMPONENT_LOADER_MAX_ENTRIES } from "#veryfront/utils/constants/cache.ts";
import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const SLOT_NAME_PATTERN = /^(0|[1-9][0-9]*)$/;
const RESERVATION_NAME_PATTERN = /^[a-f0-9]{64}\.[a-f0-9]{64}$/;
const SLOT_DIRECTORY_NAME = ".transformed-module-slots-v1";
const TEMPORARY_ARTIFACT_NAME = "module.tmp";
const textEncoder = new TextEncoder();

interface TransformedModuleDirectoryEntry {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymlink?: boolean;
}

export interface TransformedModuleFileStore {
  createFileBytesExclusive?(path: string, content: Uint8Array): Promise<void>;
  readFileBytesWithinLimit?(path: string, byteLimit: number): Promise<Uint8Array>;
  rename?(from: string, to: string): Promise<void>;
  mkdir?(path: string, options?: { recursive?: boolean }): Promise<void>;
  readDir?(path: string): AsyncIterable<TransformedModuleDirectoryEntry>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
}

export type TransformedModuleImporter = (
  specifier: string,
) => Promise<Record<string, unknown>>;

interface TransformedModuleCoordinatorOptions {
  maxArtifacts?: number;
  maxArtifactBytes?: number;
}

interface SlotInventory {
  readonly matchingSlot?: number;
  readonly freeSlot?: number;
  readonly occupiedSlots: number;
  readonly hasIncompleteReservation: boolean;
}

function validateContentHash(contentHash: string): void {
  if (!CONTENT_HASH_PATTERN.test(contentHash)) {
    throw new TypeError("Transformed module content hash must be a lowercase SHA-256 digest");
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
): string {
  if (componentFile.length === 0) {
    throw new TypeError("Transformed module path must not be empty");
  }
  validateSlotIndex(slot);
  validateContentHash(contentHash);

  const extension = extname(componentFile);
  const stem = extension.length > 0 ? componentFile.slice(0, -extension.length) : componentFile;
  return `${stem}.vf-slot-${slot}.${contentHash}${extension || ".js"}`;
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

/**
 * Publishes immutable transformed modules through a persistent, bounded slot ledger.
 * Slots are never recycled while their lifecycle root exists: a loaded module may
 * resolve a relative dynamic import long after its initial import promise settles.
 */
export class TransformedModuleCoordinator {
  readonly #store: TransformedModuleFileStore;
  readonly #importer: TransformedModuleImporter;
  readonly #maxArtifacts: number;
  readonly #maxArtifactBytes: number;
  readonly #pendingMaterializations = new Map<string, Promise<string>>();
  readonly #retryAttempts = new Map<string, number>();

  constructor(
    store: TransformedModuleFileStore,
    importer: TransformedModuleImporter = (specifier) => import(specifier),
    options: TransformedModuleCoordinatorOptions = {},
  ) {
    const maxArtifacts = options.maxArtifacts ?? COMPONENT_LOADER_MAX_ENTRIES;
    const maxArtifactBytes = options.maxArtifactBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    validatePositiveSafeInteger(maxArtifacts, "Transformed module artifact limit");
    validatePositiveSafeInteger(maxArtifactBytes, "Transformed module byte limit");

    this.#store = store;
    this.#importer = importer;
    this.#maxArtifacts = maxArtifacts;
    this.#maxArtifactBytes = maxArtifactBytes;
  }

  async importTransformedModule(
    componentFile: string,
    transformedCode: string,
    contentHash: string,
    lifecycleRoot: string,
  ): Promise<Record<string, unknown>> {
    validateContentHash(contentHash);
    const { relativeComponentFile, slotRoot } = resolveComponentIdentity(
      componentFile,
      lifecycleRoot,
    );
    const expected = encodeUtf8WithinLimit(transformedCode, this.#maxArtifactBytes);
    const materializationKey = `${slotRoot}\0${relativeComponentFile}\0${contentHash}`;
    const versionedFile = await this.#materialize(
      materializationKey,
      componentFile,
      slotRoot,
      relativeComponentFile,
      expected,
      contentHash,
    );

    const retryAttempt = this.#readRetryAttempt(versionedFile);
    try {
      return await this.#importer(
        buildTransformedModuleSpecifier(versionedFile, retryAttempt),
      );
    } catch (error) {
      if ((this.#retryAttempts.get(versionedFile) ?? 0) === retryAttempt) {
        this.#rememberRetryAttempt(versionedFile, retryAttempt + 1);
      }
      throw error;
    }
  }

  async #materialize(
    materializationKey: string,
    componentFile: string,
    slotRoot: string,
    relativeComponentFile: string,
    expected: Uint8Array,
    contentHash: string,
  ): Promise<string> {
    const pendingPromise = this.#pendingMaterializations.get(materializationKey);
    if (pendingPromise) return await pendingPromise;

    const operationPromise = this.#findOrCreateArtifact(
      componentFile,
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
    slotRoot: string,
    relativeComponentFile: string,
    expected: Uint8Array,
    contentHash: string,
  ): Promise<string> {
    const reservationName = `${await computeHash(relativeComponentFile)}.${contentHash}`;
    const createExclusive = this.#store.createFileBytesExclusive;
    const readWithinLimit = this.#store.readFileBytesWithinLimit;
    const rename = this.#store.rename;
    const mkdir = this.#store.mkdir;
    const readDir = this.#store.readDir;
    if (typeof createExclusive !== "function") {
      throw new TypeError("Transformed modules require exclusive file creation");
    }
    if (typeof readWithinLimit !== "function") {
      throw new TypeError("Transformed modules require exact reads to verify existing content");
    }
    if (typeof rename !== "function") {
      throw new TypeError("Transformed modules require atomic file publication");
    }
    if (typeof mkdir !== "function" || typeof readDir !== "function") {
      throw new TypeError("Transformed modules require persistent slot-directory operations");
    }

    await mkdir.call(this.#store, slotRoot, { recursive: true });
    for (let attempt = 0; attempt <= this.#maxArtifacts; attempt++) {
      const inventory = await this.#inventorySlots(slotRoot, reservationName);
      if (inventory.matchingSlot !== undefined) {
        const existingPath = buildTransformedModuleSlotPath(
          componentFile,
          inventory.matchingSlot,
          contentHash,
        );
        await this.#verifyExisting(existingPath, expected);
        return existingPath;
      }
      if (inventory.hasIncompleteReservation) {
        throw new Error("A transformed module slot reservation is incomplete");
      }
      if (
        inventory.freeSlot === undefined ||
        inventory.occupiedSlots >= this.#maxArtifacts
      ) {
        throw new RangeError(
          `Transformed module artifact limit of ${this.#maxArtifacts} has been reached`,
        );
      }

      const slotPath = join(slotRoot, String(inventory.freeSlot));
      try {
        await mkdir.call(this.#store, slotPath);
      } catch (error) {
        if (isAlreadyExistsError(error)) continue;
        throw error;
      }

      return await this.#publishReservedArtifact(
        componentFile,
        slotPath,
        inventory.freeSlot,
        reservationName,
        expected,
        contentHash,
        createExclusive,
        mkdir,
        rename,
      );
    }

    throw new Error("Transformed module slot reservation did not converge");
  }

  async #inventorySlots(
    slotRoot: string,
    reservationName: string,
  ): Promise<SlotInventory> {
    const readDir = this.#store.readDir!;
    const occupied = new Set<number>();
    let matchingSlot: number | undefined;
    let hasIncompleteReservation = false;

    for await (const entry of readDir.call(this.#store, slotRoot)) {
      if (
        entry.isSymlink === true ||
        !entry.isDirectory ||
        !SLOT_NAME_PATTERN.test(entry.name)
      ) {
        throw new Error("Transformed module slot ledger contains an unexpected entry");
      }
      const slot = Number(entry.name);
      if (!Number.isSafeInteger(slot)) {
        throw new Error("Transformed module slot ledger contains an invalid slot index");
      }
      occupied.add(slot);

      const reservationPath = join(slotRoot, entry.name);
      let reservationCount = 0;
      for await (const reservation of readDir.call(this.#store, reservationPath)) {
        if (
          reservation.isSymlink === true ||
          !reservation.isDirectory ||
          !RESERVATION_NAME_PATTERN.test(reservation.name)
        ) {
          throw new Error("Transformed module slot contains an invalid reservation");
        }
        reservationCount++;
        if (reservation.name === reservationName) {
          if (matchingSlot !== undefined) {
            throw new Error("Transformed module reservation occupies multiple slots");
          }
          matchingSlot = slot;
        }
      }
      if (reservationCount === 0) hasIncompleteReservation = true;
      if (reservationCount > 1) {
        throw new Error("Transformed module slot contains multiple reservations");
      }
    }

    let freeSlot: number | undefined;
    for (let slot = 0; slot < this.#maxArtifacts; slot++) {
      if (!occupied.has(slot)) {
        freeSlot = slot;
        break;
      }
    }
    return {
      matchingSlot,
      freeSlot,
      occupiedSlots: occupied.size,
      hasIncompleteReservation,
    };
  }

  async #publishReservedArtifact(
    componentFile: string,
    slotPath: string,
    slot: number,
    reservationName: string,
    expected: Uint8Array,
    contentHash: string,
    createExclusive: NonNullable<TransformedModuleFileStore["createFileBytesExclusive"]>,
    mkdir: NonNullable<TransformedModuleFileStore["mkdir"]>,
    rename: NonNullable<TransformedModuleFileStore["rename"]>,
  ): Promise<string> {
    const reservationPath = join(slotPath, reservationName);
    const temporaryPath = join(reservationPath, TEMPORARY_ARTIFACT_NAME);
    const artifactPath = buildTransformedModuleSlotPath(componentFile, slot, contentHash);

    try {
      await mkdir.call(this.#store, reservationPath);
      await createExclusive.call(this.#store, temporaryPath, expected);
    } catch (error) {
      await this.#removeFailedReservation(slotPath, error);
      throw error;
    }

    try {
      await rename.call(this.#store, temporaryPath, artifactPath);
      return artifactPath;
    } catch (publicationError) {
      try {
        await this.#verifyExisting(artifactPath, expected);
        return artifactPath;
      } catch (verificationError) {
        if (!isNotFoundError(verificationError)) {
          throw new AggregateError(
            [publicationError, verificationError],
            "Transformed module publication failed with an unverifiable target",
          );
        }
        await this.#removeFailedReservation(slotPath, publicationError);
        throw publicationError;
      }
    }
  }

  async #verifyExisting(path: string, expected: Uint8Array): Promise<void> {
    const readWithinLimit = this.#store.readFileBytesWithinLimit!;
    const byteLimit = Math.max(1, expected.byteLength);
    const existing = copyFixedUint8ArrayWithinLimit(
      await readWithinLimit.call(this.#store, path, byteLimit),
      byteLimit,
      "Existing transformed module",
    );
    if (!equalBytes(existing, expected)) {
      throw new Error("Existing content-addressed transformed module does not match its digest");
    }
  }

  async #removeFailedReservation(slotPath: string, creationError: unknown): Promise<void> {
    try {
      await this.#store.remove(slotPath, { recursive: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [creationError, cleanupError],
        "Transformed module creation and reservation cleanup both failed",
      );
    }
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
