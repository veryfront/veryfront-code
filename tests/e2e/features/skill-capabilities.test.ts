#!/usr/bin/env -S deno test --allow-all
/**
 * Feature Tests: Veryfront skill capability claims
 *
 * These tests protect the core capabilities currently documented in
 * ../veryfront-skill/SKILL.md:
 * - first-class project-root primitives are auto-discovered
 * - discovered tools/prompts/resources/workflows can be exercised end-to-end
 * - skill-directory SKILL.md entries are discoverable at runtime
 * - the 3-minute AI chatbot pattern works with agents/, app/api/ag-ui/route.ts,
 *   and a Chat/useChat UI page
 */
import "../../_helpers/contract-init.ts";

import { dirname, join } from "#veryfront/compat/path/index.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  ensureBinaryCompiled,
  expectPage,
  expectServer,
  fetchJson,
  fetchPage,
  type TestServer,
  withServer,
} from "../setup/index.ts";

interface JsonRequestInit extends Omit<RequestInit, "body" | "headers"> {
  body?: unknown;
  headers?: HeadersInit;
}

async function writeProjectFiles(projectDir: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(projectDir, relativePath);
    await Deno.mkdir(dirname(fullPath), { recursive: true });
    await Deno.writeTextFile(fullPath, content.trimStart());
  }
}

async function createSkillProject(name: string, files: Record<string, string>): Promise<string> {
  const projectDir = await Deno.makeTempDir({ prefix: `vf-e2e-skill-${name}-` });

  await writeProjectFiles(projectDir, {
    "package.json": JSON.stringify(
      {
        name: `skill-${name}`,
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          zod: "^3.25.0",
        },
      },
      null,
      2,
    ),
    "veryfront.config.ts": `export default { fs: { type: "local" } };\n`,
    ...files,
  });

  return projectDir;
}

async function postJson<T = unknown>(
  server: TestServer,
  path: string,
  init: JsonRequestInit = {},
): Promise<{ response: Response; json: T }> {
  const { body, headers, ...rest } = init;
  const finalHeaders = new Headers(headers);
  finalHeaders.set("Content-Type", "application/json");

  const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
    ...rest,
    method: rest.method ?? "POST",
    headers: finalHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const json = (await response.json()) as T;
  return { response, json };
}

