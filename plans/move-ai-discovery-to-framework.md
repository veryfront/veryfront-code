# Move AI Discovery from CLI to Framework

Move the AI primitives discovery system (`cli/discovery/`) into the framework (`src/`) so it becomes a framework-level capability rather than a CLI-level orchestration concern.

## Motivation

Today, auto-discovery of AI primitives (agents, tools, workflows, prompts, resources) lives in `cli/discovery/` and is called from `cli/commands/dev/command.ts` and `cli/commands/start/command.ts`. This means:

1. **No HMR for AI primitives** — The dev server's file watcher watches `pages/`, `components/`, `app/`, `styles/`, `public/` but not `tools/`, `agents/`, `workflows/`, `prompts/`, or `resources/`. Editing an agent file requires restarting the dev server.

2. **Programmatic usage misses discovery** — Anyone using the framework via `createDevServer()` or the production server directly (without the CLI) doesn't get auto-discovery. The server has no knowledge of it.

3. **CLI orchestrates framework concerns** — Discovery determines what tools/agents are available at runtime. That's a framework responsibility, not a CLI responsibility. The CLI should just configure *where* to look, not *how* to discover and register.

## Goal

After this change:
- `deno task dev` → editing `tools/search.ts` triggers HMR and re-registers the tool
- `createDevServer({ projectDir: "." })` → auto-discovers without CLI involvement
- Production server → discovers at startup (once, no file watching)
- CLI commands → pass config to the framework, don't call `discoverAll()` themselves

## Current Architecture

```
cli/commands/dev/command.ts
  ├── calls discoverAll({ baseDir: projectDir })     ← CLI orchestrates
  ├── calls createDevServer(options)                  ← framework starts
  └── calls createMCPServer(config)                   ← CLI starts MCP

cli/discovery/
  ├── discovery-engine.ts    ← discoverAll() orchestrator
  ├── file-discovery.ts      ← findTypeScriptFiles() recursive scanner
  ├── transpiler.ts          ← importModule() esbuild transpile + dynamic import
  ├── import-rewriter.ts     ← rewrite imports for Deno/Node compat
  ├── discovery-utils.ts     ← filenameToId(), agent path tracking
  ├── config-validator.ts    ← validateAIConfig() provider key checks
  ├── agent-index.ts         ← generateAgentIndex() codegen
  ├── types.ts               ← DiscoveryConfig, DiscoveryResult, etc.
  └── handlers/
      ├── tool-handler.ts    ← validate + registerTool()
      ├── agent-handler.ts   ← validate + registerAgent()
      ├── workflow-handler.ts
      ├── prompt-handler.ts
      └── resource-handler.ts
```

## Target Architecture

```
src/discovery/                        ← NEW: framework-level discovery
  ├── index.ts                        ← public API
  ├── discovery-engine.ts             ← discoverAll() (moved from cli/)
  ├── file-discovery.ts               ← findTypeScriptFiles() (moved)
  ├── transpiler.ts                   ← importModule() (moved)
  ├── import-rewriter.ts              ← import rewriting (moved)
  ├── discovery-utils.ts              ← ID generation, path tracking (moved)
  ├── types.ts                        ← types (moved)
  └── handlers/                       ← registration handlers (moved)
      ├── index.ts
      ├── tool-handler.ts
      ├── agent-handler.ts
      ├── workflow-handler.ts
      ├── prompt-handler.ts
      └── resource-handler.ts

src/server/dev-server/
  ├── file-watch-setup.ts             ← MODIFIED: watch AI directories too
  └── server.ts                       ← MODIFIED: call discoverAll() on start

cli/discovery/                        ← DELETED entirely

cli/commands/dev/command.ts           ← MODIFIED: remove discoverAll(), inline config validation
cli/commands/start/command.ts         ← MODIFIED: remove discoverAll() calls
```

## Constraints

- **No user-facing changes** — `tools/`, `agents/` etc. directories keep working the same way
- **No new dependencies** — discovery already uses only framework imports (`#veryfront/*`)
- **Clean break** — CLI callers update to import from `#veryfront/discovery` directly, no re-export shims
- **Config-driven** — discovery directories come from `VeryfrontConfig.ai.tools.discovery.paths` etc.

## Detailed Plan

### Phase 1: Move discovery module to framework

**1.1 Create `src/discovery/` module**

