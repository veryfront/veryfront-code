import { extname, toFileUrl } from "#veryfront/compat/path/index.ts";
import { isAlreadyExistsError, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { copyFixedUint8ArrayWithinLimit } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import { COMPONENT_LOADER_MAX_ENTRIES } from "#veryfront/utils/constants/cache.ts";

const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const NAMESPACE_PATTERN = /^[A-Za-z0-9_-]+$/;
const textEncoder = new TextEncoder();

export interface TransformedModuleFileStore {
  createFileBytesExclusive?(path: string, content: Uint8Array): Promise<void>;
  readFileBytesWithinLimit?(path: string, byteLimit: number): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
}

export type TransformedModuleImporter = (
  specifier: string,
) => Promise<Record<string, unknown>>;

interface TransformedModuleCoordinatorOptions {
  namespace?: string;
  maxTrackedVersions?: number;
}

function validateContentHash(contentHash: string): void {
  if (!CONTENT_HASH_PATTERN.test(contentHash)) {
    throw new TypeError("Transformed module content hash must be a lowercase SHA-256 digest");
  }
}

function validateNamespace(namespace: string): void {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new TypeError("Transformed module namespace contains invalid path characters");
  }
}

function defaultNamespace(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function buildContentAddressedModulePath(
  componentFile: string,
  contentHash: string,
  namespace: string,
): string {
  if (componentFile.length === 0) {
    throw new TypeError("Transformed module path must not be empty");
  }
  validateContentHash(contentHash);
  validateNamespace(namespace);

  const extension = extname(componentFile);
  const stem = extension.length > 0 ? componentFile.slice(0, -extension.length) : componentFile;
  return `${stem}.${namespace}.${contentHash}${extension || ".js"}`;
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export class TransformedModuleCoordinator {
  readonly #store: TransformedModuleFileStore;
  readonly #importer: TransformedModuleImporter;
  readonly #namespace: string;
  readonly #maxTrackedVersions: number;
  readonly #pendingMaterializations = new Map<string, Promise<void>>();
  readonly #retryAttempts = new Map<string, number>();

  constructor(
    store: TransformedModuleFileStore,
    importer: TransformedModuleImporter = (specifier) => import(specifier),
    options: TransformedModuleCoordinatorOptions = {},
  ) {
    const namespace = options.namespace ?? defaultNamespace();
    const maxTrackedVersions = options.maxTrackedVersions ?? COMPONENT_LOADER_MAX_ENTRIES;
    validateNamespace(namespace);
    if (!Number.isSafeInteger(maxTrackedVersions) || maxTrackedVersions <= 0) {
      throw new RangeError("Transformed module version limit must be a positive safe integer");
    }

    this.#store = store;
    this.#importer = importer;
    this.#namespace = namespace;
    this.#maxTrackedVersions = maxTrackedVersions;
  }

  async importTransformedModule(
    componentFile: string,
    transformedCode: string,
    contentHash: string,
  ): Promise<Record<string, unknown>> {
    const versionedFile = buildContentAddressedModulePath(
      componentFile,
      contentHash,
      this.#namespace,
    );
    await this.#materialize(versionedFile, textEncoder.encode(transformedCode));

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

  async #materialize(path: string, expected: Uint8Array): Promise<void> {
    const pending = this.#pendingMaterializations.get(path);
    if (pending) return await pending;

    const operation = this.#createOrVerify(path, expected);
    this.#pendingMaterializations.set(path, operation);
    try {
      await operation;
    } finally {
      if (this.#pendingMaterializations.get(path) === operation) {
        this.#pendingMaterializations.delete(path);
      }
    }
  }

  async #createOrVerify(path: string, expected: Uint8Array): Promise<void> {
    const createExclusive = this.#store.createFileBytesExclusive;
    if (typeof createExclusive !== "function") {
      throw new TypeError("Transformed modules require exclusive file creation");
    }

    try {
      await createExclusive.call(this.#store, path, expected);
      return;
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        await this.#verifyExisting(path, expected);
        return;
      }
      await this.#removePartialFile(path, error);
      throw error;
    }
  }

  async #verifyExisting(path: string, expected: Uint8Array): Promise<void> {
    const readWithinLimit = this.#store.readFileBytesWithinLimit;
    if (typeof readWithinLimit !== "function") {
      throw new TypeError("Transformed modules require exact reads to verify existing content");
    }
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

  async #removePartialFile(path: string, createError: unknown): Promise<void> {
    try {
      await this.#store.remove(path);
    } catch (cleanupError) {
      if (isNotFoundError(cleanupError)) return;
      throw new AggregateError(
        [createError, cleanupError],
        "Transformed module creation and partial-file cleanup both failed",
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
    while (this.#retryAttempts.size > this.#maxTrackedVersions) {
      const oldest = this.#retryAttempts.keys().next().value;
      if (oldest === undefined) break;
      this.#retryAttempts.delete(oldest);
    }
  }
}
