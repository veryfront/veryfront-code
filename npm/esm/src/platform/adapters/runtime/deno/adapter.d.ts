import * as dntShim from "../../../../../_dnt.shims.js";
import type { DirEntry, EnvironmentAdapter, FileInfo, FileSystemAdapter, FileWatcher, RuntimeAdapter, ServeOptions, Server, ServerAdapter, ShellAdapter, WatchOptions, WebSocketUpgrade } from "../../base.js";
declare class DenoFileSystemAdapter implements FileSystemAdapter {
    private assertDeno;
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
declare class DenoEnvironmentAdapter implements EnvironmentAdapter {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    toObject(): Record<string, string>;
}
declare class DenoServerAdapter implements ServerAdapter {
    upgradeWebSocket(request: dntShim.Request): WebSocketUpgrade;
}
declare class DenoShellAdapter implements ShellAdapter {
    statSync(path: string): {
        isFile: boolean;
        isDirectory: boolean;
    };
    readFileSync(path: string): string;
}
export declare class DenoAdapter implements RuntimeAdapter {
    readonly id: "deno";
    readonly name = "deno";
    readonly fs: DenoFileSystemAdapter;
    readonly env: DenoEnvironmentAdapter;
    readonly server: DenoServerAdapter;
    readonly shell: DenoShellAdapter;
    readonly capabilities: {
        typescript: boolean;
        jsx: boolean;
        http2: boolean;
        websocket: boolean;
        workers: boolean;
        fileWatching: boolean;
        shell: boolean;
        kvStore: boolean;
        writableFs: boolean;
    };
    private activeServer;
    serve(handler: (request: dntShim.Request) => Promise<dntShim.Response> | dntShim.Response, options?: ServeOptions): Promise<Server>;
    shutdown(): Promise<void>;
}
export declare const denoAdapter: DenoAdapter;
export {};
//# sourceMappingURL=adapter.d.ts.map