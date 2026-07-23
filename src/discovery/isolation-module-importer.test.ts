import { stop as stopBundler } from "veryfront/extensions/bundler";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import {
  collectProjectSourceSnapshot,
  createProjectSnapshotFileSystem,
} from "#veryfront/security/sandbox/project-source-snapshot.ts";
import { discoverAll } from "./discovery-engine.ts";

const HOST_IMPORT_CANARY = "__veryfront_discovery_host_import_canary__";

function discoveryConfig(
  fsAdapter: FileSystemAdapter,
): Parameters<typeof discoverAll>[0] {
  return {
    baseDir: "",
    fsAdapter,
    toolDirs: ["tools"],
    agentDirs: [],
    skillDirs: [],
    resourceDirs: [],
    promptDirs: [],
    workflowDirs: [],
    taskDirs: [],
    scheduleDirs: [],
    webhookDirs: [],
    evalDirs: [],
  };
}

async function snapshotFileSystem(
  files: Record<string, string>,
): Promise<FileSystemAdapter> {
  const adapter = createMockAdapter();
  for (const [sourcePath, content] of Object.entries(files)) {
    adapter.fs.files.set(`/project/${sourcePath}`, content);
  }
  const snapshot = await collectProjectSourceSnapshot({
    projectDir: "/project",
    fs: adapter.fs,
  });
  return createProjectSnapshotFileSystem(snapshot, "/snapshot");
}

describe("discovery isolation module importer", () => {
  afterAll(async () => {
    delete (globalThis as Record<string, unknown>)[HOST_IMPORT_CANARY];
    await stopBundler();
  });

  it("keeps the local transpiler as the default module importer", async () => {
    const fsAdapter = await snapshotFileSystem({
      "tools/default.ts": `export default {
        id: "default-loaded",
        type: "function",
        description: "Default importer test tool",
        inputSchema: {},
        execute() { return "ok"; },
      };`,
    });

    const result = await discoverAll(discoveryConfig(fsAdapter));

    assertEquals([...result.tools.keys()], ["default-loaded"]);
    assertEquals(result.errors, []);
  });

  it("never falls back to host import for a module absent from the injected snapshot map", async () => {
    delete (globalThis as Record<string, unknown>)[HOST_IMPORT_CANARY];
    const fsAdapter = await snapshotFileSystem({
      "tools/allowed.ts": `throw new Error("host importer evaluated allowed source");`,
      "tools/uncompiled.ts": `
        globalThis.${HOST_IMPORT_CANARY} = true;
        export default { id: "unsafe", execute() {} };
      `,
    });
    const importedFiles: string[] = [];
    const config = discoveryConfig(fsAdapter);
    config.moduleImporter = (file) => {
      importedFiles.push(file);
      if (file !== "file://tools/allowed.ts") {
        return Promise.reject(new TypeError("Module is absent from the immutable compiled map"));
      }
      return Promise.resolve({
        default: {
          id: "allowed",
          type: "function",
          description: "Injected importer test tool",
          inputSchema: {},
          execute: () => "ok",
        },
      });
    };

    const result = await discoverAll(config);

    assertEquals(importedFiles, [
      "file://tools/allowed.ts",
      "file://tools/uncompiled.ts",
    ]);
    assertEquals([...result.tools.keys()], ["allowed"]);
    assertEquals(result.errors.length, 1);
    assertEquals(
      result.errors[0]?.error.message,
      "Module is absent from the immutable compiled map",
    );
    assertEquals((globalThis as Record<string, unknown>)[HOST_IMPORT_CANARY], undefined);
  });

  it("uses the same injected importer for directory-agent colocated tools", async () => {
    delete (globalThis as Record<string, unknown>)[HOST_IMPORT_CANARY];
    const fsAdapter = await snapshotFileSystem({
      "agents/researcher/AGENT.md": `---
name: Researcher
tools: [lookup]
---
Research safely.`,
      "agents/researcher/tools/lookup.ts": `
        globalThis.${HOST_IMPORT_CANARY} = true;
        export default { id: "unsafe", execute() {} };
      `,
    });
    const config = discoveryConfig(fsAdapter);
    config.toolDirs = [];
    config.agentDirs = ["agents"];
    config.moduleImporter = (file) => {
      if (file !== "file://agents/researcher/tools/lookup.ts") {
        return Promise.reject(new TypeError("Unexpected immutable module path"));
      }
      return Promise.resolve({
        default: {
          id: "lookup",
          type: "function",
          description: "Colocated importer test tool",
          inputSchema: {},
          execute: () => "ok",
        },
      });
    };

    const result = await discoverAll(config);

    assertEquals([...result.agents.keys()], ["researcher"]);
    assertEquals(toolRegistry.get("researcher--lookup")?.ownerAgentId, "researcher");
    assertEquals(result.errors, []);
    assertEquals((globalThis as Record<string, unknown>)[HOST_IMPORT_CANARY], undefined);
  });
});