Move these files from `cli/discovery/` to `src/discovery/`:
- `discovery-engine.ts`
- `file-discovery.ts`
- `transpiler.ts`
- `import-rewriter.ts`
- `discovery-utils.ts`
- `types.ts`
- `handlers/` (all 6 files)

Use `git mv` to preserve history.

**1.2 Add deno.json alias**

Add `#veryfront/discovery` import map entry:

```json
"#veryfront/discovery": "./src/discovery/index.ts"
```

**1.3 Delete `cli/discovery/` entirely**

After the `git mv`, delete the entire `cli/discovery/` directory. The two remaining files don't justify keeping it:

- **`config-validator.ts`** — called once from `cli/commands/dev/command.ts`. Move `validateAIConfig()` into `src/discovery/` but **strip ANSI color codes** (`bold()`, `cyan()`) from the warning messages. Framework code must not depend on terminal formatting. Return plain strings; the CLI's `runAIConfigValidation()` wrapper applies colors when printing. Inline that wrapper into `dev/command.ts` — it's 15 lines, not worth a separate module.

- **`agent-index.ts`** — `generateAgentIndex()` is exported but **never called anywhere**. Dead code. Delete it.

- **`config-validator.test.ts`** — move to `src/discovery/` alongside `validateAIConfig`.

**1.4 Update CLI callers**

| CLI file | Change |
|----------|--------|
| `cli/commands/dev/command.ts` | Remove `discoverAll` import. Remove `runAIConfigValidation` import. Inline the warning printing (or import `validateAIConfig` from `#veryfront/discovery`). |
| `cli/commands/start/command.ts` | Remove all `discoverAll` imports. |

**1.7 Verify typecheck**

```bash
deno task typecheck
```

### Phase 2: Integrate discovery into dev server

**2.1 Add discovery to `DevServer.start()`**

In `src/server/dev-server/server.ts`, call `discoverAll()` during server startup, after config is loaded but before the request handler is created:

```typescript
import { discoverAll } from "#veryfront/discovery";

// In DevServer.start(), after bootstrapDev():
try {
  const discoveryConfig = this.buildDiscoveryConfig();
  await discoverAll(discoveryConfig);
} catch (error) {
  logger.debug("[DevServer] AI discovery skipped:", error);
}
```

The discovery config is built from `VeryfrontConfig`:

```typescript
private buildDiscoveryConfig(): DiscoveryConfig {
  const ai = this.appConfig?.ai;
  return {
    baseDir: this.options.projectDir,
    toolDirs: ai?.tools?.discovery?.paths ?? ["tools"],
    agentDirs: ai?.agents?.discovery?.paths ?? ["agents"],
    resourceDirs: ["resources"],
    promptDirs: ["prompts"],
    workflowDirs: ["workflows"],
    fsAdapter: this.adapter.fs,
    verbose: this.isDebug(),
  };
}
```

**2.2 Add AI directories to file watcher**

In `src/server/dev-server/file-watch-setup.ts`, add AI directories to `getWatchPaths()`:

```typescript
private async getWatchPaths(): Promise<string[]> {
  const potentialPaths = [
    this.projectDir,
    join(this.projectDir, "pages"),
    join(this.projectDir, "components"),
    join(this.projectDir, "styles"),
    join(this.projectDir, "public"),
    join(this.projectDir, "app"),
    // AI primitive directories
    join(this.projectDir, "tools"),
    join(this.projectDir, "agents"),
    join(this.projectDir, "workflows"),
    join(this.projectDir, "prompts"),
    join(this.projectDir, "resources"),
  ];
  // ... rest stays the same
}
```

**2.3 Handle AI file changes in HMR**

In `FileWatchSetup.handleBatchedFileChanges()`, detect changes in AI directories and trigger re-discovery.

**Path matching** — use path segment boundaries, not substring `includes()`. A naive `p.includes("/tools/")` would false-match paths like `my-tools/` or `dev-tools-backup/`. Instead, resolve relative to `projectDir` and check the first path segment:

```typescript
import { relative, sep } from "#veryfront/platform/compat/path/index.ts";

const AI_DIRS = new Set(["tools", "agents", "workflows", "prompts", "resources"]);

private isAIPath(fullPath: string): boolean {
  const rel = relative(this.projectDir, fullPath);
  const firstSegment = rel.split(sep)[0];
  return AI_DIRS.has(firstSegment);
}

private async handleBatchedFileChanges(changedPaths: string[]): Promise<void> {
  const hasAIChanges = changedPaths.some(p => this.isAIPath(p));

  if (hasAIChanges) {
    await this.rediscoverAI();
  }

  // ... existing HMR logic for pages/components
}
```

