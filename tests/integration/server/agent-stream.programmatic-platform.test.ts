import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createTerminalRunControl } from "#veryfront/agent/runtime/terminal-run-control.ts";
import type { RemoteToolSource } from "#veryfront/tool";
import { hasTrustedPlatformSource } from "#veryfront/tool/platform-source-provenance.ts";
import { withVeryfrontPlatformRemoteTools } from "#veryfront/server/handlers/request/agent-stream.handler.ts";
import { createAgentWithConfig } from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";

const apiOrigin = "https://8.8.8.8";
const catalog = ["get_file", "create_file", "outlook__upload_attachment", "succeed_run"].map((
  name,
) => ({
  name,
  description: name,
  inputSchema: { type: "object", properties: { project_reference: { type: "string" } } },
}));

async function withPlatformTransport(fn: (calls: Record<string, unknown>[]) => Promise<void>) {
  const previous = Deno.env.get("VERYFRONT_API_URL");
  const previousBase = Deno.env.get("VERYFRONT_API_BASE_URL");
  Deno.env.set("VERYFRONT_API_URL", apiOrigin);
  Deno.env.delete("VERYFRONT_API_BASE_URL");
  const calls: Record<string, unknown>[] = [];
  try {
    await withMockFetch(async (_url, init) => {
      const request = JSON.parse(String(observeFetchRequestInit(init).body));
      if (request.method === "tools/call") {
        calls.push({
          ...request.params,
          headers: new Headers(observeFetchRequestInit(init).headers),
        });
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: request.method === "tools/list"
            ? { tools: catalog }
            : { content: [{ type: "text", text: "accepted" }] },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }, () => fn(calls));
  } finally {
    if (previous === undefined) Deno.env.delete("VERYFRONT_API_URL");
    else Deno.env.set("VERYFRONT_API_URL", previous);
    if (previousBase === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
    else Deno.env.set("VERYFRONT_API_BASE_URL", previousBase);
  }
}

describe("programmatic platform source availability", () => {
  it("keeps code-owned dependencies out of model sources and permits only selected dependencies", async () => {
    await withPlatformTransport(async (calls) => {
      let captured: RemoteToolSource | undefined;
      const agent = createAgentWithConfig("ingestion", {
        tools: { ingest_email: true },
        mcpServers: [{ kind: "veryfront-api", toolPolicy: { allow: [] } }],
      });
      const configured = await withVeryfrontPlatformRemoteTools({
        agent,
        token: "test-user",
        projectId: "project-1",
        ...{
          programmaticPlatformRunId: "run-1",
          programmaticPlatformToolNames: ["veryfront__create_file", "outlook__upload_attachment"],
          captureProgrammaticPlatformSource: (source: RemoteToolSource) => {
            captured = source;
          },
        },
      });
      assertExists(captured);
      assertEquals(hasTrustedPlatformSource(captured), true);
      assertEquals(Reflect.get(configured.config, "__vfRemoteToolSources") ?? [], []);
      assertEquals(Reflect.get(configured.config, "__vfAllowedRemoteTools") ?? [], []);
      assertEquals((await captured.listTools()).map(({ name }) => name).sort(), [
        "outlook__upload_attachment",
        "veryfront__create_file",
      ]);
      await captured.executeTool("veryfront__create_file", {
        project_reference: "foreign-project",
        path: "fixture.txt",
      }, { runId: "foreign-run", authToken: "foreign-token" });
      assertEquals(calls[0]?.name, "create_file");
      assertEquals(
        (calls[0]?.arguments as Record<string, unknown>)?.project_reference,
        "project-1",
      );
      assertEquals((calls[0]?._meta as Record<string, unknown>)?.run_id, "run-1");
      await assertRejects(() => captured!.executeTool("veryfront__get_file", {}, {}));
      assertEquals(calls.length, 1);
    });
  });
  it("honors explicit platform server opt-outs before capturing hidden dependencies", async () => {
    await withPlatformTransport(async (calls) => {
      for (
        const mcpServers of [[], [{
          kind: "generic" as const,
          endpoint: "https://example.test/mcp",
        }]]
      ) {
        let captures = 0;
        await withVeryfrontPlatformRemoteTools({
          agent: createAgentWithConfig("ingestion", { mcpServers }),
          token: "test-user",
          projectId: "project-1",
          programmaticPlatformRunId: "run-1",
          programmaticPlatformToolNames: ["veryfront__create_file"],
          captureProgrammaticPlatformSource: () => {
            captures++;
          },
        });
        assertEquals(captures, 0);
      }
      assertEquals(calls.length, 0);
    });
  });

  it("propagates cancellation through private catalog discovery", async () => {
    await withPlatformTransport(async () => {
      let captured: RemoteToolSource | undefined;
      await withVeryfrontPlatformRemoteTools({
        agent: createAgentWithConfig("ingestion", {
          mcpServers: [{ kind: "veryfront-api", toolPolicy: { allow: [] } }],
        }),
        token: "test-user",
        projectId: "project-1",
        programmaticPlatformRunId: "run-1",
        programmaticPlatformToolNames: ["veryfront__create_file"],
        captureProgrammaticPlatformSource: (source) => {
          captured = source;
        },
      });
      assertExists(captured);
      const controller = new AbortController();
      controller.abort(new Error("catalog cancelled"));
      await assertRejects(
        () => captured!.listTools({ abortSignal: controller.signal }),
        Error,
        "catalog cancelled",
      );
    });
  });

  it("applies explicit denials without expanding ordinary model selection", async () => {
    await withPlatformTransport(async (calls) => {
      let captured: RemoteToolSource | undefined;
      const agent = createAgentWithConfig("ingestion", {
        tools: { veryfront__create_file: false },
        mcpServers: [{
          kind: "veryfront-api",
          id: "platform",
          toolPolicy: {
            allow: ["veryfront__get_file"],
            deny: ["outlook__upload_attachment"],
          },
        }],
      });
      const configured = await withVeryfrontPlatformRemoteTools({
        agent,
        token: "test-user",
        projectId: "project-1",
        ...{
          programmaticPlatformRunId: "run-1",
          programmaticPlatformToolNames: [
            "veryfront__create_file",
            "outlook__upload_attachment",
            "veryfront__succeed_run",
          ],
          captureProgrammaticPlatformSource: (source: RemoteToolSource) => {
            captured = source;
          },
        },
      });
      assertExists(captured);
      assertEquals((await captured.listTools()).map(({ name }) => name), [
        "veryfront__succeed_run",
      ]);
      assertEquals(Reflect.get(configured.config, "__vfAllowedRemoteTools"), [
        "veryfront__get_file",
      ]);
      await assertRejects(() => captured!.executeTool("veryfront__create_file", {}, {}));
      await assertRejects(() => captured!.executeTool("outlook__upload_attachment", {}, {}));
      assertEquals(calls.length, 0);
    });
  });

  it("captures no source for unknown operations or a missing canonical run", async () => {
    await withPlatformTransport(async (calls) => {
      for (
        const options of [
          {
            programmaticPlatformRunId: "run-1",
            programmaticPlatformToolNames: ["veryfront__unknown"],
          },
          { programmaticPlatformToolNames: ["veryfront__create_file"] },
        ]
      ) {
        let captures = 0;
        await withVeryfrontPlatformRemoteTools({
          agent: createAgentWithConfig("ingestion", {
            mcpServers: [{ kind: "veryfront-api", toolPolicy: { allow: [] } }],
          }),
          token: "test-user",
          projectId: "project-1",
          ...options,
          ...{
            captureProgrammaticPlatformSource: () => {
              captures++;
            },
          },
        });
        assertEquals(captures, 0);
      }
      assertEquals(calls.length, 0);
    });
  });

  it("retains distinct terminal-purpose authority instead of using file-writer authority", async () => {
    await withPlatformTransport(async (calls) => {
      let captured: RemoteToolSource | undefined;
      await withVeryfrontPlatformRemoteTools({
        agent: createAgentWithConfig("ingestion", {
          mcpServers: [{ kind: "veryfront-api", toolPolicy: { allow: [] } }],
        }),
        token: "test-user",
        projectId: "project-1",
        terminalAuthority: { token: "test-terminal", runId: "run-1" },
        fileWriterToken: "test-writer",
        ...{
          programmaticPlatformRunId: "run-1",
          programmaticPlatformToolNames: ["veryfront__create_file", "veryfront__succeed_run"],
          captureProgrammaticPlatformSource: (source: RemoteToolSource) => {
            captured = source;
          },
        },
      });
      assertExists(captured);
      await captured.executeTool("veryfront__create_file", {}, {});
      const fileHeaders = calls[0]!.headers as Headers;
      assertEquals(fileHeaders.get("X-Veryfront-Run-Event-Token"), "test-writer");
      assertEquals(fileHeaders.get("X-Veryfront-Run-Terminal-Token"), null);
      await captured.executeTool(
        "veryfront__succeed_run",
        {},
        createTerminalRunControl({ runId: "run-1" }).context,
      );
      const terminalHeaders = calls[1]!.headers as Headers;
      assertEquals(terminalHeaders.get("X-Veryfront-Run-Terminal-Token"), "test-terminal");
      assertEquals(terminalHeaders.get("X-Veryfront-Run-Event-Token"), null);
      await assertRejects(() =>
        captured!.executeTool(
          "veryfront__succeed_run",
          {},
          createTerminalRunControl({ runId: "child-run" }).context,
        )
      );
      await captured.executeTool("veryfront__succeed_run", {}, { runId: "run-1" });
      assertEquals((calls[2]!.headers as Headers).get("X-Veryfront-Run-Terminal-Token"), null);
      assertEquals((calls[2]!.headers as Headers).get("X-Veryfront-Run-Event-Token"), null);
    });
  });
});
