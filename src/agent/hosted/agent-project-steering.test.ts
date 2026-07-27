import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { afterEach } from "#veryfront/testing/bdd.ts";
import { join, resolve } from "node:path";
import {
  createHostedAgentProjectSteering,
  createStrictHostedAgentProjectSteering,
} from "./agent-project-steering.ts";
import { reset, tryResolve } from "../../extensions/contracts.ts";
import type { SchemaValidator } from "../../extensions/schema/index.ts";
import type { RuntimeProjectFilesFetch } from "../runtime/project-files-client.ts";

function withTempDir(fn: (rootDir: string) => void | Promise<void>): Promise<void> {
  const rootDir = Deno.makeTempDirSync();
  return Promise.resolve(fn(rootDir)).finally(() => {
    Deno.removeSync(rootDir, { recursive: true });
  });
}

function writeAgentDefinition(
  input: { rootDir: string; agentId: string; content?: string },
): string {
  const srcDir = join(input.rootDir, "src");
  const agentsDir = join(input.rootDir, "agents");
  Deno.mkdirSync(srcDir, { recursive: true });
  Deno.mkdirSync(agentsDir, { recursive: true });
  Deno.writeTextFileSync(
    join(agentsDir, `${input.agentId}.md`),
    input.content ??
      `---
name: Writer
description: Writes copy
---

Draft concise copy.
`,
  );

  return srcDir;
}

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  reset();
});

Deno.test("createHostedAgentProjectSteering registers the built-in schema validator when used directly", async () => {
  await withTempDir((rootDir) => {
    reset();
    assertEquals(tryResolve<SchemaValidator>("SchemaValidator"), undefined);

    const baseDir = writeAgentDefinition({ rootDir, agentId: "writer" });
    createHostedAgentProjectSteering({
      baseDir,
      agentId: "writer",
      getApiUrl: () => "https://api.example.com",
    });

    assertEquals(typeof tryResolve<SchemaValidator>("SchemaValidator")?.object, "function");
  });
});

Deno.test("createHostedAgentProjectSteering loads and caches markdown agent definitions", async () => {
  await withTempDir((rootDir) => {
    const baseDir = writeAgentDefinition({ rootDir, agentId: "writer" });
    const steering = createHostedAgentProjectSteering({
      baseDir,
      agentId: "writer",
      getApiUrl: () => "https://api.example.com",
    });

    assertEquals(steering.getAgentConfig(), {
      id: "writer",
      name: "Writer",
      description: "Writes copy",
      instructions: "Draft concise copy.",
    });

    Deno.writeTextFileSync(resolve(rootDir, "agents/writer.md"), "not read after cache");

    assertEquals(steering.getAgentConfig().instructions, "Draft concise copy.");
  });
});

Deno.test("createHostedAgentProjectSteering logs and rethrows definition load failures", async () => {
  await withTempDir((rootDir) => {
    const srcDir = join(rootDir, "src");
    Deno.mkdirSync(srcDir, { recursive: true });
    const errors: Record<string, unknown>[] = [];
    const steering = createHostedAgentProjectSteering({
      baseDir: srcDir,
      agentId: "missing",
      getApiUrl: () => "https://api.example.com",
      logger: {
        error: (_message, metadata) => {
          if (metadata) {
            errors.push(metadata);
          }
        },
      },
    });

    assertThrows(() => steering.getAgentConfig());
    assertEquals(errors.length, 1);
    assertEquals(errors[0]?.filePath, join(rootDir, "agents/missing.md"));
  });
});

Deno.test("createHostedAgentProjectSteering binds project instruction and skill helpers", async () => {
  await withTempDir(async (rootDir) => {
    const baseDir = writeAgentDefinition({ rootDir, agentId: "support" });
    const calls: Array<{ url: URL; authHeader: string | null }> = [];
    const fetch: RuntimeProjectFilesFetch = async (url, init) => {
      const requestUrl = new URL(url);
      const headers = new Headers(init.headers);
      calls.push({ url: requestUrl, authHeader: headers.get("Authorization") });

      if (requestUrl.pathname.endsWith("/AGENTS.md")) {
        return createJsonResponse({ path: "AGENTS.md", content: "# Project instructions" });
      }

      if (requestUrl.pathname.includes("/files/")) {
        return new Response(null, { status: 404 });
      }

      return createJsonResponse({
        data: [],
        page_info: { next: null },
      });
    };
    const steering = createHostedAgentProjectSteering({
      baseDir,
      agentId: "support",
      getApiUrl: () => "https://api.example.com",
      fetch,
    });

    assertEquals(
      await steering.getProjectInstructions({
        projectId: "project-1",
        authToken: "auth-token",
        branchId: "branch-1",
      }),
      "# Project instructions",
    );

    const skills = await steering.getSkillsConfig({
      projectId: "project-1",
      authToken: "auth-token",
      branchId: "branch-1",
    });

    assertEquals(skills.length, 0);
    assertEquals(calls[0]?.authHeader, "Bearer auth-token");
    assertEquals(calls[0]?.url.searchParams.get("branch"), "branch-1");
    assertEquals(calls[1]?.url.pathname, "/projects/project-1/files");
  });
});

