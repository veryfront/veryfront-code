import type { FileInfo } from "../adapters/base.js";
export interface FileSystem {
    readTextFile(path: string): Promise<string>;
    readFile(path: string): Promise<Uint8Array>;
    writeTextFile(path: string, data: string): Promise<void>;
    writeFile(path: string, data: Uint8Array): Promise<void>;
    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<FileInfo>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    readDir(path: string): AsyncIterable<{
        name: string;
        isFile: boolean;
        isDirectory: boolean;
    }>;
    remove(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    makeTempDir(options?: {
        prefix?: string;
    }): Promise<string>;
    chmod(path: string, mode: number): Promise<void>;
}
export declare function createFileSystem(): FileSystem;
export declare function readTextFile(path: string): Promise<string>;
export declare function readFile(path: string): Promise<Uint8Array>;
export declare function writeTextFile(path: string, data: string): Promise<void>;
export declare function writeFile(path: string, data: Uint8Array): Promise<void>;
export declare function exists(path: string): Promise<boolean>;
export declare function stat(path: string): Promise<FileInfo>;
export declare function mkdir(path: string, options?: {
    recursive?: boolean;
}): Promise<void>;
export declare function remove(path: string, options?: {
    recursive?: boolean;
}): Promise<void>;
export declare function readDir(path: string): AsyncIterable<{
    name: string;
    isFile: boolean;
    isDirectory: boolean;
}>;
export declare function makeTempDir(options?: {
    prefix?: string;
}): Promise<string>;
export declare function chmod(path: string, mode: number): Promise<void>;
export declare function symlink(target: string, path: string): Promise<void>;
export declare function isNotFoundError(error: unknown): boolean;
export declare function isAlreadyExistsError(error: unknown): boolean;
//# sourceMappingURL=fs.d.ts.map