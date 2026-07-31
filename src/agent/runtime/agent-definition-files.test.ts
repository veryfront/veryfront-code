import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { resolve } from "node:path";
import {
  loadRuntimeAgentMarkdownDefinitionFromFile,
  resolveRuntimeAgentDefinitionsDir,
  resolveRuntimeAgentMarkdownDefinitionFilePath,
} from "./agent-definition-files.ts";

function withTempDir(fn: (dir: string) => void): void {
  const dir = Deno.makeTempDirSync();
  try {
    fn(dir);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

Deno.test("resolveRuntimeAgentDefinitionsDir resolves source and bundled agent directories", () => {
  withTempDir((rootDir) => {
    const agentsDir = resolve(rootDir, "agents");
    Deno.mkdirSync(agentsDir, { recursive: true });
    Deno.writeTextFileSync(
      resolve(agentsDir, "support.md"),
      "---\nname: Support\n---\nHelp users.",
    );

    assertEquals(
      resolveRuntimeAgentDefinitionsDir({
        baseDir: rootDir,
        id: "support",
      }),
      agentsDir,
    );
    assertEquals(
      resolveRuntimeAgentDefinitionsDir({
        baseDir: resolve(rootDir, "src"),
        id: "support",
      }),
      agentsDir,
    );
    assertEquals(
      resolveRuntimeAgentDefinitionsDir({
        baseDir: resolve(rootDir, "dist", "src"),
        id: "support",
      }),
      agentsDir,
    );
    assertEquals(
      resolveRuntimeAgentDefinitionsDir({
        baseDir: resolve(rootDir, "dist", "server", "src"),
        id: "support",
      }),
      agentsDir,
    );
  });
});

Deno.test("resolveRuntimeAgentDefinitionsDir falls back to the nearest source-layout candidate", () => {
  withTempDir((rootDir) => {
    assertEquals(
      resolveRuntimeAgentDefinitionsDir({
        baseDir: rootDir,
        id: "support",
      }),
      resolve(rootDir, "agents"),
    );
    assertEquals(
      resolveRuntimeAgentDefinitionsDir({
        baseDir: resolve(rootDir, "src"),
        id: "support",
      }),
      resolve(rootDir, "agents"),
    );
  });
});

Deno.test("loadRuntimeAgentMarkdownDefinitionFromFile reads and parses markdown definitions", () => {
  withTempDir((rootDir) => {
    const agentsDir = resolve(rootDir, "agents");
    Deno.mkdirSync(agentsDir, { recursive: true });
    Deno.writeTextFileSync(
      resolve(agentsDir, "writer.md"),
      `---
name: Writer
description: Writes copy
model: gpt-5.4
---

Draft concise copy.
`,
    );

    assertEquals(
      resolveRuntimeAgentMarkdownDefinitionFilePath({ agentsDir, id: "writer" }),
      resolve(agentsDir, "writer.md"),
    );
    assertEquals(
      loadRuntimeAgentMarkdownDefinitionFromFile({ agentsDir, id: "writer" }),
      {
        id: "writer",
        name: "Writer",
        description: "Writes copy",
        model: "gpt-5.4",
        instructions: "Draft concise copy.",
      },
    );
  });
});

Deno.test("runtime agent definition file helpers reject traversal-prone names", () => {
  withTempDir((rootDir) => {
    assertThrows(() =>
      resolveRuntimeAgentDefinitionsDir({
        baseDir: rootDir,
        id: "../escape",
      })
    );
    assertThrows(() =>
      loadRuntimeAgentMarkdownDefinitionFromFile({
        agentsDir: rootDir,
        id: "support",
        fileName: "../support.md",
      })
    );
  });
});