**Atomic re-discovery** — don't clear registries before re-running discovery. That creates a window where concurrent requests see empty registries. Instead, discover into fresh result first, then swap atomically:

```typescript
private async rediscoverAI(): Promise<void> {
  try {
    const { clearTranspileCache, discoverAll } = await import("#veryfront/discovery");
    clearTranspileCache();

    // Discover first, THEN clear+replace — avoids empty registry window
    const config = this.buildDiscoveryConfig();
    const result = await discoverAll(config);

    // Now atomically replace registries with freshly discovered primitives
    // discoverAll() already calls registerTool/registerAgent/etc. which
    // replace existing entries by ID. So we only need to clear entries
    // that no longer exist on disk (i.e., deleted files).
    // The handlers' register functions use set-by-id semantics, so
    // re-registering the same ID overwrites cleanly.
    //
    // To handle deletions: clear, then re-register in a single synchronous step.
    // Since JS is single-threaded, no request can interleave between clear and the
    // synchronous part of registration.
    // However, discoverAll is async (file I/O). So the approach is:
    // 1. Run discoverAll() which populates a fresh DiscoveryResult
    // 2. Clear all registries
    // 3. Re-register from the result (sync loop)
    //
    // Alternative: discoverAll already registers as it discovers. If we accept
    // that deleted files leave stale entries until restart, we skip the clear
    // entirely. This is the simpler approach and acceptable for dev mode.

    logger.info(`[HMR] Re-discovered AI primitives: ${result.tools.size} tools, ${result.agents.size} agents, ${result.workflows.size} workflows`);
  } catch (error) {
    logger.warn("[HMR] AI re-discovery failed:", error);
  }
}
```

**Simplification note:** `discoverAll()` already registers each primitive as it discovers it (via `registerTool()`, `registerAgent()`, etc.), which uses set-by-id semantics (overwrites existing). For dev mode HMR, the simplest correct approach is to just re-run `discoverAll()` without clearing — modified/added files get re-registered, and deleted files leave stale entries until the next full restart. This matches how page HMR works (no route un-registration on delete). If precise deletion handling is needed later, it can be added as a follow-up.

**2.4 Investigate registry clearing**

Before implementing 2.3, verify that each registry (toolRegistry, agentRegistry, etc.) supports clearing/replacing entries. If not, add `clear()` or `unregister()` methods. Check:
- `src/tool/registry.ts`
- `src/agent/composition/index.ts` (agentRegistry)
- `src/workflow/registry.ts`
- `src/prompt/registry.ts` (if it exists)
- `src/resource/registry.ts` (if it exists)

### Phase 3: Remove CLI orchestration

**3.1 Remove `discoverAll()` calls from CLI commands**

In `cli/commands/dev/command.ts`, remove the single `discoverAll()` call. The dev server now handles this internally.

In `cli/commands/start/command.ts`, the start command has **3 distinct discovery strategies** depending on server mode. All 4 `discoverAll()` calls must be removed and the logic moved into the framework:

| Mode | Current CLI code | Where discovery moves |
|------|-----------------|----------------------|
| **Proxy + multi-project FSAdapter** | `adapter.fs.runWithContext(slug, token, () => discoverAll({ baseDir: "", fsAdapter: adapter.fs }))` | Production server — needs project context (slug + token) passed via `ServerOptions` |
| **Proxy + single-project FSAdapter** | `discoverAll({ baseDir: "", fsAdapter: adapter.fs })` | Production server — uses FSAdapter with empty baseDir |
| **Proxy + local filesystem** | `discoverAll({ baseDir: projectDir })` | Production server — standard local discovery |
| **Non-proxy dev server** | `discoverAll({ baseDir: projectDir })` | Dev server (Phase 2.1 already handles this) |

The key complexity is the **proxy + multi-project mode**: the FSAdapter reads files from the Veryfront API (not local disk), and `runWithContext()` sets the project scope via AsyncLocalStorage. The production server needs to accept discovery configuration that includes:
- `fsAdapter` — the filesystem adapter (local or API-backed)
- `projectSlug` + `apiToken` — for multi-project context scoping
- `baseDir` — empty string for FSAdapter modes, project path for local

**3.2 Add discovery to production server**

In `src/server/production-server.ts`, add discovery as part of `startUniversalServer()`. Discovery must run **before `adapter.serve()`** to ensure registries are populated before the first request is handled.

