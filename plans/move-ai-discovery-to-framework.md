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

- **`config-validator.ts`** — called once from `cli/commands/dev/command.ts`. It's 50 lines that validate AI provider config and print colored warnings. Move the `validateAIConfig()` function into `src/discovery/` (it's config validation, a framework concern). The `runAIConfigValidation()` wrapper that prints colored CLI output gets inlined into `dev/command.ts` — it's 15 lines, not worth a separate module.

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

In `FileWatchSetup.handleBatchedFileChanges()`, detect changes in AI directories and trigger re-discovery:

```typescript
private async handleBatchedFileChanges(changedPaths: string[]): Promise<void> {
  const aiDirs = ["tools", "agents", "workflows", "prompts", "resources"];
  const hasAIChanges = changedPaths.some(p =>
    aiDirs.some(dir => p.includes(`/${dir}/`) || p.includes(`\\${dir}\\`))
  );

  if (hasAIChanges) {
    await this.rediscoverAI();
  }

  // ... existing HMR logic for pages/components
}
```

The `rediscoverAI()` method clears registries and re-runs discovery:

```typescript
private async rediscoverAI(): Promise<void> {
  try {
    const { clearTranspileCache, discoverAll } = await import("#veryfront/discovery");
    clearTranspileCache();

    // Clear existing registries before re-discovery
    const { toolRegistry } = await import("#veryfront/tool");
    const { agentRegistry } = await import("#veryfront/agent");
    // ... clear other registries

    const config = this.buildDiscoveryConfig();
    const result = await discoverAll(config);

    logger.info(`[HMR] Re-discovered AI primitives: ${result.tools.size} tools, ${result.agents.size} agents, ${result.workflows.size} workflows`);
  } catch (error) {
    logger.warn("[HMR] AI re-discovery failed:", error);
  }
}
```

**2.4 Investigate registry clearing**

Before implementing 2.3, verify that each registry (toolRegistry, agentRegistry, etc.) supports clearing/replacing entries. If not, add `clear()` or `unregister()` methods. Check:
- `src/tool/registry.ts`
- `src/agent/composition/index.ts` (agentRegistry)
- `src/workflow/registry.ts`
- `src/prompt/registry.ts` (if it exists)
- `src/resource/registry.ts` (if it exists)

### Phase 3: Remove CLI orchestration

**3.1 Remove `discoverAll()` calls from CLI commands**

In `cli/commands/dev/command.ts`, remove:
```typescript
// REMOVE:
import { discoverAll } from "../../discovery/index.ts";
// ...
try {
  await discoverAll({ baseDir: projectDir, verbose: false });
} catch {
  // AI discovery skipped
}
```

The dev server now handles this internally.

In `cli/commands/start/command.ts`, remove all 4 `discoverAll()` calls. The start command creates a dev server or production server — both should handle discovery internally.

**3.2 Add discovery to production server**

In `src/server/production-server.ts`, add a one-time `discoverAll()` call at startup (no file watching needed):

```typescript
import { discoverAll } from "#veryfront/discovery";

// During production server startup:
try {
  await discoverAll({
    baseDir: projectDir,
    verbose: false,
  });
} catch {
  // AI discovery optional in production
}
```

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
      const { json: tools } = await fetchJson(server, "/_dev/api/tools");
      const toolIds = tools.map((t: any) => t.id);
      assert(toolIds.includes("greet"), "Tool 'greet' should be auto-discovered");

      // Verify agents discovered via dashboard API
      const { json: agents } = await fetchJson(server, "/_dev/api/agents");
      const agentIds = agents.map((a: any) => a.id);
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

**5.1 Update `cli/discovery/CLAUDE.md`**

Update to reflect that core discovery logic now lives in `src/discovery/`.

**5.2 Update `src/README.md`**

Add `discovery/` to the module listing.

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

**Medium risk:**
- HMR re-discovery (Phase 2.3) — registry clearing needs investigation. If registries don't support clearing, tools/agents could accumulate on re-discovery. Phase 2.4 addresses this.
- The `transpiler.ts` module uses esbuild and writes temp files — needs to work correctly from `src/` context. The existing code uses absolute paths so this should be fine.

**Not in scope:**
- Agent-aware SSR streaming
- AI-specific middleware hooks
- Build-time agent validation
- These are separate, future enhancements
