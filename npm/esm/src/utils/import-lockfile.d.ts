import * as dntShim from "../../_dnt.shims.js";
export interface LockfileEntry {
    resolved: string;
    integrity: string;
    dependencies?: string[];
    fetchedAt?: string;
}
export interface LockfileData {
    version: 1;
    imports: Record<string, LockfileEntry>;
}
export declare function createEmptyLockfile(): LockfileData;
export declare function computeIntegrity(content: string): Promise<string>;
export declare function verifyIntegrity(content: string, integrity: string): Promise<boolean>;
export interface LockfileManager {
    read(): Promise<LockfileData | null>;
    write(data: LockfileData): Promise<void>;
    get(url: string): Promise<LockfileEntry | null>;
    set(url: string, entry: LockfileEntry): Promise<void>;
    has(url: string): Promise<boolean>;
    clear(): Promise<void>;
    flush(): Promise<void>;
}
export type FSAdapter = {
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    remove?(path: string): Promise<void>;
};
export declare function createLockfileManager(projectDir: string, fsAdapter?: FSAdapter): LockfileManager;
export interface FetchWithLockOptions {
    lockfile: LockfileManager;
    url: string;
    fetchFn?: typeof dntShim.fetch;
    strict?: boolean;
}
export interface FetchWithLockResult {
    content: string;
    resolvedUrl: string;
    fromCache: boolean;
    integrity: string;
}
export declare function fetchWithLock(options: FetchWithLockOptions): Promise<FetchWithLockResult>;
export interface ParsedImport {
    specifier: string;
    type: "static" | "dynamic";
}
export declare function extractImports(content: string): ParsedImport[];
export declare function resolveImportUrl(specifier: string, baseUrl: string): string | null;
//# sourceMappingURL=import-lockfile.d.ts.map