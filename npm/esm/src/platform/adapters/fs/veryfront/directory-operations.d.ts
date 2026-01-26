import type { DirectoryEntry } from "./types.js";
import type { VeryfrontAPIClient } from "../../veryfront-api-client/index.js";
import { FileCache } from "../cache/file-cache.js";
import { PathNormalizer } from "./path-normalizer.js";
import type { ContentContextProvider } from "./read-operations.js";
export declare class DirectoryOperations {
    private readonly client;
    private readonly cache;
    private readonly normalizer;
    private readonly contextProvider?;
    private dirTree;
    private buildingTree;
    constructor(client: VeryfrontAPIClient, cache: FileCache, normalizer: PathNormalizer, contextProvider?: ContentContextProvider | undefined);
    readdir(path: string): Promise<DirectoryEntry[]>;
    private ensureTreeBuilt;
    private buildTree;
    clearTree(): void;
    private getAllFilesRaw;
}
//# sourceMappingURL=directory-operations.d.ts.map