Add an optional `discoveryConfig` to `ServerOptions`:

```typescript
interface ServerOptions {
  // ... existing fields ...
  /** Discovery configuration for AI primitives. If provided, runs discoverAll() before serving. */
  discoveryConfig?: {
    baseDir: string;
    fsAdapter?: FSAdapter;
    /** For multi-project proxy mode: project slug for context scoping */
    projectSlug?: string;
    /** For multi-project proxy mode: API token for context scoping */
    apiToken?: string;
    verbose?: boolean;
  };
}
```

In `startUniversalServer()`, after bootstrap but **before `adapter.serve()`**:

```typescript
// Run AI discovery before serving (registries must be populated before first request)
if (discoveryConfig) {
  try {
    const { discoverAll } = await import("#veryfront/discovery");
    const { isExtendedFSAdapter } = await import("#veryfront/platform/adapters/fs/wrapper.ts");

    if (discoveryConfig.projectSlug && discoveryConfig.apiToken &&
        discoveryConfig.fsAdapter && isExtendedFSAdapter(discoveryConfig.fsAdapter) &&
        discoveryConfig.fsAdapter.isMultiProjectMode()) {
      // Multi-project proxy: scope discovery to specific project
      await discoveryConfig.fsAdapter.runWithContext(
        discoveryConfig.projectSlug,
        discoveryConfig.apiToken,
        () => discoverAll({
          baseDir: discoveryConfig.baseDir,
          fsAdapter: discoveryConfig.fsAdapter,
          verbose: discoveryConfig.verbose ?? false,
        }),
      );
    } else {
      await discoverAll({
        baseDir: discoveryConfig.baseDir,
        fsAdapter: discoveryConfig.fsAdapter,
        verbose: discoveryConfig.verbose ?? false,
      });
    }
  } catch (error) {
    logger.debug("[Server] AI discovery skipped:", error);
  }
}
```

The CLI's `start/command.ts` then simply passes the right `discoveryConfig` to `startUniversalServer()` based on its mode, instead of calling `discoverAll()` directly. This moves the *execution* to the framework while the CLI still provides the *configuration*.

**3.3 Config validation**

