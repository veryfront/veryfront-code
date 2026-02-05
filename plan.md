# Persistent Disk Cache for API Files

## Problem Statement

On cold start, the renderer fetches all project files from the API over HTTP. For a project with 500 files, this takes ~300ms (5+ paginated API calls). When pods restart, this data is lost and must be re-fetched.

**Scale consideration:** Up to 1 million projects × 500 files each = potential for 500 million cached files. Flat file storage is not viable at this scale.

**Current flow:**
```
Pod starts → Fetch 500 files from API (~300ms) → Render
Pod restarts → Fetch 500 files again → Render
```

**Root cause:** The `FileCache` stores raw API files in memory or remote Redis, but not on local disk. The existing `.cache` folder only stores transformed modules (MDX-ESM, HTTP bundles), not raw source files.

## Solution: SQLite-per-Project Cache

Add a disk-backed cache using **one SQLite database per project**. This provides:
- Structural tenant isolation (each project's files in separate DB)
- Efficient storage (no 4KB block alignment waste)
- O(log n) lookups within each project
- Simple invalidation (delete one .db file)

**Target flow:**
```
Pod starts → Check SQLite cache → Hit → Render (fast)
                                → Miss → Fetch from API → Save to SQLite → Render
Pod restarts → SQLite files intact → No API calls needed
```

**Key design decisions:**
1. SQLite cache **replaces** Redis/API cache when enabled (not layered)
2. One SQLite database per project for tenant isolation
3. WAL mode for crash safety without fsync on every write

---

## Architecture

### Directory Structure

```
.cache/                           # Cache root
└── projects/                     # SQLite databases (NEW - replaces all subdirs)
    ├── proj_a1b2c3.db           # ALL caches for Project A
    │   ├── raw_files            # Raw API file content
    │   ├── esm_modules          # Compiled tsx/jsx/ts/js/mdx/md
    │   ├── http_bundles         # Bundled JS/CSS for browser
    │   ├── http_modules         # External CDN modules (esm.sh, etc.)
    │   └── ssr_cache            # Pre-rendered HTML
    ├── proj_d4e5f6.db           # ALL caches for Project B
    ├── proj_g7h8i9.db           # ALL caches for Project C
    └── ...                      # One .db per project

# REMOVED (migrated to SQLite):
# ├── veryfront-mdx-esm/         # Now: esm_modules table
# ├── veryfront-http-bundle/     # Now: http_bundles table
# ├── veryfront-ssr/             # Now: ssr_cache table
# + Redis/API distributed caches # Now: all tables in SQLite
```

### SQLite Schema (per project)

```sql
-- Raw API files (previously fetched from API on every cold start)
CREATE TABLE raw_files (
  key TEXT PRIMARY KEY,          -- File path within project
  content TEXT NOT NULL,         -- Raw file content
  cached_at INTEGER DEFAULT (unixepoch())
);

-- Compiled ESM modules for ALL file types (consolidates existing caches)
-- Previously: transform-cache.ts (Redis/API) for tsx/jsx/ts/js
--             mdx-cache-adapter.ts (Redis/API) for mdx/md
CREATE TABLE esm_modules (
  key TEXT PRIMARY KEY,          -- Source file path, e.g., "components/Button.tsx"
  compiled BLOB NOT NULL,        -- Compiled ESM module code
  source_hash TEXT NOT NULL,     -- SHA256 of source for invalidation check
  source_type TEXT NOT NULL,     -- File type: "tsx" | "jsx" | "ts" | "js" | "mdx" | "md"
  config_hash TEXT,              -- Hash of compilation config (React version, JSX source, etc.)
  deps_hash TEXT,                -- Hash of dependencies for cache invalidation
  cached_at INTEGER DEFAULT (unixepoch())
);

-- HTTP bundles for browser (previously in veryfront-http-bundle/)
CREATE TABLE http_bundles (
  key TEXT PRIMARY KEY,          -- Bundle identifier or content hash
  bundle BLOB NOT NULL,          -- Bundled JS/CSS content
  content_type TEXT,             -- MIME type
  cached_at INTEGER DEFAULT (unixepoch())
);

-- External HTTP modules from CDN (previously in http-cache.ts Redis/API)
-- Modules fetched from esm.sh, deno.land, etc.
CREATE TABLE http_modules (
  url TEXT PRIMARY KEY,          -- Original CDN URL
  content BLOB NOT NULL,         -- Rewritten module content
  source_url TEXT,               -- For recovery/debugging
  cached_at INTEGER DEFAULT (unixepoch())
);

-- SSR rendered output (previously in veryfront-ssr/)
CREATE TABLE ssr_cache (
  key TEXT PRIMARY KEY,          -- Route path + params hash
  html TEXT NOT NULL,            -- Rendered HTML
  headers TEXT,                  -- JSON-encoded response headers
  cached_at INTEGER DEFAULT (unixepoch())
);

-- Optimizations
PRAGMA journal_mode=WAL;         -- Crash-safe, no fsync per write
PRAGMA synchronous=NORMAL;       -- Balance durability/performance

-- Index for finding stale entries by type
CREATE INDEX idx_esm_source_type ON esm_modules(source_type);
```

### Existing Caches Being Consolidated

| Current Cache | Location | New Table |
|---------------|----------|-----------|
| Transform cache (tsx/jsx/ts/js) | `transform-cache.ts` → Redis/API | `esm_modules` |
| MDX/MD cache | `mdx-cache-adapter.ts` → Redis/API | `esm_modules` |
| HTTP module cache | `http-cache.ts` → Redis/API | `http_modules` |
| Module cache | `module-cache.ts` → Memory LRU | `esm_modules` |
| Bundle manifests | Redis/API | `http_bundles` |

**Key insight:** All these caches already exist but use Redis/API as distributed storage. On cold start without Redis, everything recompiles. SQLite-per-project adds **local persistence** that survives pod restarts.

### Why Single DB per Project with Multiple Tables?

| Approach | At 1M projects | Issues |
|----------|----------------|--------|
| Flat files (current) | 500M+ files | ext4 inode exhaustion, readdir() takes minutes |
| Separate DB per cache type | 4M DBs | Complex invalidation, 4x file handles |
| Single global SQLite | 500M+ rows | Too large, lock contention |
| **One DB per project, multi-table** | **1M DBs** | ✅ Unified invalidation, atomic ops, simple |

### Benefits of Consolidated Approach

| Benefit | Description |
|---------|-------------|
| **Unified invalidation** | Delete one `.db` file = clear ALL caches for project |
| **Atomic operations** | Update raw file + recompile MDX in single transaction |
| **Simpler monitoring** | One DB size metric per project |
| **Reduced file handles** | One DB connection vs 4 separate cache backends |
| **Consistent interface** | All caches use `ProjectCache.get(table, key)` |

---

## Implementation

### Phase 1: ProjectCache (Unified Multi-Table Cache)

**File:** `veryfront-renderer/src/cache/project-cache.ts`

```typescript
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { Database } from "jsr:@db/sqlite";

/** Cache table types */
export type CacheTable = "raw_files" | "esm_modules" | "http_bundles" | "http_modules" | "ssr_cache";

/** Source types for ESM modules */
export type SourceType = "tsx" | "jsx" | "ts" | "js" | "mdx" | "md";

/** Schema for each table type */
const TABLE_SCHEMAS: Record<CacheTable, string> = {
  raw_files: `
    CREATE TABLE IF NOT EXISTS raw_files (
      key TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      cached_at INTEGER DEFAULT (unixepoch())
    )`,
  esm_modules: `
    CREATE TABLE IF NOT EXISTS esm_modules (
      key TEXT PRIMARY KEY,
      compiled BLOB NOT NULL,
      source_hash TEXT NOT NULL,
      source_type TEXT NOT NULL,
      config_hash TEXT,
      deps_hash TEXT,
      cached_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_esm_source_type ON esm_modules(source_type)`,
  http_bundles: `
    CREATE TABLE IF NOT EXISTS http_bundles (
      key TEXT PRIMARY KEY,
      bundle BLOB NOT NULL,
      content_type TEXT,
      cached_at INTEGER DEFAULT (unixepoch())
    )`,
  http_modules: `
    CREATE TABLE IF NOT EXISTS http_modules (
      url TEXT PRIMARY KEY,
      content BLOB NOT NULL,
      source_url TEXT,
      cached_at INTEGER DEFAULT (unixepoch())
    )`,
  ssr_cache: `
    CREATE TABLE IF NOT EXISTS ssr_cache (
      key TEXT PRIMARY KEY,
      html TEXT NOT NULL,
      headers TEXT,
      cached_at INTEGER DEFAULT (unixepoch())
    )`,
};

export class ProjectCache {
  private readonly baseDir: string;
  private readonly dbCache = new Map<string, Database>();
  private readonly keyCache = new Map<string, CryptoKey>(); // Derived keys per project
  private readonly maxOpenDbs = 100;

  constructor(cacheDir: string) {
    this.baseDir = join(cacheDir, "projects");
  }

  // ─────────────────────────────────────────────────────────────
  // Encryption (Web Crypto - works on Node 18+, Bun, Deno)
  // ─────────────────────────────────────────────────────────────

  private async getEncryptionKey(encryptionKey: string): Promise<CryptoKey> {
    // Cache derived keys to avoid repeated PBKDF2 (expensive)
    const cached = this.keyCache.get(encryptionKey);
    if (cached) return cached;

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(encryptionKey),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: new TextEncoder().encode("veryfront-cache-v1"),
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );

    this.keyCache.set(encryptionKey, key);
    return key;
  }

  private async encrypt(data: Uint8Array, encryptionKey: string): Promise<Uint8Array> {
    const key = await this.getEncryptionKey(encryptionKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    const result = new Uint8Array(iv.length + ciphertext.byteLength);
    result.set(iv);
    result.set(new Uint8Array(ciphertext), iv.length);
    return result;
  }

  private async decrypt(data: Uint8Array, encryptionKey: string): Promise<Uint8Array> {
    const key = await this.getEncryptionKey(encryptionKey);
    const iv = data.slice(0, 12);
    const ciphertext = data.slice(12);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext));
  }

  async initialize(): Promise<void> {
    await ensureDir(this.baseDir);
    await this.cleanupOrphanedFiles();
  }

  private async cleanupOrphanedFiles(): Promise<void> {
    try {
      for await (const entry of Deno.readDir(this.baseDir)) {
        if (entry.name.endsWith("-wal") || entry.name.endsWith("-shm")) {
          const mainDb = entry.name.replace(/-wal$|-shm$/, "");
          try {
            await Deno.stat(join(this.baseDir, mainDb));
          } catch {
            await Deno.remove(join(this.baseDir, entry.name)).catch(() => {});
          }
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }

  private validateProjectId(projectId: string): void {
    if (!/^[a-z0-9_-]+$/i.test(projectId) || projectId.length > 64) {
      throw new Error(`Invalid project ID: ${projectId}`);
    }
  }

  private dbPath(projectId: string): string {
    this.validateProjectId(projectId);
    return join(this.baseDir, `${projectId}.db`);
  }

  private getDb(projectId: string): Database {
    let db = this.dbCache.get(projectId);
    if (db) return db;

    // LRU eviction
    if (this.dbCache.size >= this.maxOpenDbs) {
      const oldest = this.dbCache.keys().next().value;
      if (oldest) {
        this.dbCache.get(oldest)?.close();
        this.dbCache.delete(oldest);
      }
    }

    db = new Database(this.dbPath(projectId));

    // Initialize all tables and set pragmas
    db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      ${Object.values(TABLE_SCHEMAS).join(";\n")};
    `);

    this.dbCache.set(projectId, db);
    return db;
  }

  // ─────────────────────────────────────────────────────────────
  // Raw Files API (encrypted)
  // ─────────────────────────────────────────────────────────────

  async getRawFile(projectId: string, encryptionKey: string, key: string): Promise<string | null> {
    try {
      const db = this.getDb(projectId);
      const row = db.prepare("SELECT content FROM raw_files WHERE key = ?").get(key) as { content: Uint8Array } | undefined;
      if (!row) return null;

      const decrypted = await this.decrypt(row.content, encryptionKey);
      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.warn(`[ProjectCache] getRawFile failed: ${projectId}/${key}`, e);
      return null; // Decryption failure = cache miss
    }
  }

  async setRawFile(projectId: string, encryptionKey: string, key: string, content: string): Promise<void> {
    try {
      const encrypted = await this.encrypt(new TextEncoder().encode(content), encryptionKey);
      const db = this.getDb(projectId);
      db.prepare("INSERT OR REPLACE INTO raw_files (key, content) VALUES (?, ?)").run(key, encrypted);
    } catch (e) {
      console.warn(`[ProjectCache] setRawFile failed: ${projectId}/${key}`, e);
    }
  }

  async setRawFiles(projectId: string, encryptionKey: string, files: Array<{ key: string; content: string }>): Promise<void> {
    try {
      const db = this.getDb(projectId);
      const stmt = db.prepare("INSERT OR REPLACE INTO raw_files (key, content) VALUES (?, ?)");

      // Pre-encrypt all files
      const encryptedFiles = await Promise.all(
        files.map(async ({ key, content }) => ({
          key,
          encrypted: await this.encrypt(new TextEncoder().encode(content), encryptionKey)
        }))
      );

      db.exec("BEGIN TRANSACTION");
      try {
        for (const { key, encrypted } of encryptedFiles) {
          stmt.run(key, encrypted);
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    } catch (e) {
      console.warn(`[ProjectCache] setRawFiles failed: ${projectId}`, e);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // ESM Modules API (tsx, jsx, ts, js, mdx, md) - encrypted
  // ─────────────────────────────────────────────────────────────

  async getEsmModule(
    projectId: string,
    encryptionKey: string,
    key: string,
    sourceHash: string,
    configHash?: string,
    depsHash?: string
  ): Promise<Uint8Array | null> {
    try {
      const db = this.getDb(projectId);
      // Match source hash, and optionally config/deps hash if provided
      // Note: hashes are NOT encrypted (for cache hit checking without decryption)
      let query = "SELECT compiled FROM esm_modules WHERE key = ? AND source_hash = ?";
      const params: (string | undefined)[] = [key, sourceHash];

      if (configHash) {
        query += " AND config_hash = ?";
        params.push(configHash);
      }
      if (depsHash) {
        query += " AND deps_hash = ?";
        params.push(depsHash);
      }

      const row = db.prepare(query).get(...params) as { compiled: Uint8Array } | undefined;
      if (!row) return null;

      // Decrypt the compiled content
      return await this.decrypt(row.compiled, encryptionKey);
    } catch (e) {
      console.warn(`[ProjectCache] getEsmModule failed: ${projectId}/${key}`, e);
      return null;
    }
  }

  async setEsmModule(
    projectId: string,
    encryptionKey: string,
    key: string,
    compiled: Uint8Array,
    sourceHash: string,
    sourceType: SourceType,
    configHash?: string,
    depsHash?: string
  ): Promise<void> {
    try {
      // Encrypt the compiled content
      const encrypted = await this.encrypt(compiled, encryptionKey);
      const db = this.getDb(projectId);
      db.prepare(`
        INSERT OR REPLACE INTO esm_modules
        (key, compiled, source_hash, source_type, config_hash, deps_hash)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(key, encrypted, sourceHash, sourceType, configHash ?? null, depsHash ?? null);
    } catch (e) {
      console.warn(`[ProjectCache] setEsmModule failed: ${projectId}/${key}`, e);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP Modules API (external CDN modules) - encrypted
  // ─────────────────────────────────────────────────────────────

  async getHttpModule(projectId: string, encryptionKey: string, url: string): Promise<Uint8Array | null> {
    try {
      const db = this.getDb(projectId);
      const row = db.prepare(
        "SELECT content FROM http_modules WHERE url = ?"
      ).get(url) as { content: Uint8Array } | undefined;
      if (!row) return null;

      return await this.decrypt(row.content, encryptionKey);
    } catch (e) {
      console.warn(`[ProjectCache] getHttpModule failed: ${projectId}/${url}`, e);
      return null;
    }
  }

  async setHttpModule(projectId: string, encryptionKey: string, url: string, content: Uint8Array, sourceUrl?: string): Promise<void> {
    try {
      const encrypted = await this.encrypt(content, encryptionKey);
      const db = this.getDb(projectId);
      db.prepare(
        "INSERT OR REPLACE INTO http_modules (url, content, source_url) VALUES (?, ?, ?)"
      ).run(url, encrypted, sourceUrl ?? null);
    } catch (e) {
      console.warn(`[ProjectCache] setHttpModule failed: ${projectId}/${url}`, e);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP Bundles API - encrypted
  // ─────────────────────────────────────────────────────────────

  async getHttpBundle(projectId: string, encryptionKey: string, key: string): Promise<{ bundle: Uint8Array; contentType: string } | null> {
    try {
      const db = this.getDb(projectId);
      const row = db.prepare(
        "SELECT bundle, content_type FROM http_bundles WHERE key = ?"
      ).get(key) as { bundle: Uint8Array; content_type: string } | undefined;
      if (!row) return null;

      const decrypted = await this.decrypt(row.bundle, encryptionKey);
      return { bundle: decrypted, contentType: row.content_type };
    } catch (e) {
      console.warn(`[ProjectCache] getHttpBundle failed: ${projectId}/${key}`, e);
      return null;
    }
  }

  async setHttpBundle(projectId: string, encryptionKey: string, key: string, bundle: Uint8Array, contentType: string): Promise<void> {
    try {
      const encrypted = await this.encrypt(bundle, encryptionKey);
      const db = this.getDb(projectId);
      db.prepare(
        "INSERT OR REPLACE INTO http_bundles (key, bundle, content_type) VALUES (?, ?, ?)"
      ).run(key, encrypted, contentType);
    } catch (e) {
      console.warn(`[ProjectCache] setHttpBundle failed: ${projectId}/${key}`, e);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // SSR Cache API - encrypted
  // ─────────────────────────────────────────────────────────────

  async getSsrCache(projectId: string, encryptionKey: string, key: string): Promise<{ html: string; headers: Record<string, string> } | null> {
    try {
      const db = this.getDb(projectId);
      const row = db.prepare(
        "SELECT html, headers FROM ssr_cache WHERE key = ?"
      ).get(key) as { html: Uint8Array; headers: string | null } | undefined;
      if (!row) return null;

      const decrypted = await this.decrypt(row.html, encryptionKey);
      return {
        html: new TextDecoder().decode(decrypted),
        headers: row.headers ? JSON.parse(row.headers) : {}
      };
    } catch (e) {
      console.warn(`[ProjectCache] getSsrCache failed: ${projectId}/${key}`, e);
      return null;
    }
  }

  async setSsrCache(projectId: string, encryptionKey: string, key: string, html: string, headers: Record<string, string>): Promise<void> {
    try {
      const encrypted = await this.encrypt(new TextEncoder().encode(html), encryptionKey);
      const db = this.getDb(projectId);
      db.prepare(
        "INSERT OR REPLACE INTO ssr_cache (key, html, headers) VALUES (?, ?, ?)"
      ).run(key, encrypted, JSON.stringify(headers));
    } catch (e) {
      console.warn(`[ProjectCache] setSsrCache failed: ${projectId}/${key}`, e);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Project-Level Operations
  // ─────────────────────────────────────────────────────────────

  /** Invalidate a specific table for a project */
  async invalidateTable(projectId: string, table: CacheTable): Promise<void> {
    try {
      const db = this.getDb(projectId);
      db.exec(`DELETE FROM ${table}`);
    } catch (e) {
      console.warn(`[ProjectCache] invalidateTable failed: ${projectId}/${table}`, e);
    }
  }

  /** Invalidate ALL caches for a project (delete entire DB) */
  async invalidateProject(projectId: string): Promise<void> {
    const db = this.dbCache.get(projectId);
    if (db) {
      db.close();
      this.dbCache.delete(projectId);
    }

    const basePath = this.dbPath(projectId);
    await Promise.all([
      Deno.remove(basePath).catch(() => {}),
      Deno.remove(`${basePath}-wal`).catch(() => {}),
      Deno.remove(`${basePath}-shm`).catch(() => {}),
    ]);
  }

  /** Get statistics for a project */
  async getStats(projectId: string): Promise<Record<CacheTable, { count: number; sizeBytes: number }>> {
    const stats: Record<string, { count: number; sizeBytes: number }> = {};

    try {
      const db = this.getDb(projectId);

      for (const table of Object.keys(TABLE_SCHEMAS) as CacheTable[]) {
        const contentCol = table === "raw_files" ? "content"
                        : table === "ssr_cache" ? "html"
                        : table === "mdx_esm" ? "compiled"
                        : "bundle";
        const row = db.prepare(
          `SELECT COUNT(*) as count, COALESCE(SUM(LENGTH(${contentCol})), 0) as size FROM ${table}`
        ).get() as { count: number; size: number };
        stats[table] = { count: row.count, sizeBytes: row.size };
      }
    } catch {
      for (const table of Object.keys(TABLE_SCHEMAS)) {
        stats[table] = { count: 0, sizeBytes: 0 };
      }
    }

    return stats as Record<CacheTable, { count: number; sizeBytes: number }>;
  }

  close(): void {
    for (const db of this.dbCache.values()) {
      db.close();
    }
    this.dbCache.clear();
  }
}
```

### Phase 2: Cache Initialization

**File:** `veryfront-renderer/src/cache/index.ts` (modify)

```typescript
import { ProjectCache } from "./project-cache.ts";

let projectCache: ProjectCache | null = null;

export async function getProjectCache(): Promise<ProjectCache> {
  if (projectCache) return projectCache;

  // Initialize unified project cache when PVC is available
  if (Deno.env.get("VF_CACHE_BACKEND") === "sqlite") {
    projectCache = new ProjectCache(getCacheBaseDir());
    await projectCache.initialize();
    return projectCache;
  }

  // Fallback: in-memory implementation for local dev
  projectCache = new MemoryProjectCache();
  return projectCache;
}

// Graceful shutdown
Deno.addSignalListener("SIGTERM", () => {
  projectCache?.close();
});
```

### Phase 2b: Migration Adapter (Backward Compatibility)

**File:** `veryfront-renderer/src/cache/adapters/file-cache-adapter.ts`

```typescript
import { ProjectCache } from "../project-cache.ts";

/**
 * Adapter to make ProjectCache compatible with existing FileCache interface.
 * Allows gradual migration without breaking existing code.
 */
export class FileCacheAdapter implements CacheBackend {
  constructor(
    private projectCache: ProjectCache,
    private projectId: string
  ) {}

  async get(key: string): Promise<string | null> {
    return this.projectCache.getRawFile(this.projectId, key);
  }

  async set(key: string, value: string): Promise<void> {
    return this.projectCache.setRawFile(this.projectId, key, value);
  }

  async del(key: string): Promise<void> {
    // Individual delete - rarely needed
    const db = this.projectCache["getDb"](this.projectId);
    db.prepare("DELETE FROM raw_files WHERE key = ?").run(key);
  }

  async delByPattern(_pattern: string): Promise<number> {
    // Clear all raw files for this project
    await this.projectCache.invalidateTable(this.projectId, "raw_files");
    return -1; // Unknown count
  }
}
```
```

### Phase 3: Helm Chart Changes

**File:** `veryfront-cloud-renderer/chart/templates/renderer-pvc.yaml` (new)

```yaml
{{- if .Values.renderer.cache.persistent.enabled }}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "veryfront-renderer.fullname" . }}-cache
  labels:
    {{- include "veryfront-renderer.labels" . | nindent 4 }}
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: {{ .Values.renderer.cache.persistent.storageClass }}
  resources:
    requests:
      storage: {{ .Values.renderer.cache.persistent.size }}
{{- end }}
```

**File:** `veryfront-cloud-renderer/chart/templates/renderer-deployment.yaml` (modify)

```yaml
spec:
  template:
    spec:
      containers:
        - name: renderer
          env:
            {{- if .Values.renderer.cache.persistent.enabled }}
            - name: VF_CACHE_BACKEND
              value: "sqlite"
            {{- end }}
          volumeMounts:
            {{- if .Values.renderer.cache.persistent.enabled }}
            - name: cache
              mountPath: /app/.cache
            {{- end }}
      volumes:
        {{- if .Values.renderer.cache.persistent.enabled }}
        - name: cache
          persistentVolumeClaim:
            claimName: {{ include "veryfront-renderer.fullname" . }}-cache
        {{- end }}
```

**File:** `veryfront-cloud-renderer/chart/values.yaml` (modify)

```yaml
renderer:
  cache:
    persistent:
      enabled: true
      size: "10Gi"
      storageClass: "hcloud-volumes"
```

---

## Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **Per-pod cache** | Each pod has its own cache. First request to a cold pod still hits API. | Acceptable - cache warms quickly, traffic is distributed |
| **No cross-pod sharing** | Same project may be cached on multiple pods | Storage is cheap, simplicity > efficiency |
| **Max open DBs** | LRU eviction at 100 open connections | Reopening a DB is fast (~1ms) |
| **No TTL on SQLite rows** | Files persist until invalidated or evicted | Acceptable - files are immutable until changed |
| **DB file growth** | SQLite doesn't auto-shrink after deletes | Run VACUUM periodically or on invalidate |

---

## Failure Modes

| Scenario | Behavior | Recovery |
|----------|----------|----------|
| **Disk full** | Write fails silently, request continues (fetches from API) | Alert triggers, delete old project DBs |
| **Corrupt DB** | SQLite returns error, re-fetches from API | Delete .db file, auto-recreates on next request |
| **Pod crash mid-write** | WAL mode ensures consistency | SQLite auto-recovers on next open |
| **Orphaned WAL/SHM** | Leftover files from crashes | Cleaned on `initialize()` |
| **PVC detached** | Cache becomes ephemeral (memory-like) | Pod restart reattaches PVC |
| **Too many open DBs** | LRU eviction closes oldest | Transparent to callers, slight latency on reopen |

---

## Monitoring

### Metrics to Add

```typescript
// In ProjectCache
private recordMetric(
  table: CacheTable,
  event: 'hit' | 'miss' | 'write' | 'write_error'
) {
  // Counter: veryfront_project_cache_operations_total{table="raw_files|mdx_esm|...", event="..."}
}

private recordDbMetric(event: 'open' | 'close' | 'evict') {
  // Counter: veryfront_project_cache_db_operations_total{event="..."}
}

// Track active DB connections
private recordGauge(name: 'open_dbs', value: number) {
  // Gauge: veryfront_project_cache_open_dbs
}
```

### Alerts

```yaml
# Alert: Disk cache >80% full
- alert: RendererCacheDiskHigh
  expr: |
    (node_filesystem_size_bytes{mountpoint="/app/.cache"} - node_filesystem_avail_bytes{mountpoint="/app/.cache"})
    / node_filesystem_size_bytes{mountpoint="/app/.cache"} > 0.8
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Renderer SQLite cache disk usage high"
    runbook: "Delete old project DBs or increase PVC size"

# Alert: High cache miss rate (per table)
- alert: RendererCacheMissRateHigh
  expr: |
    rate(veryfront_project_cache_operations_total{event="miss"}[5m])
    / rate(veryfront_project_cache_operations_total{event=~"hit|miss"}[5m]) > 0.5
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Renderer cache miss rate >50% for {{ $labels.table }}"
    runbook: "Check if PVC is mounted, verify cache is being written"

# Alert: MDX cache not working (high miss = recompiling every time)
- alert: RendererMdxCacheMissHigh
  expr: |
    rate(veryfront_project_cache_operations_total{table="mdx_esm", event="miss"}[5m])
    / rate(veryfront_project_cache_operations_total{table="mdx_esm", event=~"hit|miss"}[5m]) > 0.3
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: "MDX cache miss rate >30% - excessive recompilation"
    runbook: "Check source_hash logic, verify MDX sources aren't changing unexpectedly"
```

### Dashboard Panels

- **Cache hit rate by table**: `rate(veryfront_project_cache_operations_total{event="hit"}[5m]) / rate(veryfront_project_cache_operations_total{event=~"hit|miss"}[5m])`
- **Disk usage**: `node_filesystem_size_bytes{mountpoint="/app/.cache"} - node_filesystem_avail_bytes{mountpoint="/app/.cache"}`
- **Write errors by table**: `rate(veryfront_project_cache_operations_total{event="write_error"}[5m])`
- **Open DB connections**: `veryfront_project_cache_open_dbs`
- **DB evictions**: `rate(veryfront_project_cache_db_operations_total{event="evict"}[5m])`
- **Operations by table**: `sum by (table) (rate(veryfront_project_cache_operations_total[5m]))`

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| **Path traversal** | Project ID validated with regex `^[a-z0-9_-]+$` before use in path |
| **Cross-tenant access** | Structural isolation + per-project encryption |
| **SQL injection** | Parameterized queries only, no string interpolation |
| **Disk access attack** | All content encrypted with project-specific key |
| **Disk exhaustion** | PVC size limit + monitoring alerts |
| **Tenant enumeration** | DB filenames use project IDs (already public in URLs) |

### Multi-Tenant Isolation Layers

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Routing Layer                                            │
│    abc.veryfront.com → projectId = "abc"                    │
├─────────────────────────────────────────────────────────────┤
│ 2. API Auth Layer                                           │
│    Token validated → returns encryptionKey for encryption   │
├─────────────────────────────────────────────────────────────┤
│ 3. Cache Layer (structural + cryptographic isolation)       │
│    abc.db contains encrypted blobs (AES-256-GCM)           │
│    xyz.db contains encrypted blobs (different key)          │
│    ⚠️ Even with disk access, can't read without key        │
├─────────────────────────────────────────────────────────────┤
│ 4. PVC Layer                                                │
│    Only renderer pod has read/write access                  │
└─────────────────────────────────────────────────────────────┘
```

### Encryption Architecture

**Threat model:** Compromised pod gains disk access, tries to read other tenants' data.

**Solution:** Application-level encryption using Web Crypto API (works on Node, Bun, Deno).

```typescript
// Encryption utilities (cross-runtime: Node 18+, Bun, Deno)
async function deriveKey(encryptionKey: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(encryptionKey),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode("veryfront-cache-v1"),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );
  // Prepend IV to ciphertext
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv);
  result.set(new Uint8Array(ciphertext), iv.length);
  return result;
}

async function decrypt(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)
  );
}
```

**Key management:**
- `encryptionKey` returned by API during auth validation
- Cached in memory for request duration only
- Never stored on disk
- Rotated via API (old cached data becomes unreadable = cache miss = re-fetch)

### API Contract for Encryption Key

**API returns key on auth validation:**
```typescript
// Existing auth endpoint (e.g., POST /auth/validate)
// Request: { token: "vf_abc123..." }
// Response:
{
  projectId: "my-project",
  userId: "user-123",
  encryptionKey: "base64-encoded-32-byte-key"  // NEW field
}
```

**Where does the key come from?**
```typescript
// Option A: Dedicated field in database
// ALTER TABLE projects ADD COLUMN encryption_key TEXT;
const encryptionKey = project.encryptionKey;

// Option B: Derive from existing project signing secret (no new field)
const encryptionKey = await deriveKey(project.signingSecret, "cache-encryption-v1");
```

**Proxy → Renderer handoff:**
```typescript
// Proxy validates token with API
const authResult = await api.validateToken(request.headers.authorization);

// Proxy forwards auth context to renderer
const rendererRequest = {
  ...originalRequest,
  headers: {
    ...originalRequest.headers,
    "x-vf-project-id": authResult.projectId,
    "x-vf-encryption-key": authResult.encryptionKey,
  }
};

// Renderer extracts auth context
const projectId = request.headers["x-vf-project-id"];
const encryptionKey = request.headers["x-vf-encryption-key"];
const cache = getProjectCache();
const file = await cache.getRawFile(projectId, encryptionKey, "app.tsx");
```

---

## Testing Plan

### Unit Tests

```typescript
// veryfront-renderer/src/cache/project-cache.test.ts
import { assertEquals, assertRejects } from "@std/assert";
import { ProjectCache } from "./project-cache.ts";

Deno.test("ProjectCache", async (t) => {
  const testDir = await Deno.makeTempDir();
  const secretA = "project-a-secret-key-12345";
  const secretB = "project-b-secret-key-67890";

  // ─────────────────────────────────────────────────────────────
  // Raw Files Tests (with encryption)
  // ─────────────────────────────────────────────────────────────

  await t.step("getRawFile returns null for missing key", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();
    assertEquals(await cache.getRawFile("proj1", secretA, "missing"), null);
    cache.close();
  });

  await t.step("setRawFile then getRawFile returns value", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();
    await cache.setRawFile("proj1", secretA, "file.ts", "content");
    assertEquals(await cache.getRawFile("proj1", secretA, "file.ts"), "content");
    cache.close();
  });

  await t.step("projects are isolated by encryption key", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();
    await cache.setRawFile("projA", secretA, "file.ts", "contentA");
    await cache.setRawFile("projB", secretB, "file.ts", "contentB");

    // Each project can read its own data
    assertEquals(await cache.getRawFile("projA", secretA, "file.ts"), "contentA");
    assertEquals(await cache.getRawFile("projB", secretB, "file.ts"), "contentB");

    // Wrong secret = decryption fails = null (cache miss)
    assertEquals(await cache.getRawFile("projA", secretB, "file.ts"), null);
    assertEquals(await cache.getRawFile("projB", secretA, "file.ts"), null);
    cache.close();
  });

  await t.step("setRawFiles inserts atomically with encryption", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();
    await cache.setRawFiles("proj1", secretA, [
      { key: "x.ts", content: "x" },
      { key: "y.ts", content: "y" },
    ]);
    assertEquals(await cache.getRawFile("proj1", secretA, "x.ts"), "x");
    assertEquals(await cache.getRawFile("proj1", secretA, "y.ts"), "y");
    cache.close();
  });

  // ─────────────────────────────────────────────────────────────
  // ESM Modules Tests (all file types with encryption)
  // ─────────────────────────────────────────────────────────────

  await t.step("getEsmModule validates source hash", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();
    const compiled = new TextEncoder().encode("compiled module");
    await cache.setEsmModule("proj1", secretA, "Button.tsx", compiled, "hash123", "tsx");

    // Correct hash returns data
    const result = await cache.getEsmModule("proj1", secretA, "Button.tsx", "hash123");
    assertEquals(new TextDecoder().decode(result!), "compiled module");

    // Wrong hash returns null (cache miss - source changed)
    assertEquals(await cache.getEsmModule("proj1", secretA, "Button.tsx", "hash456"), null);
    cache.close();
  });

  await t.step("getEsmModule validates config and deps hash", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();
    const compiled = new TextEncoder().encode("compiled with config");
    await cache.setEsmModule("proj1", secretA, "App.tsx", compiled, "src123", "tsx", "cfg456", "deps789");

    // All hashes match - returns decrypted data
    const result = await cache.getEsmModule("proj1", secretA, "App.tsx", "src123", "cfg456", "deps789");
    assertEquals(new TextDecoder().decode(result!), "compiled with config");

    // Source matches but config changed - cache miss
    assertEquals(await cache.getEsmModule("proj1", secretA, "App.tsx", "src123", "cfg999", "deps789"), null);

    // Source matches but deps changed - cache miss
    assertEquals(await cache.getEsmModule("proj1", secretA, "App.tsx", "src123", "cfg456", "deps000"), null);
    cache.close();
  });

  await t.step("ESM modules encrypted - wrong key fails", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();
    await cache.setEsmModule("proj1", secretA, "secret.tsx", new TextEncoder().encode("secret code"), "h1", "tsx");

    // Wrong secret = decryption fails = null
    assertEquals(await cache.getEsmModule("proj1", secretB, "secret.tsx", "h1"), null);
    cache.close();
  });

  // ─────────────────────────────────────────────────────────────
  // HTTP Modules Tests (CDN modules with encryption)
  // ─────────────────────────────────────────────────────────────

  await t.step("getHttpModule and setHttpModule with encryption", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();
    const content = new TextEncoder().encode("export default function() {}");
    await cache.setHttpModule("proj1", secretA, "https://esm.sh/react@18", content, "https://esm.sh/react@18.2.0");

    const result = await cache.getHttpModule("proj1", secretA, "https://esm.sh/react@18");
    assertEquals(new TextDecoder().decode(result!), "export default function() {}");

    // Wrong secret = can't decrypt
    assertEquals(await cache.getHttpModule("proj1", secretB, "https://esm.sh/react@18"), null);
    cache.close();
  });

  // ─────────────────────────────────────────────────────────────
  // SSR Cache Tests (with encryption)
  // ─────────────────────────────────────────────────────────────

  await t.step("setSsrCache and getSsrCache with headers", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();
    await cache.setSsrCache("proj1", secretA, "/about", "<h1>About</h1>", { "x-custom": "value" });

    const result = await cache.getSsrCache("proj1", secretA, "/about");
    assertEquals(result?.html, "<h1>About</h1>");
    assertEquals(result?.headers["x-custom"], "value");

    // Wrong secret = can't decrypt
    assertEquals(await cache.getSsrCache("proj1", secretB, "/about"), null);
    cache.close();
  });

  // ─────────────────────────────────────────────────────────────
  // Project-Level Operations
  // ─────────────────────────────────────────────────────────────

  await t.step("invalidateTable clears only specified table", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();
    await cache.setRawFile("proj1", secretA, "a.ts", "content");
    await cache.setSsrCache("proj1", secretA, "/", "<html>");

    await cache.invalidateTable("proj1", "raw_files");

    assertEquals(await cache.getRawFile("proj1", secretA, "a.ts"), null);
    assertEquals((await cache.getSsrCache("proj1", secretA, "/"))?.html, "<html>"); // Still exists
    cache.close();
  });

  await t.step("invalidateProject removes all caches", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();
    await cache.setRawFile("proj1", secretA, "a.ts", "content");
    await cache.setSsrCache("proj1", secretA, "/", "<html>");

    await cache.invalidateProject("proj1");

    assertEquals(await cache.getRawFile("proj1", secretA, "a.ts"), null);
    assertEquals(await cache.getSsrCache("proj1", secretA, "/"), null);
    cache.close();
  });

  // ─────────────────────────────────────────────────────────────
  // Security Tests
  // ─────────────────────────────────────────────────────────────

  await t.step("rejects invalid project IDs (path traversal)", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();
    await assertRejects(() => cache.getRawFile("../etc/passwd", secretA, "key"), Error, "Invalid project ID");
    await assertRejects(() => cache.getRawFile("proj with spaces", secretA, "key"), Error, "Invalid project ID");
    await assertRejects(() => cache.getRawFile("proj/sub", secretA, "key"), Error, "Invalid project ID");
    cache.close();
  });

  await t.step("encryption provides tenant isolation", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();

    // Project A stores sensitive data
    await cache.setRawFile("projA", secretA, "secret.ts", "API_KEY=abc123");

    // Project B cannot read it even if they know the key name
    assertEquals(await cache.getRawFile("projA", secretB, "secret.ts"), null);

    // Project A can read with correct secret
    assertEquals(await cache.getRawFile("projA", secretA, "secret.ts"), "API_KEY=abc123");
    cache.close();
  });

  // ─────────────────────────────────────────────────────────────
  // Stats Tests (stats work without decryption)
  // ─────────────────────────────────────────────────────────────

  await t.step("getStats returns counts per table (no secret needed)", async () => {
    const cache = new ProjectCache(testDir);
    await cache.initialize();
    await cache.setRawFile("proj1", secretA, "a.ts", "hello");
    await cache.setRawFile("proj1", secretA, "b.ts", "world!");
    await cache.setSsrCache("proj1", secretA, "/", "<html>");

    // Stats don't require secret - just counts encrypted blob sizes
    const stats = await cache.getStats("proj1");
    assertEquals(stats.raw_files.count, 2);
    // Note: sizeBytes is encrypted size, not plaintext size
    assertEquals(stats.ssr_cache.count, 1);
    cache.close();
  });

  // Cleanup
  await Deno.remove(testDir, { recursive: true });
});
```

### Integration Test

1. Start renderer with `VF_CACHE_BACKEND=sqlite`
2. Render a page (triggers API fetch → raw_files, MDX compile → mdx_esm, SSR → ssr_cache)
3. Restart renderer process
4. Render same page (all cache hits, no API calls)
5. Verify via logs: `[ProjectCache] hit` for each table
6. Test invalidation: trigger WebSocket poke, verify project DB is deleted
7. Test partial invalidation: `invalidateTable("proj", "ssr_cache")` clears SSR but keeps raw_files

---

## Rollout Plan

### Phase 1: Development (2 days)
- [ ] Add `jsr:@db/sqlite` dependency to deno.json
- [ ] Implement `ProjectCache` with all four tables
- [ ] Create `FileCacheAdapter` for backward compatibility
- [ ] Add unit tests for all cache operations
- [ ] Update MDX compiler to use `getMdxEsm()` / `setMdxEsm()`
- [ ] Update HTTP bundler to use `getHttpBundle()` / `setHttpBundle()`
- [ ] Update SSR render to use `getSsrCache()` / `setSsrCache()`

### Phase 2: Local Testing (1 day)
- [ ] Test with `VF_CACHE_BACKEND=sqlite` locally
- [ ] Verify all four cache types persist across restart
- [ ] Test WebSocket invalidation deletes project DB
- [ ] Test `invalidateTable()` clears only specified cache
- [ ] Simulate disk full scenario
- [ ] Test with 100+ projects to verify LRU eviction

### Phase 3: Staging (2 days)
- [ ] Deploy Helm chart changes to staging
- [ ] Create PVC
- [ ] Monitor disk usage and cache hit rates per table
- [ ] Verify cold start improvement
- [ ] Test tenant isolation (project A can't read project B)
- [ ] Verify MDX, bundles, and SSR all cache correctly

### Phase 4: Production (1 day)
- [ ] Deploy to production with `persistent.enabled: true`
- [ ] Monitor cold start times
- [ ] Verify no regressions in all cache layers
- [ ] Add alerts to Grafana

### Phase 5: Cleanup (after stable)
- [ ] Remove old flat-file cache code
- [ ] Remove `veryfront-mdx-esm/`, `veryfront-http-bundle/`, `veryfront-ssr/` directory handling
- [ ] Update documentation

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Cold start time (500 files) | ~300ms | ~10-20ms (SQLite read) |
| API calls on pod restart | 5+ | 0 |
| TSX/JSX/TS recompile on restart | All files | 0 (cached in esm_modules) |
| MDX/MD recompile on restart | All files | 0 (cached in esm_modules) |
| CDN module re-fetch on restart | All modules | 0 (cached in http_modules) |
| Bundle rebuild on restart | All bundles | 0 (cached in http_bundles) |
| Cache hit rate (warm pod) | ~60% | ~95% |
| Storage per project (avg) | N/A | ~12MB (all 5 tables combined) |
| Max concurrent projects | N/A | ~10,000 DBs per pod typical |

### Per-Table Metrics

| Table | Typical Size | Entries | Purpose |
|-------|-------------|---------|---------|
| `raw_files` | ~2MB | ~500 | API file content |
| `esm_modules` | ~3MB | ~200-400 | Compiled tsx/jsx/ts/js/mdx/md |
| `http_bundles` | ~2MB | ~10-20 | JS/CSS bundles for browser |
| `http_modules` | ~5MB | ~50-100 | External CDN modules (react, etc.) |
| `ssr_cache` | ~500KB | ~50-100 | Pre-rendered HTML |

**Total per project: ~12MB typical** (varies by project size and dependencies)

---

## Files Changed

### New Files
| Path | Purpose |
|------|---------|
| `veryfront-renderer/src/cache/project-cache.ts` | Unified ProjectCache with multi-table schema |
| `veryfront-renderer/src/cache/project-cache.test.ts` | Unit tests for all cache tables |
| `veryfront-renderer/src/cache/adapters/file-cache-adapter.ts` | Backward compatibility adapter |
| `veryfront-cloud-renderer/chart/templates/renderer-pvc.yaml` | PVC definition |

### Modified Files
| Path | Changes |
|------|---------|
| `veryfront-renderer/src/cache/index.ts` | Export ProjectCache, initialize on startup |
| `veryfront-renderer/src/transforms/esm/transform-cache.ts` | Use `projectCache.getEsmModule()` / `setEsmModule()` |
| `veryfront-renderer/src/transforms/mdx/mdx-cache-adapter.ts` | Use `projectCache.getEsmModule()` (source_type="mdx"/"md") |
| `veryfront-renderer/src/transforms/esm/http-cache.ts` | Use `projectCache.getHttpModule()` / `setHttpModule()` |
| `veryfront-renderer/src/bundler/http.ts` | Use `projectCache.getHttpBundle()` / `setHttpBundle()` |
| `veryfront-renderer/src/ssr/render.ts` | Use `projectCache.getSsrCache()` / `setSsrCache()` |
| `veryfront-cloud-renderer/chart/templates/renderer-deployment.yaml` | Add volume mount + env var |
| `veryfront-cloud-renderer/chart/values.yaml` | Add cache.persistent config |
| `veryfront-renderer/deno.json` | Add `jsr:@db/sqlite` dependency |

### Deleted/Deprecated (after migration)
| Path | Replacement |
|------|-------------|
| Redis/API distributed cache calls | `esm_modules` / `http_modules` tables |
| `veryfront-renderer/src/cache/module-cache.ts` | `esm_modules` table (LRU now in SQLite) |
| `.cache/veryfront-mdx-esm/` | `esm_modules` table (source_type="mdx"/"md") |
| `.cache/veryfront-http-bundle/` | `http_bundles` table |
| `.cache/veryfront-ssr/` | `ssr_cache` table |

---

## Future Enhancements (Not in Scope)

1. **LRU eviction** - Auto-delete oldest project DBs when disk >80% full (by DB mtime)
2. **Cache warming** - Pre-populate cache for top projects on deploy
3. **Shared cache** - Object storage (S3/GCS) for cross-pod sharing (if needed)
4. **Per-project metrics** - Track hit rates per project (if needed for debugging)
5. **Compression** - Use SQLite's `BLOB` with gzip for large files
6. **VACUUM scheduling** - Periodic VACUUM to reclaim space from deleted rows

---

# CLI Module Refactoring Plan

## Overview

Systematic refactoring of `src/cli/commands/` to apply the handler pattern consistently across all commands, improving maintainability, scanability, and modularity.

## Current State

### Well-Organized Commands (Subdirectories with Handler Pattern)
- `build/` - 13 files, has `handler.ts`
- `dev/` - 5 files, has `handler.ts`
- `generate/` - 8 files, has `handler.ts`
- `studio/` - has `handler.ts`
- `start/` - has `handler.ts`
- `init/` - 10 files (no handler yet)
- `doctor/` - 12 files (no handler yet)
- `install/` - 14 files (no handler yet)
- `demo/` - 8 files (no handler yet)

### Monolithic Commands (Need Subdirectories)
| File | Lines | Complexity |
|------|-------|------------|
| pull.ts | ~462 | High - multiple sub-operations |
| push.ts | ~364 | High |
| issues.ts | ~383 | Medium-high |
| dev.ts | ~334 | DUPLICATE - subdirectory exists |
| new.ts | ~319 | Medium |
| main.ts | ~273 | Medium |
| merge.ts | ~220 | Medium |
| up.ts | ~211 | Medium |
| deploy.ts | ~206 | Medium |
| lock.ts | ~195 | Low-medium |
| generate.ts | ~190 | DUPLICATE - subdirectory exists |
| clean.ts | ~140 | Low |
| studio.ts | ~90 | DUPLICATE - subdirectory exists |
| routes.ts | ~85 | Low |
| analyze-chunks.ts | ~80 | Low |

## Target Architecture

Each command should follow this structure:
```
{command}/
├── index.ts        # Barrel exports (command + handler)
├── handler.ts      # handleXCommand(args) - converts ParsedArgs to typed options
├── command.ts      # xCommand(options) - implementation logic
├── types.ts        # Type definitions (optional, if complex)
└── help.ts         # CommandHelp definition (optional, Phase 7)
```

### Handler Pattern Template
```typescript
// handler.ts
import type { ParsedArgs } from "../../index/types.ts";
import { xCommand } from "./command.ts";
import type { XCommandOptions } from "./types.ts";

export async function handleXCommand(args: ParsedArgs): Promise<void> {
  const options: XCommandOptions = {
    flag: args.flag ?? args.f,
    output: args.output ?? args.o,
    // ... convert all args to typed options
  };
  await xCommand(options);
}
```

---

## Implementation Phases

### Phase 0: Clean Up Duplicates (CRITICAL)
**Priority: Highest - blocks other work**

Files to resolve:
1. `dev.ts` (334 lines) vs `dev/` subdirectory → Delete dev.ts after verification
2. `generate.ts` (190 lines) vs `generate/` subdirectory → Delete generate.ts after verification
3. `studio.ts` (90 lines) vs `studio/` subdirectory → Delete studio.ts after verification

Actions:
- [ ] Verify dev/ subdirectory contains complete implementation
- [ ] Verify generate/ subdirectory contains complete implementation
- [ ] Verify studio/ subdirectory contains complete implementation
- [ ] Update commands/index.ts imports to use subdirectory exports
- [ ] Delete legacy flat files
- [ ] Run tests to verify nothing breaks

### Phase 1: Simple Commands (Low complexity, quick wins)
**Commands:** analyze-chunks, clean, routes, lock

For each command:
1. Create `{command}/` subdirectory
2. Create `handler.ts` with argument parsing
3. Move implementation to `command.ts`
4. Create `index.ts` barrel exports
5. Update `commands/index.ts`
6. Update `command-router.ts` to use handler
7. Move tests to subdirectory
8. Delete original flat file

### Phase 2: Medium Commands
**Commands:** merge, deploy, up

Same process as Phase 1, but may need:
- `types.ts` for complex option types
- Multiple implementation files if logic is complex

### Phase 3: Large Commands
**Commands:** pull, push, issues, new, main

These need more careful decomposition:
- Extract sub-operations into separate files
- Create shared utilities if patterns emerge
- May need multiple implementation modules

### Phase 4: Add Handlers to Existing Subdirectories
**Commands:** init, doctor, demo, install

These already have subdirectories but lack handlers:
1. Create `handler.ts` in each
2. Update `commands/index.ts` to export handlers
3. Update `command-router.ts` to use handlers

### Phase 5: Simplify command-router.ts
Current: 530-line switch statement
Target: ~100 lines with registry pattern

```typescript
// command-router.ts (simplified)
import { handlers } from "./command-handlers.ts";

export async function routeCommand(command: string, args: ParsedArgs): Promise<void> {
  const handler = handlers[command];
  if (!handler) {
    throw new Error(`Unknown command: ${command}`);
  }
  await handler(args);
}

// command-handlers.ts (new file)
export const handlers: Record<string, (args: ParsedArgs) => Promise<void>> = {
  build: handleBuildCommand,
  dev: handleDevCommand,
  generate: handleGenerateCommand,
  // ... all commands
};
```

### Phase 6: Standardize Help System (Optional)
Move help definitions from centralized `command-definitions.ts` to per-command `help.ts`:

```typescript
// pull/help.ts
import type { CommandHelp } from "../../help/types.ts";

export const pullHelp: CommandHelp = {
  name: "pull",
  description: "Pull files from API",
  usage: "vf pull [options]",
  options: [...],
  examples: [...],
};
```

---

## Commands Index Updates

### Current (partial)
```typescript
// Commands with handlers
export * from "./build/index.ts";
export * from "./dev/index.ts";
export * from "./generate/index.ts";

// Commands without handlers (need migration)
export { pullCommand } from "./pull.ts";
export { pushCommand } from "./push.ts";
// ...
```

### Target
```typescript
// All commands export from subdirectories
export * from "./analyze-chunks/index.ts";
export * from "./build/index.ts";
export * from "./clean/index.ts";
export * from "./demo/index.ts";
export * from "./deploy/index.ts";
export * from "./dev/index.ts";
export * from "./doctor/index.ts";
export * from "./generate/index.ts";
export * from "./init/index.ts";
export * from "./install/index.ts";
export * from "./issues/index.ts";
export * from "./lock/index.ts";
export * from "./main/index.ts";
export * from "./merge/index.ts";
export * from "./new/index.ts";
export * from "./pull/index.ts";
export * from "./push/index.ts";
export * from "./routes/index.ts";
export * from "./start/index.ts";
export * from "./studio/index.ts";
export * from "./up/index.ts";
```

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| command-router.ts lines | 530 | ~100 |
| Commands with handlers | 5 | 21 |
| Monolithic files | 15 | 0 |
| Duplicate implementations | 3 | 0 |
| Average command directory files | varies | 4-6 |

---

## Execution Order

```
Phase 0 (Duplicates)     → Phase 1 (Simple)     → Phase 2 (Medium)
     ↓                         ↓                       ↓
[dev.ts, generate.ts,    [analyze-chunks,        [merge, deploy, up]
 studio.ts cleanup]       clean, routes, lock]
                               ↓
Phase 4 (Add handlers)   ← Phase 3 (Large)
     ↓                         ↓
[init, doctor,           [pull, push, issues,
 demo, install]           new, main]
     ↓
Phase 5 (Router)         → Phase 6 (Help - optional)
     ↓
[command-router.ts       [Distribute help.ts
 simplification]          to each command]
```
