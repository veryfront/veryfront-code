import { logger as baseLogger } from "#veryfront/utils";
import type { ResolvedContentContext } from "./types.ts";

const logger = baseLogger.component("read-operations");

interface FileListCacheEntry {
  path: string;
  content?: string;
}

export interface FileListMatchResult {
  status: "unavailable" | "missing" | "present_without_content" | "hit";
  fresh: boolean;
  path?: string;
  content?: string;
}

const INDEX_STALENESS_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

export class FileListIndex {
  private index: Map<string, string> | null = null;
  private pathSet: Set<string> | null = null;
  private indexScopeKey: string | null = null;
  private indexSnapshotVersion: number | undefined;
  private indexSourceList: Array<FileListCacheEntry> | null = null;
  private indexBuiltAt = 0;
  private indexFresh = false;
  private readyPromise: Promise<void> | null = null;

  constructor(
    private readonly getFileListCache?: (
      cacheKey?: string,
      contentContext?: ResolvedContentContext | null,
    ) => Promise<Array<FileListCacheEntry> | undefined>,
    private readonly getSnapshotVersion?: () => number,
    private readonly isSourceInvalidated?: (
      contentContext?: ResolvedContentContext | null,
    ) => boolean,
  ) {}

  setReadyPromise(promise: Promise<void>): void {
    this.readyPromise = promise;
  }

  clear(): void {
    if (!this.index) return;

    const indexedWithContent = this.index.size;
    this.index = null;
    this.pathSet = null;
    this.indexScopeKey = null;
    this.indexSnapshotVersion = undefined;
    this.indexSourceList = null;
    this.indexBuiltAt = 0;
    this.indexFresh = false;
    logger.debug("Cleared file list index", { indexedWithContent });
  }

  private async ensureReady(): Promise<void> {
    if (this.readyPromise) {
      try {
        await this.readyPromise;
      } catch (_) {
        /* expected: file list initialization may fail, will fetch individually */
        logger.debug("File list initialization failed, will fetch individually");
      }
    }
  }

  async lookup(
    normalizedPath: string,
    cacheKey?: string,
    contentContext?: ResolvedContentContext | null,
  ): Promise<string | undefined> {
    const match = await this.match(normalizedPath, cacheKey, contentContext);
    return match.status === "hit" ? match.content : undefined;
  }

  async match(
    normalizedPath: string,
    cacheKey?: string,
    contentContext?: ResolvedContentContext | null,
  ): Promise<FileListMatchResult> {
    await this.ensureReady();

    const snapshot = await this.getOrBuild(cacheKey, contentContext);
    if (!snapshot) {
      logger.debug("No file list cache available");
      return { status: "unavailable", fresh: false };
    }

    if (!snapshot.paths.has(normalizedPath)) {
      logger.debug("Content not in file list index", {
        path: normalizedPath,
        indexSize: snapshot.content.size,
        fresh: snapshot.fresh,
      });
      return { status: "missing", fresh: snapshot.fresh };
    }

    const content = snapshot.content.get(normalizedPath);
    if (content === undefined) {
      logger.debug("File list index contains path without inline content", {
        path: normalizedPath,
        fresh: snapshot.fresh,
      });
      return {
        status: "present_without_content",
        fresh: snapshot.fresh,
        path: normalizedPath,
      };
    }

    logger.debug("FILE_LIST_CACHE_HIT - serving from file list cache", {
      path: normalizedPath,
      contentLength: content.length,
    });

    return {
      status: "hit",
      fresh: snapshot.fresh,
      path: normalizedPath,
      content,
    };
  }

  async findFirstWithContent(
    normalizedPaths: string[],
    cacheKey?: string,
    contentContext?: ResolvedContentContext | null,
  ): Promise<{ path: string; content: string } | undefined> {
    const match = await this.findFirstMatch(normalizedPaths, cacheKey, contentContext);
    if (match.status !== "hit" || !match.path || match.content === undefined) return undefined;
    return { path: match.path, content: match.content };
  }

  async findFirstMatch(
    normalizedPaths: string[],
    cacheKey?: string,
    contentContext?: ResolvedContentContext | null,
  ): Promise<FileListMatchResult> {
    await this.ensureReady();

    const snapshot = await this.getOrBuild(cacheKey, contentContext);
    if (!snapshot) return { status: "unavailable", fresh: false };

    for (const path of normalizedPaths) {
      if (!snapshot.paths.has(path)) continue;

      const content = snapshot.content.get(path);
      if (content !== undefined) {
        return {
          status: "hit",
          fresh: snapshot.fresh,
          path,
          content,
        };
      }

      return {
        status: "present_without_content",
        fresh: snapshot.fresh,
        path,
      };
    }

    return { status: "missing", fresh: snapshot.fresh };
  }

