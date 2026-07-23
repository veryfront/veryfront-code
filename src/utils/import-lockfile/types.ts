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

/** Public API contract for lockfile manager. */
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
  rename?(oldPath: string, newPath: string): Promise<void>;
};

export interface FetchWithLockOptions {
  lockfile: LockfileManager;
  url: string;
  fetchFn?: typeof fetch;
  strict?: boolean;
  /** Maximum time for each remote request. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Maximum decoded response size in bytes. Defaults to 10 MiB. */
  maxResponseBytes?: number;
  /** Cancels the active request. */
  signal?: AbortSignal;
}

export interface FetchWithLockResult {
  content: string;
  resolvedUrl: string;
  fromCache: boolean;
  integrity: string;
}

export interface ParsedImport {
  specifier: string;
  type: "static" | "dynamic";
}