describe("Feature: Veryfront skill capability claims", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  it("auto-discovers and executes the first-class primitives described by the skill", async () => {
    const projectDir = await createSkillProject("primitives", {
      "app/page.tsx": `
export default function Home() {
  return <main id="skill-primitives-page">Skill primitives smoke test</main>;
}
`,
      "agents/researcher.ts": `
import { agent } from "veryfront/agent";

export default agent({
  system: "You are a careful researcher.",
  skills: ["writer-helper"],
  maxSteps: 2,
});
`,
      "tools/get-weather.ts": `
import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";

export default tool({
  description: "Return a deterministic weather report",
  inputSchema: defineSchema((v) => v.object({
    city: v.string(),
  }))(),
  execute: async ({ city }) => ({
    city,
    forecast: "sunny",
    temperatureC: 21,
  }),
});
`,
      "prompts/research-brief.ts": `
import { prompt } from "veryfront/prompt";

export default prompt({
  description: "Generate a research brief",
  content: "Research brief for {topic}",
});
`,
      "resources/project-notes.ts": `
import { resource } from "veryfront/resource";
import { defineSchema } from "veryfront/schemas";

export default resource({
  description: "Load the current project notes",
  paramsSchema: defineSchema((v) => v.object({}))(),
  load: async () => ({
    content: "Notes for launch-plan",
  }),
});
`,
      "workflows/content-pipeline.ts": `
import { step, workflow } from "veryfront/workflow";

export default workflow({
  id: "content-pipeline",
  steps: [
    step("draft", {
      tool: "getWeather",
      input: { city: "Stockholm" },
    }),
  ],
});
`,
      "skills/writer-helper/SKILL.md": `
---
name: writer-helper
description: Helps agents turn notes into polished copy.
allowed-tools: Read api:*
---
Use this when the task needs a crisp final draft.
`,
      "skills/writer-helper/references/style-guide.md": `
Use short sentences.
Prefer active voice.
`,
      "skills/writer-helper/assets/voice.txt": `
Keep the tone warm and direct.
`,
      "skills/writer-helper/scripts/echo-style.sh": `
#!/usr/bin/env bash
echo "style=$STYLE voice=$1"
`,
      "app/api/research-chat/route.ts": `
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("researcher");
`,
    });

    await withServer(projectDir, async (server) => {
      const { response: pageResponse, html } = await fetchPage(server, "/");
      expectPage(html, pageResponse)
        .toRender()
        .withElement("skill-primitives-page")
        .withText("Skill primitives smoke test")
        .withoutErrors();

      const { response: agentsResponse, json: agentsJson } = await fetchJson<{
        agents: Array<{ id: string }>;
      }>(server, "/_dev/api/agents");
      assertEquals(agentsResponse.status, 200);
      assert(agentsJson.agents.some((agent) => agent.id === "researcher"));

      const { response: toolResponse, json: toolJson } = await postJson<{
        success: boolean;
        toolId: string;
        result: { city: string; forecast: string; temperatureC: number };
      }>(server, "/_dev/api/execute-tool", {
        body: {
          toolId: "getWeather",
          args: { city: "Stockholm" },
        },
      });
      assertEquals(toolResponse.status, 200);
      assertEquals(toolJson.success, true);
      assertEquals(toolJson.toolId, "getWeather");
      assertEquals(toolJson.result.city, "Stockholm");
      assertEquals(toolJson.result.forecast, "sunny");

      const { response: promptResponse, json: promptJson } = await postJson<{
        success: boolean;
        promptId: string;
        content: string;
      }>(server, "/_dev/api/render-prompt", {
        body: {
          promptId: "researchBrief",
          variables: { topic: "release notes" },
        },
      });
      assertEquals(promptResponse.status, 200);
      assertEquals(promptJson.success, true);
      assertEquals(promptJson.promptId, "researchBrief");
      assertEquals(promptJson.content, "Research brief for release notes");

      const { response: resourceResponse, json: resourceJson } = await postJson<{
        success: boolean;
        resourceId: string;
        data: { content: string };
      }>(server, "/_dev/api/read-resource", {
        body: { uri: "/project-notes" },
      });
      assertEquals(resourceResponse.status, 200);
      assertEquals(resourceJson.success, true);
      assertEquals(resourceJson.resourceId, "projectNotes");
      assertEquals(resourceJson.data.content, "Notes for launch-plan");

      const { response: loadSkillResponse, json: loadSkillJson } = await postJson<{
        success: boolean;
        toolId: string;
        result: {
          instructions: string;
          allowedTools?: string[];
          references: string[];
          scripts: string[];
          note?: string;
        };
      }>(server, "/_dev/api/execute-tool", {
        body: {
          toolId: "load-skill",
          args: { skillId: "writer-helper" },
        },
      });
      assertEquals(loadSkillResponse.status, 200);
      assertEquals(loadSkillJson.success, true);
      assertEquals(loadSkillJson.toolId, "load-skill");
      assertStringIncludes(loadSkillJson.result.instructions, "crisp final draft");
      assertEquals(loadSkillJson.result.allowedTools, ["Read", "api:*"]);
      assertEquals(loadSkillJson.result.references, ["references/style-guide.md"]);
      assertEquals(loadSkillJson.result.scripts, ["scripts/echo-style.sh"]);

      const { response: loadSkillReferenceResponse, json: loadSkillReferenceJson } = await postJson<
        {
          success: boolean;
          toolId: string;
          result: {
            path: string;
            content: string;
          };
        }
      >(server, "/_dev/api/execute-tool", {
        body: {
          toolId: "load-skill-reference",
          args: {
            skillId: "writer-helper",
            reference: "references/style-guide.md",
          },
        },
      });
      assertEquals(loadSkillReferenceResponse.status, 200);
      assertEquals(loadSkillReferenceJson.success, true);
      assertEquals(loadSkillReferenceJson.toolId, "load-skill-reference");
      assertEquals(loadSkillReferenceJson.result.path, "references/style-guide.md");
      assertStringIncludes(loadSkillReferenceJson.result.content, "Prefer active voice.");

      const { response: loadSkillAssetResponse, json: loadSkillAssetJson } = await postJson<{
        success: boolean;
        toolId: string;
        result: {
          path: string;
          content: string;
        };
      }>(server, "/_dev/api/execute-tool", {
        body: {
          toolId: "load-skill-reference",
          args: {
            skillId: "writer-helper",
            reference: "assets/voice.txt",
          },
        },
      });
      assertEquals(loadSkillAssetResponse.status, 200);
      assertEquals(loadSkillAssetJson.success, true);
      assertEquals(loadSkillAssetJson.result.path, "assets/voice.txt");
      assertStringIncludes(loadSkillAssetJson.result.content, "warm and direct");

      const { response: blockedSkillReferenceResponse, json: blockedSkillReferenceJson } =
        await postJson<{
          error: string;
        }>(server, "/_dev/api/execute-tool", {
          body: {
            toolId: "load-skill-reference",
            args: {
              skillId: "writer-helper",
              reference: "../SKILL.md",
            },
          },
        });
      assertEquals(blockedSkillReferenceResponse.status, 500);
      assertStringIncludes(blockedSkillReferenceJson.error, "Skill path validation failed");

      const { response: executeSkillScriptResponse, json: executeSkillScriptJson } = await postJson<
        {
          success: boolean;
          toolId: string;
          result: {
            stdout: string;
            stderr: string;
            exitCode: number;
          };
        }
      >(server, "/_dev/api/execute-tool", {
        body: {
          toolId: "execute-skill-script",
          args: {
            skillId: "writer-helper",
            script: "scripts/echo-style.sh",
            args: ["active"],
            env: { STYLE: "tight" },
          },
        },
      });
      assertEquals(executeSkillScriptResponse.status, 200);
      assertEquals(executeSkillScriptJson.success, true);
      assertEquals(executeSkillScriptJson.toolId, "execute-skill-script");
      assertEquals(executeSkillScriptJson.result.exitCode, 0);
      assertEquals(executeSkillScriptJson.result.stderr, "");
      assertStringIncludes(executeSkillScriptJson.result.stdout, "style=tight voice=active");

      const { response: workflowsResponse, json: workflowsJson } = await fetchJson<{
        workflows: Array<{ id: string }>;
      }>(server, "/_dev/api/workflows");
      assertEquals(workflowsResponse.status, 200);
      assert(workflowsJson.workflows.some((workflow) => workflow.id === "content-pipeline"));

      const { response: workflowRunResponse, json: workflowRunJson } = await postJson<{
        success: boolean;
        workflowId: string;
        status: string;
      }>(server, "/_dev/api/start-workflow", {
        body: {
          workflowId: "content-pipeline",
        },
      });
      assertEquals(workflowRunResponse.status, 200);
      assertEquals(workflowRunJson.success, true);
      assertEquals(workflowRunJson.workflowId, "content-pipeline");
      assertEquals(workflowRunJson.status, "completed");

      const { response: researchChatResponse, json: researchChatJson } = await postJson<{
        code: string;
        fallback: string;
        model: string;
      }>(server, "/api/research-chat", {
        body: {
          messages: [
            {
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "Summarize the launch notes" }],
            },
          ],
        },
      });
      assertEquals(researchChatResponse.status, 503);
      assertEquals(researchChatJson.code, "NO_AI_AVAILABLE");
      assertEquals(researchChatJson.fallback, "browser");
      assertEquals(researchChatJson.model, "smollm2-135m");

      expectServer(server).withoutErrors();
    }, {
      timeout: 60_000,
      env: {
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        GOOGLE_API_KEY: "",
        VERYFRONT_DISABLE_LOCAL_AI: "1",
      },
    });
  });

  it("runs the 3-minute AI chatbot pattern documented by the skill", async () => {
    const projectDir = await createSkillProject("chatbot", {
      "app/page.tsx": `
"use client";
import { Chat, useChat } from "veryfront/chat";

export default function Home() {
  const chat = useChat({ api: "/api/ag-ui" });

  return <Chat {...chat} className="flex-1 min-h-0" placeholder="Message" />;
}
`,
      "tools/get-weather.ts": `
import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";

export default tool({
  description: "Return a deterministic weather report",
  inputSchema: defineSchema((v) => v.object({ city: v.string() }))(),
  execute: async ({ city }) => ({ city, forecast: "clear" }),
});
`,
      "agents/assistant.ts": `
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a helpful assistant.",
  tools: { getWeather: true },
  maxSteps: 5,
});
`,
      "app/api/ag-ui/route.ts": `
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("assistant");
`,
    });

    await withServer(projectDir, async (server) => {
      const { response: pageResponse, html } = await fetchPage(server, "/");
      expectPage(html, pageResponse)
        .toRender()
        .withText("Message")
        .withoutErrors();

      const { response: agentsResponse, json: agentsJson } = await fetchJson<{
        agents: Array<{
          id: string;
          system: string | null;
          tools: Record<string, boolean>;
          maxSteps: number | null;
        }>;
      }>(server, "/_dev/api/agents");
      assertEquals(agentsResponse.status, 200);

      const assistant = agentsJson.agents.find((agent) => agent.id === "assistant");
      assertExists(assistant);
      assertEquals(
        assistant.system,
        "You are a helpful assistant.",
      );
      assertEquals(assistant.maxSteps, 5);
      assertEquals(assistant.tools.getWeather, true);

      const { response: chatResponse, json: chatJson } = await postJson<{
        code: string;
        fallback: string;
        model: string;
      }>(server, "/api/ag-ui", {
        body: {
          messages: [
            {
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "Hello from the skill smoke test" }],
            },
          ],
        },
      });

      assertEquals(chatResponse.status, 503);
      assertEquals(chatJson.code, "NO_AI_AVAILABLE");
      assertEquals(chatJson.fallback, "browser");
      assertEquals(chatJson.model, "smollm2-135m");

      expectServer(server).withoutErrors();
    }, {
      timeout: 60_000,
      env: {
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        GOOGLE_API_KEY: "",
        VERYFRONT_DISABLE_LOCAL_AI: "1",
      },
    });
  });

  it("honors the skill's documented custom discovery path configuration", async () => {
    const projectDir = await createSkillProject("custom-discovery", {
      "veryfront.config.ts": `
export default {
  fs: { type: "local" },
  directories: {
    app: "src/app",
  },
  ai: {
    tools: { discovery: { paths: ["tooling"] } },
    agents: { discovery: { paths: ["crew"] } },
    skills: { discovery: { paths: ["custom-skills"] } },
  },
};
`,
      "src/app/page.tsx": `
export default function Home() {
  return <main id="custom-discovery-page">Custom discovery paths</main>;
}
`,
      "src/app/api/ag-ui/route.ts": `
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("custom-assistant");
`,
      "tooling/get-weather.ts": `
import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";

export default tool({
  description: "Return a deterministic weather report",
  inputSchema: defineSchema((v) => v.object({ city: v.string() }))(),
  execute: async ({ city }) => ({ city, forecast: "windy" }),
});
`,
      "crew/custom-assistant.ts": `
import { agent } from "veryfront/agent";

export default agent({
  id: "custom-assistant",
  system: "You are a helpful assistant loaded from a custom discovery path.",
  skills: ["writer-helper"],
  tools: { getWeather: true },
  maxSteps: 3,
});
`,
      "custom-skills/writer-helper/SKILL.md": `
---
name: writer-helper
description: Loaded from a custom skills directory.
---
Use this skill when writing polished copy.
`,
    });

    await withServer(projectDir, async (server) => {
      const { response: pageResponse, html } = await fetchPage(server, "/");
      expectPage(html, pageResponse)
        .toRender()
        .withElement("custom-discovery-page")
        .withText("Custom discovery paths")
        .withoutErrors();

      const { response: toolResponse, json: toolJson } = await postJson<{
        success: boolean;
        toolId: string;
        result: { city: string; forecast: string };
      }>(server, "/_dev/api/execute-tool", {
        body: {
          toolId: "getWeather",
          args: { city: "Stockholm" },
        },
      });
      assertEquals(toolResponse.status, 200);
      assertEquals(toolJson.success, true);
      assertEquals(toolJson.toolId, "getWeather");
      assertEquals(toolJson.result.forecast, "windy");

      const { response: loadSkillResponse, json: loadSkillJson } = await postJson<{
        success: boolean;
        toolId: string;
        result: { instructions: string };
      }>(server, "/_dev/api/execute-tool", {
        body: {
          toolId: "load-skill",
          args: { skillId: "writer-helper" },
        },
      });
      assertEquals(loadSkillResponse.status, 200);
      assertEquals(loadSkillJson.success, true);
      assertEquals(loadSkillJson.toolId, "load-skill");
      assertStringIncludes(loadSkillJson.result.instructions, "polished copy");

      const { response: chatResponse, json: chatJson } = await postJson<{
        code: string;
        fallback: string;
        model: string;
      }>(server, "/api/ag-ui", {
        body: {
          messages: [
            {
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "Hello from the custom discovery test" }],
            },
          ],
        },
      });
      assertEquals(chatResponse.status, 503);
      assertEquals(chatJson.code, "NO_AI_AVAILABLE");
      assertEquals(chatJson.fallback, "browser");
      assertEquals(chatJson.model, "smollm2-135m");

      expectServer(server).withoutErrors();
    }, {
      timeout: 60_000,
      env: {
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        GOOGLE_API_KEY: "",
        VERYFRONT_DISABLE_LOCAL_AI: "1",
      },
    });
  });
});
