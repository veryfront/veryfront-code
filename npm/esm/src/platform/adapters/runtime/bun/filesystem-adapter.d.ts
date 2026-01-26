import type { DirEntry, FileInfo, FileSystemAdapter, FileWatcher, WatchOptions } from "../../base.js";
export declare class BunFileSystemAdapter implements FileSystemAdapter {
    readFile(path: string): Promise<string>;
    readFileBytes(path: string): Promise<Uint8Array>;
    writeFile(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    readDir(path: string): AsyncIterable<DirEntry>;
    stat(path: string): Promise<FileInfo>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    remove(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    makeTempDir(prefix: string): Promise<string>;
    watch(paths: string | string[], options?: WatchOptions): FileWatcher;
}
//# sourceMappingURL=filesystem-adapter.d.ts.map