  private async getOrBuild(
    cacheKey?: string,
    contentContext?: ResolvedContentContext | null,
  ): Promise<
    {
      content: Map<string, string>;
      paths: Set<string>;
      fresh: boolean;
    } | null
  > {
    if (!this.getFileListCache) {
      logger.debug("getOrBuildFileListIndex: no getFileListCache function");
      return null;
    }

    let versionBeforeRead = this.getSnapshotVersion?.();
    let fileList = await this.getFileListCache(cacheKey, contentContext);
    let versionAfterRead = this.getSnapshotVersion?.();
    if (
      versionBeforeRead !== undefined && versionAfterRead !== undefined &&
      versionBeforeRead !== versionAfterRead
    ) {
      logger.debug("getOrBuildFileListIndex: retrying read across snapshot change", {
        versionBeforeRead,
        versionAfterRead,
      });
      versionBeforeRead = versionAfterRead;
      fileList = await this.getFileListCache(cacheKey, contentContext);
      versionAfterRead = this.getSnapshotVersion?.();
      if (versionBeforeRead !== versionAfterRead) return null;
    }
    if (this.isSourceInvalidated?.(contentContext)) {
      logger.debug("getOrBuildFileListIndex: discarding read during source invalidation");
      return null;
    }
    const stableSnapshotVersion = versionBeforeRead === versionAfterRead
      ? versionAfterRead
      : undefined;
    if (!fileList) {
      // Cache entry expired or unavailable. If we already have a built index from a
      // previous successful cache read, keep using it rather than forcing network fetches.
      // The index stays valid until explicitly cleared via clear() (triggered by WebSocket pokes)
      // or until INDEX_STALENESS_LIMIT_MS elapses (safety net for missed pokes).
      if (this.index && this.indexScopeKey === (cacheKey ?? null)) {
        const age = Date.now() - this.indexBuiltAt;
        if (age < INDEX_STALENESS_LIMIT_MS) {
          logger.debug("getOrBuildFileListIndex: cache expired, using existing in-memory index", {
            indexSize: this.index.size,
            indexAgeMs: age,
          });
          this.indexFresh = false;
          return {
            content: this.index,
            paths: this.pathSet ?? new Set<string>(),
            fresh: false,
          };
        }
        logger.debug("getOrBuildFileListIndex: in-memory index too stale, discarding", {
          indexSize: this.index.size,
          indexAgeMs: age,
          staleLimitMs: INDEX_STALENESS_LIMIT_MS,
        });
        this.index = null;
        this.pathSet = null;
        this.indexScopeKey = null;
        this.indexFresh = false;
      }
      logger.debug(
        "[ReadOperations] getOrBuildFileListIndex: getFileListCache returned null/undefined",
      );
      return null;
    }

    const currentIndex = this.index;
    const currentPathSet = this.pathSet;
    const matchesCurrentIndex = currentIndex !== null && currentPathSet !== null &&
      (fileList === this.indexSourceList ||
        (fileList.length === currentPathSet.size &&
          fileList.every((file) =>
            currentPathSet.has(file.path) && currentIndex.get(file.path) === file.content
          )));
    if (
      matchesCurrentIndex &&
      this.indexScopeKey === (cacheKey ?? null) &&
      stableSnapshotVersion !== undefined &&
      this.indexSnapshotVersion === stableSnapshotVersion
    ) {
      this.indexFresh = true;
      this.indexBuiltAt = Date.now();
      return { content: currentIndex, paths: currentPathSet, fresh: true };
    }

    const cacheCheckSample = fileList.find((f) => /welcome/i.test(f.path));
    logger.debug("getOrBuildFileListIndex: got file list from cache", {
      fileListSize: fileList.length,
      filesWithContent: fileList.filter((f) => f.content !== undefined).length,
      sampleFilePath: cacheCheckSample?.path,
      sampleContentLength: cacheCheckSample?.content?.length,
    });

    const index = new Map<string, string>();
    const pathSet = new Set<string>();
    for (const file of fileList) {
      pathSet.add(file.path);
      if (file.content !== undefined) index.set(file.path, file.content);
    }

    this.index = index;
    this.pathSet = pathSet;
    this.indexScopeKey = cacheKey ?? null;
    this.indexSnapshotVersion = stableSnapshotVersion;
    this.indexSourceList = fileList;
    this.indexBuiltAt = Date.now();
    this.indexFresh = true;

    const sampleFile = fileList.find((f) => /welcome/i.test(f.path));
    const sampleContent = sampleFile?.content;
    logger.debug("Built file list index", {
      fileListSize: fileList.length,
      indexedWithContent: index.size,
      sampleFilePath: sampleFile?.path,
      sampleContentLength: sampleContent?.length,
    });

    return {
      content: index,
      paths: pathSet,
      fresh: true,
    };
  }
}
