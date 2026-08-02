import { extname } from "#veryfront/compat/path/index.ts";
import { walk } from "#veryfront/compat/std/fs.ts";
import {
  createFileSystem,
  getPathIdentity,
  isNotFoundError,
  type PathIdentity,
  realPath,
} from "#veryfront/platform/compat/fs.ts";
import { BUILD_FAILED } from "#veryfront/errors";
import { DEFAULT_BUILD_CONCURRENCY, serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("build-compression");
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".map",
  ".md",
  ".mjs",
  ".cjs",
  ".svg",
  ".txt",
  ".webmanifest",
  ".xml",
]);

export interface CompressionStats {
  files: number;
  sourceBytes: number;
  compressedBytes: number;
}

interface CompressionResult {
  written: boolean;
  bytes: number;
  artifact?: CompressionArtifact;
}

interface CompressionSource {
  path: string;
  size: number;
  modifiedAtMilliseconds: number | null;
  guard: StablePathGuard;
  directoryGuard: StablePathGuard;
}

interface CompressionArtifact {
  path: string;
  identity: PathIdentity;
}

interface StablePathGuard {
  path: string;
  canonicalPath: string;
  identity: PathIdentity;
  kind: "file" | "directory";
}

function shouldCompress(name: string): boolean {
  return name === "_redirects" || COMPRESSIBLE_EXTENSIONS.has(extname(name).toLowerCase());
}

