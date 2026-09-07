import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { createExecutorDiscovery } from "#veryfront/agent/hosted/executor-discovery.ts";
import {
  ExecutorDiscoveryError,
  getExecutorAgentDescribeResultSchema,
  getExecutorDiscoveryResultSchema,
} from "#veryfront/agent/hosted/executor-discovery-schema.ts";

const source = { type: "release", releaseId: "synthetic-release" } as const;
const binding = {
  allocationId: "filesystem-allocation",
  invocationId: "filesystem-invocation",
  generation: 1,
};

async function project() {
  const dir = await mkdtemp(join(tmpdir(), "vf-executor-discovery-"));
  const loaded = join(dir, "config-loaded");
  const projected = join(dir, "agent-projected");
  await mkdir(join(dir, "crew"));
  await writeFile(
    join(dir, "veryfront.config.ts"),
    [
      'import { appendFileSync } from "node:fs";',
      `appendFileSync(${JSON.stringify(loaded)}, "loaded\\n");`,
      'export default { ai: { agents: { discovery: { paths: ["crew"] } } } };',
    ].join("\n"),
  );
  await writeFile(
    join(dir, "crew", "writer.md"),
    "---\nname: Writer\n---\n\nSynthetic markdown instructions.\n",
  );
  await writeFile(
    join(dir, "crew", "coder.ts"),
    [
      'import { appendFileSync } from "node:fs";',
      'export default { id: "coder", config: { id: "coder", name: "Coder", model: "auto",',
      `  system() { appendFileSync(${
        JSON.stringify(projected)
      }, "projected\\n"); return "Synthetic code instructions."; } },`,
      '  async generate() { throw new Error("Inference is not used in discovery"); },',
      '  async stream() { throw new Error("Inference is not used in discovery"); },',
      '  async respond() { throw new Error("Inference is not used in discovery"); },',
      '  getMemory() { throw new Error("Memory is not used in discovery"); },',
      '  async getMemoryStats() { return { totalMessages: 0, estimatedTokens: 0, type: "test" }; },',
      "  async clearMemory() {},",
      "};",
    ].join("\n"),
  );
  return { dir, loaded, projected, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function owner(dir: string, defaultAgentId?: string) {
  return createExecutorDiscovery({
    binding,
    source,
    projectDir: dir,
    defaultAgentId,
    signal: new AbortController().signal,
  });
}
async function request(discovery: ReturnType<typeof owner>, name: string, value: JsonValue = {}) {
  const operation = discovery.operations.get(name);
  assert(operation?.mode === "unary");
  return await operation.handle(value, {
    binding,
    signal: new AbortController().signal,
    deadline: Date.now() + 30_000,
  });
}

describe("isolated executor local project discovery", () => {
  it("loads configured code and markdown only after an operation and retains executable state locally", async () => {
    const p = await project();
    const discovery = owner(p.dir, "writer");
    try {
      assertEquals(existsSync(p.loaded), false);
      assertEquals(await request(discovery, "discovery.describe", { projectDir: p.dir }), {
        ok: false,
        code: "EXECUTOR_DISCOVERY_INVALID_INPUT",
      });
      assertEquals(existsSync(p.loaded), false);
      const summary = getExecutorDiscoveryResultSchema().parse(
        await request(discovery, "discovery.describe"),
      );
      assert(summary.ok);
      assertEquals(summary.value.candidates, {
        codeAgentIds: ["coder"],
        markdownAgentIds: ["writer"],
      });
      assertEquals(summary.value.defaultAgentId, "writer");
      assertEquals(
        summary.value.definition.instructions.trim(),
        "Synthetic markdown instructions.",
      );
      assertEquals(existsSync(p.projected), false);
      const code = getExecutorAgentDescribeResultSchema().parse(
        await request(discovery, "agent.describe", { agentId: "coder" }),
      );
      assert(code.ok);
      assertEquals(code.value.definition.instructions, "Synthetic code instructions.");
      await request(discovery, "agent.describe", { agentId: "coder" });
      assertEquals(await readFile(p.loaded, "utf8"), "loaded\n");
      assertEquals(await readFile(p.projected, "utf8"), "projected\n");
      assertEquals(typeof discovery.getRuntime().agents.get("coder")?.config.system, "function");
      assertEquals(JSON.stringify(summary).includes(p.dir), false);
    } finally {
      await discovery.close();
      await p.cleanup();
    }
    assertThrows(() => discovery.getRuntime(), ExecutorDiscoveryError);
    assertEquals(agentRegistry.get("coder"), undefined);
    assertEquals(agentRegistry.get("writer"), undefined);
  });

  it("retains the existing ambiguity error for a real mixed-source project", async () => {
    const p = await project();
    const discovery = owner(p.dir);
    try {
      assertEquals(await request(discovery, "discovery.describe"), {
        ok: false,
        code: "CONFIG_INVALID",
      });
      assertEquals(existsSync(p.projected), false);
      const selected = getExecutorAgentDescribeResultSchema().parse(
        await request(discovery, "agent.describe", { agentId: "coder" }),
      );
      assert(selected.ok);
    } finally {
      await discovery.close();
      await p.cleanup();
    }
  });

  it("preserves valid metadata while keeping collected import errors local", async () => {
    const p = await project();
    await writeFile(
      join(p.dir, "crew", "broken.ts"),
      'throw new Error("synthetic-private-import-diagnostic");\nexport default {};',
    );
    const discovery = owner(p.dir, "writer");
    try {
      const result = getExecutorDiscoveryResultSchema().parse(
        await request(discovery, "discovery.describe"),
      );
      assert(result.ok);
      assertEquals(result.value.errorCount, 1);
      assertEquals(discovery.getRuntime().errors.length, 1);
      assertEquals(JSON.stringify(result).includes("synthetic-private-import-diagnostic"), false);
      assertEquals(JSON.stringify(result).includes(p.dir), false);
    } finally {
      await discovery.close();
      await p.cleanup();
    }
  });

  it("rejects a competing default-scope owner without clearing the active runtime", async () => {
    const p = await project();
    const first = owner(p.dir, "writer");
    const second = owner(p.dir, "writer");
    try {
      await request(first, "discovery.describe");
      assertEquals(await request(second, "discovery.describe"), {
        ok: false,
        code: "EXECUTOR_DISCOVERY_BUSY",
      });
      await second.close();
      assertEquals(first.getRuntime().agents.has("writer"), true);
      assertEquals(agentRegistry.get("writer")?.id, "writer");
    } finally {
      await second.close();
      await first.close();
      await p.cleanup();
    }
  });

  for (const fsType of ["veryfront-api", "github"] as const) {
    it(`discovers constructor-local sources when application fs is ${fsType}`, async () => {
      const p = await project();
      await writeFile(
        join(p.dir, "veryfront.config.ts"),
        `export default ${
          JSON.stringify({
            fs: fsType === "veryfront-api" ? { type: fsType, veryfront: {} } : {
              type: fsType,
              github: { token: "synthetic-unused-token", owner: "synthetic", repo: "synthetic" },
            },
            ai: { agents: { discovery: { paths: ["crew"] } } },
          })
        };`,
      );
      const discovery = owner(p.dir, "writer");
      try {
        const result = getExecutorDiscoveryResultSchema().parse(
          await request(discovery, "discovery.describe"),
        );
        assert(result.ok);
        assertEquals(result.value.candidates, {
          codeAgentIds: ["coder"],
          markdownAgentIds: ["writer"],
        });
        assertEquals(
          result.value.definition.instructions.trim(),
          "Synthetic markdown instructions.",
        );
      } finally {
        await discovery.close();
        await p.cleanup();
      }
    });
  }

  it("keeps markdown fallback inside the bound source, including symlink targets", async () => {
    const p = await project();
    const bound = join(p.dir, "nested", "project");
    await mkdir(join(bound, "agents"), { recursive: true });
    await mkdir(join(p.dir, "agents"));
    await writeFile(
      join(bound, "veryfront.config.ts"),
      "export default { ai: { agents: { discovery: { enabled: false } } } };",
    );
    await writeFile(
      join(bound, "agents", "inside.md"),
      "---\nname: Inside\n---\n\nSynthetic bound-source instructions.\n",
    );
    const outside = join(p.dir, "agents", "outside.md");
    await writeFile(
      outside,
      "---\nname: Outside\n---\n\nSynthetic neighboring-source instructions.\n",
    );
    await symlink(outside, join(bound, "agents", "outside-alias.md"));
    const discovery = owner(bound, "inside");
    try {
      assertEquals(await request(discovery, "agent.describe", { agentId: "outside" }), {
        ok: false,
        code: "AGENT_NOT_FOUND",
      });
      assertEquals(await request(discovery, "agent.describe", { agentId: "outside-alias" }), {
        ok: false,
        code: "AGENT_NOT_FOUND",
      });
      const result = getExecutorDiscoveryResultSchema().parse(
        await request(discovery, "discovery.describe"),
      );
      assert(result.ok);
      assertEquals(
        result.value.definition.instructions.trim(),
        "Synthetic bound-source instructions.",
      );
      assertEquals(result.value.candidates, { codeAgentIds: [], markdownAgentIds: [] });
      assertEquals(discovery.signal.aborted, false);
    } finally {
      await discovery.close();
      await p.cleanup();
    }
  });
});