Deno.test("createHostedAgentProjectSteering validates traversal-prone agent inputs", () => {
  assertThrows(() =>
    createHostedAgentProjectSteering({
      baseDir: "/tmp",
      agentId: "../escape",
      getApiUrl: () => "https://api.example.com",
    })
  );
  assertThrows(() =>
    createHostedAgentProjectSteering({
      baseDir: "/tmp",
      agentId: "safe",
      fileName: "../safe.md",
      getApiUrl: () => "https://api.example.com",
    })
  );
});

Deno.test("strict hosted agent steering rejects unsafe project identity before fetch", async () => {
  await withTempDir(async (rootDir) => {
    const baseDir = writeAgentDefinition({ rootDir, agentId: "support" });
    let fetchCalls = 0;
    const steering = createStrictHostedAgentProjectSteering({
      baseDir,
      agentId: "support",
      getApiUrl: () => "https://api.example.com",
      fetch: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 404 });
      },
    });

    await assertRejects(
      () =>
        steering.getProjectInstructions({
          projectId: "..",
          authToken: "auth-token",
        }),
      TypeError,
      "route-safe",
    );
    assertEquals(fetchCalls, 0);
  });
});

Deno.test("strict hosted agent steering keeps cancellation request-scoped across its cached adapter", async () => {
  await withTempDir(async (rootDir) => {
    const baseDir = writeAgentDefinition({ rootDir, agentId: "support" });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstCancellation = new DOMException("stop first steering call", "AbortError");
    let notifyBothFetchesStarted!: () => void;
    const bothFetchesStarted = new Promise<void>((resolve) => {
      notifyBothFetchesStarted = resolve;
    });
    let resolveFirstFetch!: (response: Response) => void;
    const firstFetch = new Promise<Response>((resolve) => {
      resolveFirstFetch = resolve;
    });
    let resolveSecondFetch!: (response: Response) => void;
    const secondFetch = new Promise<Response>((resolve) => {
      resolveSecondFetch = resolve;
    });
    const observedSignals: AbortSignal[] = [];
    let fetchCalls = 0;
    const steering = createStrictHostedAgentProjectSteering({
      baseDir,
      agentId: "support",
      getApiUrl: () => "https://api.example.com",
      fetch: (_url, init) => {
        fetchCalls += 1;
        observedSignals.push(init.signal as AbortSignal);
        if (fetchCalls === 2) {
          notifyBothFetchesStarted();
        }
        return fetchCalls === 1 ? firstFetch : secondFetch;
      },
    });
    const cachedAdapter = steering.getProjectSteeringAdapter();

    const firstInstructions = steering.getProjectInstructionsForRequest(
      {
        projectId: "project-1",
        authToken: "auth-token",
      },
      firstController.signal,
    );
    const secondInstructions = steering.getProjectInstructionsForRequest(
      {
        projectId: "project-1",
        authToken: "auth-token",
      },
      secondController.signal,
    );
    await bothFetchesStarted;
    firstController.abort(firstCancellation);
    const firstError = await assertRejects(() => firstInstructions);
    resolveFirstFetch(new Response(null, { status: 404 }));
    resolveSecondFetch(new Response(null, { status: 404 }));

    assertEquals(firstError, firstCancellation);
    assertEquals(await secondInstructions, "");
    assertEquals(steering.getProjectSteeringAdapter(), cachedAdapter);
    assertEquals(observedSignals.length, 2);
    assertEquals(observedSignals[0]?.reason, firstCancellation);
    assertEquals(observedSignals[1]?.aborted, false);
  });
});

Deno.test("createHostedAgentProjectSteering exposes load_skill and refresh helpers", async () => {
  await withTempDir(async (rootDir) => {
    const baseDir = writeAgentDefinition({ rootDir, agentId: "support" });
    const skillsDir = join(rootDir, "skills");
    Deno.mkdirSync(skillsDir, { recursive: true });
    Deno.writeTextFileSync(
      join(skillsDir, "plan.md"),
      `---
description: Plans
---
Plan carefully.`,
    );
    const fetch: RuntimeProjectFilesFetch = () =>
      Promise.resolve(createJsonResponse({ data: [], page_info: { next: null } }));
    const steering = createHostedAgentProjectSteering({
      baseDir,
      agentId: "support",
      skillsDir,
      getApiUrl: () => "https://api.example.com",
      fetch,
    });

    const context = {
      projectId: "project-1",
      authToken: "auth-token",
      branchId: null,
      availableSkillIds: ["stale"],
    };

    await steering.refreshProjectSkillIds(context);
    assertEquals(context.availableSkillIds, ["plan"]);

    const tool = steering.createLoadSkillTool({
      projectId: null,
      authToken: "auth-token",
      branchId: null,
      availableSkillIds: ["plan"],
      availableToolNames: [],
    });
    const result = await tool.execute({ skillId: "plan" });

    if (!("skillId" in result)) {
      throw new Error("Expected load_skill success response");
    }

    assertEquals(result.skillId, "plan");
  });
});

Deno.test("createHostedAgentProjectSteering propagates project-file errors", async () => {
  await withTempDir(async (rootDir) => {
    const baseDir = writeAgentDefinition({ rootDir, agentId: "support" });
    const fetch: RuntimeProjectFilesFetch = () => Promise.reject(new Error("network down"));
    const steering = createHostedAgentProjectSteering({
      baseDir,
      agentId: "support",
      getApiUrl: () => "https://api.example.com",
      fetch,
    });

    await assertRejects(
      () => steering.refreshProjectSkillIds({ projectId: "project-1", authToken: "auth-token" }),
      Error,
      "network down",
    );
  });
});