function identitiesMatch(left: PathIdentity, right: PathIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

async function assertPathIdentity(
  path: string,
  expected: PathIdentity,
  label: string,
): Promise<void> {
  const actual = await getPathIdentity(path);
  if (!actual || !identitiesMatch(actual, expected)) {
    throw BUILD_FAILED.create({
      detail: `${label} changed while build outputs were being compressed: ${path}`,
    });
  }
}

async function capturePathGuard(
  path: string,
  kind: StablePathGuard["kind"],
): Promise<StablePathGuard> {
  const fs = createFileSystem();
  if (!fs.lstat) {
    throw BUILD_FAILED.create({
      detail: `Build compression requires symbolic-link-aware filesystem access: ${path}`,
    });
  }
  const info = await fs.lstat(path);
  if (
    info.isSymlink ||
    (kind === "file" ? !info.isFile : !info.isDirectory)
  ) {
    throw BUILD_FAILED.create({
      detail: `Expected a stable ${kind} while preparing compression: ${path}`,
    });
  }
  const [canonicalPath, identity] = await Promise.all([
    realPath(path),
    getPathIdentity(path),
  ]);
  if (!identity) {
    throw BUILD_FAILED.create({
      detail: `Build compression requires stable filesystem identity: ${path}`,
    });
  }
  return { path, canonicalPath, identity, kind };
}

async function assertPathGuard(guard: StablePathGuard, label: string): Promise<void> {
  const fs = createFileSystem();
  if (!fs.lstat) {
    throw BUILD_FAILED.create({
      detail: `Build compression requires symbolic-link-aware filesystem access: ${guard.path}`,
    });
  }

  await assertPathIdentity(guard.path, guard.identity, label);
  const info = await fs.lstat(guard.path);
  if (
    info.isSymlink ||
    (guard.kind === "file" ? !info.isFile : !info.isDirectory)
  ) {
    throw BUILD_FAILED.create({
      detail: `${label} changed type while build outputs were being compressed: ${guard.path}`,
    });
  }
  const canonicalPath = await realPath(guard.path);
  if (canonicalPath !== guard.canonicalPath) {
    throw BUILD_FAILED.create({
      detail: `${label} changed location while build outputs were being compressed: ${guard.path}`,
    });
  }
  await assertPathIdentity(guard.path, guard.identity, label);
}

async function assertCompressionGuards(
  source: CompressionSource,
  outputGuard: StablePathGuard,
): Promise<void> {
  await assertPathGuard(outputGuard, "Build output directory");
  await assertPathGuard(source.directoryGuard, "Compression source directory");
  await assertPathGuard(source.guard, "Compression source");
}

async function removeOwnedArtifact(artifact: CompressionArtifact): Promise<void> {
  let actual: PathIdentity | undefined;
  try {
    actual = await getPathIdentity(artifact.path);
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }

  if (!actual || !identitiesMatch(actual, artifact.identity)) {
    throw BUILD_FAILED.create({
      detail: `Refusing to remove a compression artifact whose identity changed: ${artifact.path}`,
    });
  }
  await createFileSystem().remove(artifact.path);
}

async function cleanupArtifacts(
  artifacts: readonly CompressionArtifact[],
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (let index = artifacts.length - 1; index >= 0; index--) {
    const artifact = artifacts[index]!;
    try {
      await removeOwnedArtifact(artifact);
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

function compressionFailure(
  detail: string,
  primary: unknown,
  cleanupFailures: readonly unknown[],
): Error {
  const cause = cleanupFailures.length === 0 ? primary : new AggregateError(
    [primary, ...cleanupFailures],
    "Compression failed and artifact cleanup was incomplete",
  );
  return BUILD_FAILED.create({ detail, cause });
}

function nativeIdentity(info: { dev: number | bigint; ino: number | bigint }): PathIdentity {
  return { device: String(info.dev), inode: String(info.ino) };
}

function sourceSnapshotMatches(
  before: {
    dev: bigint;
    ino: bigint;
    size: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
  },
  after: {
    dev: bigint;
    ino: bigint;
    size: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
  },
): boolean {
  return before.dev === after.dev && before.ino === after.ino &&
    before.size === after.size && before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs;
}

function contentSnapshotMatches(
  before: {
    dev: bigint;
    ino: bigint;
    size: bigint;
    mtimeNs: bigint;
  },
  after: {
    dev: bigint;
    ino: bigint;
    size: bigint;
    mtimeNs: bigint;
  },
): boolean {
  return before.dev === after.dev && before.ino === after.ino &&
    before.size === after.size && before.mtimeNs === after.mtimeNs;
}

function isCanonicalDescendant(
  root: string,
  candidate: string,
  caseInsensitive: boolean,
): boolean {
  const normalize = (path: string): string => {
    let normalized = path.replaceAll("\\", "/");
    if (normalized.length > 1 && !/^[A-Za-z]:\/$/.test(normalized)) {
      normalized = normalized.replace(/\/+$/, "");
    }
    return caseInsensitive ? normalized.toLowerCase() : normalized;
  };
  const rootPath = normalize(root);
  const candidatePath = normalize(candidate);
  return candidatePath === rootPath ||
    candidatePath.startsWith(rootPath.endsWith("/") ? rootPath : `${rootPath}/`);
}

async function compressFile(
  source: CompressionSource,
  outputGuard: StablePathGuard,
  format: "gzip" | "brotli",
): Promise<CompressionResult> {
  const { path: sourcePath, size: sourceSize } = source;
  const suffix = format === "gzip" ? ".gz" : ".br";
  const destinationPath = `${sourcePath}${suffix}`;
  const temporaryPath = `${destinationPath}.tmp-${crypto.randomUUID()}`;
  const fs = createFileSystem();

  if (await fs.exists(destinationPath)) {
    throw BUILD_FAILED.create({
      detail: `Compression output already exists: ${destinationPath}`,
    });
  }

  await assertCompressionGuards(source, outputGuard);

  const nodeFs = await import("node:fs");
  const nodeFsPromises = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const { Transform } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  const zlib = await import("node:zlib");
  const transform = format === "gzip" ? zlib.createGzip({ level: 9 }) : zlib.createBrotliCompress({
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 6,
    },
  });

  const noFollow = nodeFs.constants.O_NOFOLLOW;
  let sourceHandle: Awaited<ReturnType<typeof nodeFsPromises.open>> | undefined;
  let temporaryHandle: Awaited<ReturnType<typeof nodeFsPromises.open>> | undefined;
  let temporaryArtifact: CompressionArtifact | undefined;
  let destinationArtifact: CompressionArtifact | undefined;

  try {
    sourceHandle = await nodeFsPromises.open(
      sourcePath,
      typeof noFollow === "number" ? nodeFs.constants.O_RDONLY | noFollow : "r",
    );
    const openedInfo = await sourceHandle.stat({ bigint: true });
    const openedIdentity = nativeIdentity(openedInfo);
    if (
      !identitiesMatch(openedIdentity, source.guard.identity) ||
      Number(openedInfo.size) !== sourceSize ||
      (source.modifiedAtMilliseconds !== null &&
        Math.abs(
            Math.trunc(Number(openedInfo.mtimeMs)) - source.modifiedAtMilliseconds,
          ) > 1)
    ) {
      throw BUILD_FAILED.create({
        detail: `Compression source changed before it could be opened safely: ${sourcePath}`,
      });
    }
    await assertCompressionGuards(source, outputGuard);

    temporaryHandle = await nodeFsPromises.open(temporaryPath, "wx");
    const temporaryInfo = await temporaryHandle.stat({ bigint: true });
    temporaryArtifact = {
      path: temporaryPath,
      identity: nativeIdentity(temporaryInfo),
    };
    const expectedHash = createHash("sha256");
    const hashTap = new Transform({
      transform(chunk, _encoding, callback) {
        expectedHash.update(chunk);
        callback(null, chunk);
      },
    });

    await pipeline(
      sourceHandle.createReadStream({ autoClose: false }),
      transform,
      hashTap,
      temporaryHandle.createWriteStream(),
    );
    const expectedDigest = expectedHash.digest("hex");
    // The writable owns and closes its file handle on completion. Deno's Node
    // compatibility layer does not settle pipeline() for an autoClose:false
    // writable, so subsequent validation reopens the path and verifies the
    // originally captured native identity.
    temporaryHandle = undefined;

    const [sourceAfter, temporaryAfter] = await Promise.all([
      sourceHandle.stat({ bigint: true }),
      nodeFsPromises.lstat(temporaryPath, { bigint: true }),
    ]);
    if (!sourceSnapshotMatches(openedInfo, sourceAfter)) {
      throw BUILD_FAILED.create({
        detail: `Compression source changed while it was being read: ${sourcePath}`,
      });
    }
    if (!identitiesMatch(nativeIdentity(temporaryAfter), temporaryArtifact.identity)) {
      throw BUILD_FAILED.create({
        detail: `Compression temporary file changed while it was being written: ${temporaryPath}`,
      });
    }
    await assertCompressionGuards(source, outputGuard);

    const compressedSize = Number(temporaryAfter.size);
    if (compressedSize >= sourceSize) {
      await removeOwnedArtifact(temporaryArtifact);
      temporaryArtifact = undefined;
      await sourceHandle.close();
      sourceHandle = undefined;
      return { written: false, bytes: 0 };
    }

    // Hard-link promotion is an atomic create-if-absent operation. Unlike
    // rename(), it cannot silently replace a sidecar created concurrently.
    temporaryHandle = await nodeFsPromises.open(
      temporaryPath,
      typeof noFollow === "number" ? nodeFs.constants.O_RDONLY | noFollow : "r",
    );
    const promotionInfo = await temporaryHandle.stat({ bigint: true });
    if (
      !identitiesMatch(nativeIdentity(promotionInfo), temporaryArtifact.identity) ||
      !sourceSnapshotMatches(temporaryAfter, promotionInfo)
    ) {
      throw BUILD_FAILED.create({
        detail: `Compression temporary file changed before promotion: ${temporaryPath}`,
      });
    }
    const actualHash = createHash("sha256");
    for await (const chunk of temporaryHandle.createReadStream({ autoClose: false })) {
      actualHash.update(chunk);
    }
    const promotionAfterHash = await temporaryHandle.stat({ bigint: true });
    if (
      !sourceSnapshotMatches(promotionInfo, promotionAfterHash) ||
      actualHash.digest("hex") !== expectedDigest
    ) {
      throw BUILD_FAILED.create({
        detail: `Compression temporary content changed before promotion: ${temporaryPath}`,
      });
    }
    const sourceBeforePromotion = await sourceHandle.stat({ bigint: true });
    if (!sourceSnapshotMatches(openedInfo, sourceBeforePromotion)) {
      throw BUILD_FAILED.create({
        detail: `Compression source changed before output promotion: ${sourcePath}`,
      });
    }
    await assertPathIdentity(temporaryPath, temporaryArtifact.identity, "Compression temporary");
    await assertCompressionGuards(source, outputGuard);
    await nodeFsPromises.link(temporaryPath, destinationPath);
    destinationArtifact = {
      path: destinationPath,
      identity: temporaryArtifact.identity,
    };
    await assertPathIdentity(destinationPath, destinationArtifact.identity, "Compression output");
    const promotedInfo = await nodeFsPromises.lstat(destinationPath, { bigint: true });
    if (!contentSnapshotMatches(promotionAfterHash, promotedInfo)) {
      throw BUILD_FAILED.create({
        detail: `Compression output content changed during promotion: ${destinationPath}`,
      });
    }
    const sourceAfterPromotion = await sourceHandle.stat({ bigint: true });
    if (!sourceSnapshotMatches(openedInfo, sourceAfterPromotion)) {
      throw BUILD_FAILED.create({
        detail: `Compression source changed during output promotion: ${sourcePath}`,
      });
    }
    await assertCompressionGuards(source, outputGuard);
    const promotedBeforeCleanup = await nodeFsPromises.lstat(destinationPath, { bigint: true });
    if (!sourceSnapshotMatches(promotedInfo, promotedBeforeCleanup)) {
      throw BUILD_FAILED.create({
        detail: `Compression output changed before temporary cleanup: ${destinationPath}`,
      });
    }
    await temporaryHandle.close();
    temporaryHandle = undefined;
    await removeOwnedArtifact(temporaryArtifact);
    temporaryArtifact = undefined;
    await sourceHandle.close();
    sourceHandle = undefined;
    return {
      written: true,
      bytes: compressedSize,
      artifact: destinationArtifact,
    };
  } catch (error) {
    const closeFailures: unknown[] = [];
    for (const handle of [temporaryHandle, sourceHandle]) {
      if (!handle) continue;
      try {
        await handle.close();
      } catch (closeError) {
        if ((closeError as NodeJS.ErrnoException)?.code !== "EBADF") {
          closeFailures.push(closeError);
        }
      }
    }
    temporaryHandle = undefined;
    sourceHandle = undefined;
    const cleanupFailures = await cleanupArtifacts(
      [temporaryArtifact, destinationArtifact].filter(
        (artifact): artifact is CompressionArtifact => artifact !== undefined,
      ),
    );
    throw compressionFailure(
      `Failed to create ${format} output for ${sourcePath}`,
      error,
      [...closeFailures, ...cleanupFailures],
    );
  } finally {
    await Promise.allSettled([
      sourceHandle?.close(),
      temporaryHandle?.close(),
    ]);
  }
}

export async function compressBuildOutputs(
  outputDir: string,
  enabled: boolean,
  dryRun: boolean,
): Promise<CompressionStats> {
  const stats: CompressionStats = {
    files: 0,
    sourceBytes: 0,
    compressedBytes: 0,
  };
  if (!enabled || dryRun) return stats;

  const { dirname: nativeDirname, sep: nativeSeparator } = await import("node:path");
  const fs = createFileSystem();
  if (!fs.lstat) {
    throw BUILD_FAILED.create({
      detail: "Build compression requires symbolic-link-aware filesystem access",
    });
  }
  const outputInfo = await fs.lstat(outputDir);
  if (outputInfo.isSymlink) {
    throw BUILD_FAILED.create({
      detail: `Refusing to compress symbolic link in build output: ${outputDir}`,
    });
  }
  const outputGuard = await capturePathGuard(outputDir, "directory");

  const sources: CompressionSource[] = [];
  for await (
    const entry of walk(outputDir, {
      includeDirs: false,
      followSymlinks: false,
    })
  ) {
    if (entry.isSymlink) {
      throw BUILD_FAILED.create({
        detail: `Refusing to compress symbolic link in build output: ${entry.path}`,
      });
    }
    if (!entry.isFile || !shouldCompress(entry.name)) continue;

    await assertPathGuard(outputGuard, "Build output directory");
    const sourceInfo = await fs.lstat(entry.path);
    if (sourceInfo.isSymlink || !sourceInfo.isFile) {
      throw BUILD_FAILED.create({
        detail: `Compression source changed type during discovery: ${entry.path}`,
      });
    }
    if (sourceInfo.size > 0) {
      await assertPathGuard(outputGuard, "Build output directory");
      const directoryGuard = await capturePathGuard(
        nativeDirname(entry.path),
        "directory",
      );
      const sourceGuard = await capturePathGuard(entry.path, "file");
      const caseInsensitivePaths = nativeSeparator === "\\";
      if (
        !isCanonicalDescendant(
          outputGuard.canonicalPath,
          directoryGuard.canonicalPath,
          caseInsensitivePaths,
        ) ||
        !isCanonicalDescendant(
          directoryGuard.canonicalPath,
          sourceGuard.canonicalPath,
          caseInsensitivePaths,
        )
      ) {
        throw BUILD_FAILED.create({
          detail: `Compression source escaped the build output directory: ${entry.path}`,
        });
      }
      await assertPathGuard(outputGuard, "Build output directory");
      await assertPathGuard(directoryGuard, "Compression source directory");
      await assertPathGuard(sourceGuard, "Compression source");
      sources.push({
        path: entry.path,
        size: sourceInfo.size,
        modifiedAtMilliseconds: sourceInfo.mtime?.getTime() ?? null,
        guard: sourceGuard,
        directoryGuard,
      });
    }
  }
  sources.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

  for (const source of sources) {
    await assertCompressionGuards(source, outputGuard);
    for (const suffix of [".gz", ".br"]) {
      if (await fs.exists(`${source.path}${suffix}`)) {
        throw BUILD_FAILED.create({
          detail: `Compression output already exists: ${source.path}${suffix}`,
        });
      }
    }
  }

  const createdArtifacts: CompressionArtifact[] = [];
  try {
    for (let index = 0; index < sources.length; index += DEFAULT_BUILD_CONCURRENCY) {
      const batch = sources.slice(index, index + DEFAULT_BUILD_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (source) => {
          const compression = await Promise.allSettled([
            compressFile(source, outputGuard, "gzip"),
            compressFile(source, outputGuard, "brotli"),
          ]);
          const completed = compression.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : []
          );
          const failure = compression.find(
            (result): result is PromiseRejectedResult => result.status === "rejected",
          );
          if (failure) {
            const cleanupFailures = await cleanupArtifacts(
              completed.flatMap((result) => result.artifact ? [result.artifact] : []),
            );
            throw compressionFailure(
              `Failed to create every compression format for ${source.path}`,
              failure.reason,
              cleanupFailures,
            );
          }
          return { source, compressed: completed };
        }),
      );
      const results = settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      for (const { compressed } of results) {
        createdArtifacts.push(
          ...compressed.flatMap((result) => result.artifact ? [result.artifact] : []),
        );
      }

      const batchFailure = settled.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (batchFailure) throw batchFailure.reason;

      for (const { source, compressed } of results) {
        const written = compressed.filter((result) => result.written);
        if (written.length === 0) continue;
        stats.sourceBytes += source.size;
        stats.files += written.length;
        stats.compressedBytes += written.reduce((total, result) => total + result.bytes, 0);
      }
    }
  } catch (error) {
    const cleanupFailures = await cleanupArtifacts(createdArtifacts);
    if (cleanupFailures.length > 0) {
      throw compressionFailure(
        "Build output compression failed and rollback was incomplete",
        error,
        cleanupFailures,
      );
    }
    throw error;
  }

  logger.info("Compressed build outputs", {
    sourceFiles: sources.length,
    sidecars: stats.files,
    compressedBytes: stats.compressedBytes,
  });
  return stats;
}
