import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("read-operations");

interface FileListCacheEntry {
  path: string;
  content?: string;
}

function hashPreview(content: string): number {
  return content
    .slice(0, 100)
    .split("")
    .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
}

function previewText(content: string, max = 80): string {
  return content.length > max ? `${content.slice(0, max)}...` : content;
}

export class FileListIndex {
  private index: Map<string, string> | null = null;
  private indexKey: string | null = null;
  private readyPromise: Promise<void> | null = null;

  constructor(
    private readonly getFileListCache?: () => Promise<Array<FileListCacheEntry> | undefined>,
  ) {}

  setReadyPromise(promise: Promise<void>): void {
    this.readyPromise = promise;
  }

  clear(): void {
    if (!this.index) return;

    const size = this.index.size;
    this.index = null;
    this.indexKey = null;
    logger.debug("Cleared file list index", { entriesCleared: size });
  }

  async lookup(normalizedPath: string): Promise<string | undefined> {
    if (this.readyPromise) {
      try {
        await this.readyPromise;
      } catch {
        logger.debug("File list initialization failed, will fetch individually");
      }
    }

    const index = await this.getOrBuild();
    if (!index) {
      logger.debug("No file list cache available");
      return undefined;
    }

    const content = index.get(normalizedPath);
    if (!content) {
      logger.debug("Content not in file list index", {
        path: normalizedPath,
        indexSize: index.size,
      });
      return undefined;
    }

    logger.debug("FILE_LIST_CACHE_HIT - serving from file list cache", {
      path: normalizedPath,
      contentLength: content.length,
      contentHash: hashPreview(content),
      contentPreview: previewText(content, 200).replace(/\n/g, "\\n"),
    });

    return content;
  }

  private async getOrBuild(): Promise<Map<string, string> | null> {
    if (!this.getFileListCache) {
      logger.debug("getOrBuildFileListIndex: no getFileListCache function");
      return null;
    }

    const fileList = await this.getFileListCache();
    if (!fileList) {
      // Cache entry expired or unavailable. If we already have a built index from a
      // previous successful cache read, keep using it rather than forcing network fetches.
      // The index stays valid until explicitly cleared via clear() (triggered by WebSocket pokes).
      if (this.index) {
        logger.debug("getOrBuildFileListIndex: cache expired, using existing in-memory index", {
          indexSize: this.index.size,
        });
        return this.index;
      }
      logger.debug(
        "[ReadOperations] getOrBuildFileListIndex: getFileListCache returned null/undefined",
      );
      return null;
    }

    const cacheCheckSample = fileList.find((f) => /welcome/i.test(f.path));
    logger.debug("getOrBuildFileListIndex: got file list from cache", {
      fileListSize: fileList.length,
      filesWithContent: fileList.filter((f) => f.content).length,
      sampleFilePath: cacheCheckSample?.path,
      sampleContentLength: cacheCheckSample?.content?.length,
      sampleContentPreview: cacheCheckSample?.content?.slice(0, 200)?.replace(/\n/g, "\\n"),
    });

    const indexKey = `${fileList.length}:${fileList[0]?.path ?? ""}:${
      fileList[fileList.length - 1]?.path ?? ""
    }`;
    if (this.index && this.indexKey === indexKey) return this.index;

    const index = new Map<string, string>();
    for (const file of fileList) {
      if (file.content) index.set(file.path, file.content);
    }

    this.index = index;
    this.indexKey = indexKey;

    const sampleFile = fileList.find((f) => /welcome/i.test(f.path));
    const sampleContent = sampleFile?.content;
    logger.debug("Built file list index", {
      fileListSize: fileList.length,
      indexedWithContent: index.size,
      sampleFilePath: sampleFile?.path,
      sampleContentLength: sampleContent?.length,
      sampleContentHash: sampleContent ? hashPreview(sampleContent) : undefined,
      sampleContentPreview: sampleContent?.slice(0, 200)?.replace(/\n/g, "\\n"),
    });

    return index;
  }
}