`validateAIConfig()` moves to `src/discovery/` (it's pure validation logic — returns `{ valid, warnings, errors }`). The CLI's `dev/command.ts` calls it and handles the colored console output itself — that's the only CLI part.

### Phase 4: Tests and verification

**4.1 Move tests**

Move `cli/discovery/index.test.ts` and `cli/discovery/auto-discovery.integration.test.ts` to `src/discovery/`. Update imports from `./index.ts` to `#veryfront/discovery`.

**4.2 E2E test: server discovers tools without CLI orchestration**

Add `tests/e2e/features/ai-discovery.test.ts` that proves the full chain works end-to-end via the compiled binary:

```typescript
describe("Feature: AI Discovery", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  it("should auto-discover tools and expose via dev dashboard API", async () => {
    const projectDir = await createProject("ai-discovery", pages.basic, {
      files: {
        "tools/greet.ts": `
          import { tool } from "veryfront/tool";
          import { z } from "zod";
          export default tool({
            id: "greet",
            description: "Greet someone",
            schema: z.object({ name: z.string() }),
            execute: async ({ name }) => ({ message: \`Hello \${name}\` }),
          });
        `,
        "agents/helper.ts": `
          import { agent } from "veryfront/agent";
          export default agent({
            id: "helper",
            model: "gpt-4o",
            description: "A helper agent",
          });
        `,
      },
    });

    await withServer(projectDir, async (server) => {
      // Verify tools discovered via dashboard API
      // Response format: { tools: [...], count: N }
      const { json: toolsResp } = await fetchJson(server, "/_dev/api/tools");
      const toolIds = toolsResp.tools.map((t: any) => t.id);
      assert(toolIds.includes("greet"), "Tool 'greet' should be auto-discovered");

      // Verify agents discovered via dashboard API
      // Response format: { agents: [...], count: N }
      const { json: agentsResp } = await fetchJson(server, "/_dev/api/agents");
      const agentIds = agentsResp.agents.map((a: any) => a.id);
      assert(agentIds.includes("helper"), "Agent 'helper' should be auto-discovered");
    });
  });

  it("should handle projects with no AI primitives", async () => {
    const projectDir = await createProject("no-ai", pages.basic);

    await withServer(projectDir, async (server) => {
      const { response } = await fetchJson(server, "/_dev/api/tools");
      assertStatus(response, 200);
    });
  });
});
```

This test verifies:
- Server boots and discovers `tools/greet.ts` and `agents/helper.ts` from filesystem
- No CLI involvement — the framework handles discovery internally
- Dashboard API returns discovered primitives (proves registration worked)
- Projects without AI directories don't break

**4.3 Add HMR re-discovery test**

Add a test that verifies file changes in `tools/` trigger re-discovery. This can be a unit test on `FileWatchSetup` or an e2e test that writes a new tool file after server start and checks the dashboard API again.

**4.4 Full test run**

```bash
deno task test
```

### Phase 5: Cleanup

**5.1 Update `src/README.md`**

Add `discovery/` to the module listing.

**5.2 Update any `CLAUDE.md` references**

If any `CLAUDE.md` files reference `cli/discovery/`, update them to point to `src/discovery/`. The `cli/discovery/CLAUDE.md` is deleted along with the directory.

## Files Changed

| Action | File | Notes |
|--------|------|-------|
| `git mv` | `cli/discovery/discovery-engine.ts` → `src/discovery/` | Core orchestrator |
| `git mv` | `cli/discovery/file-discovery.ts` → `src/discovery/` | File scanner |
| `git mv` | `cli/discovery/transpiler.ts` → `src/discovery/` | esbuild transpiler |
| `git mv` | `cli/discovery/import-rewriter.ts` → `src/discovery/` | Import transforms |
| `git mv` | `cli/discovery/discovery-utils.ts` → `src/discovery/` | Utilities |
| `git mv` | `cli/discovery/types.ts` → `src/discovery/` | Type definitions |
| `git mv` | `cli/discovery/handlers/` → `src/discovery/handlers/` | All 6 handler files |
| `git mv` | `cli/discovery/index.test.ts` → `src/discovery/` | Tests |
| `git mv` | `cli/discovery/auto-discovery.integration.test.ts` → `src/discovery/` | Integration tests |
| `git mv` | `cli/discovery/config-validator.ts` → `src/discovery/` | AI config validation |
| `git mv` | `cli/discovery/config-validator.test.ts` → `src/discovery/` | Config validation tests |
| create | `src/discovery/index.ts` | Public API |
| delete | `cli/discovery/` | Entire directory removed |
| delete | `cli/discovery/agent-index.ts` | Dead code (never called) |
| modify | `cli/commands/dev/command.ts` | Remove `discoverAll()` + inline config warning printing |
| modify | `cli/commands/start/command.ts` | Remove all `discoverAll()` calls |
| modify | `deno.json` | Add `#veryfront/discovery` alias, remove `cli/discovery` from lint/test globs if present |
| modify | `src/server/dev-server/server.ts` | Call `discoverAll()` on start |
| modify | `src/server/dev-server/file-watch-setup.ts` | Watch AI directories |
| modify | `src/server/production-server.ts` | Call `discoverAll()` on start |

## Risk Assessment

**Low risk:**
- Moving files with `git mv` preserves history
- Discovery errors are already silently caught (`catch {}`)
- HMR re-discovery in dev mode — `discoverAll()` uses set-by-id semantics so re-running it just overwrites existing entries. Deleted files leave stale entries until restart, which is acceptable for dev mode.

**Medium risk:**
- The `transpiler.ts` module uses esbuild and writes temp files — needs to work correctly from `src/` context. The existing code uses absolute paths so this should be fine.
- Multi-project proxy mode has complex context scoping (`runWithContext()` with slug + token). The `discoveryConfig` option on `ServerOptions` must be wired correctly by the CLI.

**Mitigated (addressed in plan):**
- ~~HMR race condition~~ — addressed by not clearing registries before re-discovery (Phase 2.3)
- ~~Production server ordering~~ — discovery runs before `adapter.serve()` (Phase 3.2)
- ~~start/command.ts complexity~~ — 3 strategies documented and handled via `discoveryConfig` (Phase 3.1)
- ~~validateAIConfig ANSI colors~~ — stripped before moving to framework (Phase 1.3)
- ~~File watcher path matching~~ — uses `relative()` + first path segment check (Phase 2.3)
- ~~E2E test response format~~ — uses `{ tools: [...] }` wrapper (Phase 4.2)

**Not in scope:**
- Agent-aware SSR streaming
- AI-specific middleware hooks
- Build-time agent validation
- These are separate, future enhancements
