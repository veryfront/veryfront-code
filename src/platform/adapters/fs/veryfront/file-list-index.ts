import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";

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
  private indexBuiltAt = 0;
  private indexFresh = false;
  private readyPromise: Promise<void> | null = null;

  constructor(
    private readonly getFileListCache?: () => Promise<Array<FileListCacheEntry> | undefined>,
  ) {}

  setReadyPromise(promise: Promise<void>): void {
    this.readyPromise = promise;
  }

  clear(): void {
    if (!this.index) return;

    const indexedWithContent = this.index.size;
    this.index = null;
    this.pathSet = null;
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

  async lookup(normalizedPath: string): Promise<string | undefined> {
    const match = await this.match(normalizedPath);
    return match.status === "hit" ? match.content : undefined;
  }

  async match(normalizedPath: string): Promise<FileListMatchResult> {
    await this.ensureReady();

    const snapshot = await this.getOrBuild();
    if (!snapshot) {
      logger.debug("No file list cache available");
      return { status: "unavailable", fresh: false };
    }

    if (!snapshot.paths.has(normalizedPath)) {
      logger.debug("Content not in file list index", {
        indexSize: snapshot.content.size,
        fresh: snapshot.fresh,
      });
      return { status: "missing", fresh: snapshot.fresh };
    }

    const content = snapshot.content.get(normalizedPath);
    if (!content) {
      logger.debug("File list index contains path without inline content", {
        fresh: snapshot.fresh,
      });
      return {
        status: "present_without_content",
        fresh: snapshot.fresh,
        path: normalizedPath,
      };
    }

    logger.debug("FILE_LIST_CACHE_HIT - serving from file list cache", {
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
  ): Promise<{ path: string; content: string } | undefined> {
    const match = await this.findFirstMatch(normalizedPaths);
    if (match.status !== "hit" || !match.path || !match.content) return undefined;
    return { path: match.path, content: match.content };
  }

  async findFirstMatch(
    normalizedPaths: string[],
  ): Promise<FileListMatchResult> {
    await this.ensureReady();

    const snapshot = await this.getOrBuild();
    if (!snapshot) return { status: "unavailable", fresh: false };

    for (const path of normalizedPaths) {
      if (!snapshot.paths.has(path)) continue;

      const content = snapshot.content.get(path);
      if (content) {
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

  private async getOrBuild(): Promise<
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

    const fileList = await this.getFileListCache();
    if (!fileList) {
      // Cache entry expired or unavailable. If we already have a built index from a
      // previous successful cache read, keep using it rather than forcing network fetches.
      // The index stays valid until explicitly cleared via clear() (triggered by WebSocket pokes)
      // or until INDEX_STALENESS_LIMIT_MS elapses (safety net for missed pokes).
      if (this.index) {
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
        this.indexFresh = false;
      }
      logger.debug(
        "[ReadOperations] getOrBuildFileListIndex: getFileListCache returned null/undefined",
      );
      return null;
    }

    logger.debug("getOrBuildFileListIndex: got file list from cache", {
      fileListSize: fileList.length,
      filesWithContent: fileList.filter((f) => f.content).length,
    });

    if (this.index && this.pathSet && this.matchesFileList(fileList)) {
      this.indexBuiltAt = Date.now();
      this.indexFresh = true;
      return {
        content: this.index,
        paths: this.pathSet,
        fresh: true,
      };
    }

    const index = new Map<string, string>();
    const pathSet = new Set<string>();
    for (const file of fileList) {
      pathSet.add(file.path);
      if (file.content) index.set(file.path, file.content);
    }

    this.index = index;
    this.pathSet = pathSet;
    this.indexBuiltAt = Date.now();
    this.indexFresh = true;

    logger.debug("Built file list index", {
      fileListSize: fileList.length,
      indexedWithContent: index.size,
    });

    return {
      content: index,
      paths: pathSet,
      fresh: true,
    };
  }

  private matchesFileList(fileList: FileListCacheEntry[]): boolean {
    if (!this.index || !this.pathSet || this.pathSet.size !== fileList.length) return false;

    for (const file of fileList) {
      if (!this.pathSet.has(file.path)) return false;

      if (file.content === undefined) {
        if (this.index.has(file.path)) return false;
      } else if (this.index.get(file.path) !== file.content) {
        return false;
      }
    }

    return true;
  }
}
