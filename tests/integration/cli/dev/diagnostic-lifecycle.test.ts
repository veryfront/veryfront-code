import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { clearConfigCache, getConfig, type VeryfrontConfig } from "#veryfront/config";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { resolveDevAgentDirs } from "#veryfront/discovery/project-discovery-config.ts";
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { DevServer } from "#veryfront/server/dev-server/server.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { delay } from "#std/async";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { snapshotIntegrationDiagnostics } from "../../../../cli/commands/dev/unconnected-integrations.ts";

describe("dev integration diagnostic lifecycle", () => {
  it("captures the effective bootstrap config before agent modules run", async () => {
    await withTestContext("diagnostic-effective-config", async (context) => {
      const configPath = `${context.projectDir}/veryfront.config.js`;
      const initial = {
        title: "Preliminary configuration",
        ai: { agents: { discovery: { paths: [] } } },
        integrations: { allow: { gmail: {} } },
      };
      await Deno.writeTextFile(configPath, `export default ${JSON.stringify(initial)};`);
      clearConfigCache();
      const preliminary = await getConfig(context.projectDir, await runtime.get());
      assertEquals(resolveDevAgentDirs(preliminary), []);

      const effective = {
        title: "Effective configuration",
        ai: { agents: { discovery: { paths: ["crew"] } } },
        integrations: { allow: { salesforce: {} } },
      };
      await delay(50);
      await Deno.writeTextFile(configPath, `export default ${JSON.stringify(effective)};`);
      clearConfigCache();
      await Deno.mkdir(`${context.projectDir}/crew`);
      await Deno.writeTextFile(
        `${context.projectDir}/crew/agent.ts`,
        `
        globalThis.__vfDiagnosticCaptureOrder.push("agent");
        export default {
          id: "diagnostic-agent", config: { id: "diagnostic-agent", tools: { salesforce__get_case: true } },
          generate() { return Promise.resolve({ text: "" }); }
        };
      `,
      );
      const order: string[] = [];
      const globals = globalThis as unknown as Record<string, unknown>;
      globals.__vfDiagnosticCaptureOrder = order;
      let captured:
        | { roots: string[]; policy: ReturnType<typeof normalizeSourceIntegrationPolicy> }
        | undefined;
      const server = new DevServer({
        projectDir: context.projectDir,
        port: await context.allocatePort(),
        handlerOnly: true,
        enableHMR: false,
        onConfigResolved(config: VeryfrontConfig | undefined) {
          order.push("config");
          captured = {
            roots: resolveDevAgentDirs(config),
            policy: normalizeSourceIntegrationPolicy(config?.integrations),
          };
        },
      });
      try {
        await server.start();
        assertEquals(captured, {
          roots: ["crew"],
          policy: {
            schemaVersion: 1,
            mode: "allowlist",
            integrations: { salesforce: { allowedToolIds: null } },
          },
        });
        assertEquals(order, ["config", "agent"]);
      } finally {
        await server.stop();
        Reflect.deleteProperty(globals, "__vfDiagnosticCaptureOrder");
      }
    });
  });
  it("captures reloaded enhanced-filesystem policy and roots rather than the preliminary config", async () => {
    await withTestContext("diagnostic-remote-config", async (context) => {
      const preliminary = {
        title: "Preliminary remote configuration",
        fs: {
          type: "github",
          github: { token: "test-token", owner: "owner", repo: "diagnostic-config" },
        },
        ai: { agents: { discovery: { paths: [] } } },
        integrations: { allow: { gmail: {} } },
      };
      await Deno.writeTextFile(
        `${context.projectDir}/veryfront.config.js`,
        `export default ${JSON.stringify(preliminary)};`,
      );
      clearConfigCache();
      const initial = await getConfig(context.projectDir, await runtime.get());
      assertEquals(
        snapshotIntegrationDiagnostics(initial, {
          authToken: "qualified-token",
          projectSlug: "preliminary-project",
        }).agentDiscoveryEnabled,
        false,
      );
      const sourceFiles = {
        "veryfront.config.js": `export default ${
          JSON.stringify({
            title: "Effective remote configuration",
            fs: { type: "veryfront-api", veryfront: { projectSlug: "effective-project" } },
            dev: { port: 3101 },
            ai: { agents: { discovery: { paths: ["crew"] } } },
            integrations: { allow: { salesforce: {} } },
          })
        };`,
      };
      const files = Object.entries(sourceFiles).map(([path, content], index) => ({
        path,
        content,
        sha: String(index + 1).padStart(40, "0"),
        size: new TextEncoder().encode(content).length,
      }));
      const order: string[] = [];
      let remoteConfigReads = 0;
      let captured: ReturnType<typeof snapshotIntegrationDiagnostics> | undefined;
      const server = new DevServer({
        projectDir: context.projectDir,
        port: await context.allocatePort(),
        handlerOnly: true,
        enableHMR: false,
        onConfigResolved(config) {
          order.push("config");
          captured = snapshotIntegrationDiagnostics(config, {
            authToken: "qualified-token",
            projectSlug: "preliminary-project",
          });
        },
      });
      try {
        await withMockFetch((input) => {
          const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
          if (path.includes("/git/trees/")) {
            return Promise.resolve(
              Response.json({
                sha: "tree",
                truncated: false,
                tree: files.map((file) => ({
                  path: file.path,
                  sha: file.sha,
                  size: file.size,
                  mode: "100644",
                  type: "blob",
                })),
              }),
            );
          }
          const file = files.find((file) =>
            path.endsWith(`/contents/${file.path}`) || path.endsWith(`/git/blobs/${file.sha}`)
          );
          if (!file) return Promise.resolve(new Response("not found", { status: 404 }));
          remoteConfigReads++;
          if (path.includes("/git/blobs/")) return Promise.resolve(new Response(file.content));
          return Promise.resolve(
            Response.json({
              type: "file",
              name: file.path.split("/").at(-1),
              path: file.path,
              sha: file.sha,
              size: file.size,
              content: btoa(file.content),
              encoding: "base64",
            }),
          );
        }, async () => {
          await server.start();
          assertEquals(captured, {
            executionContext: { authToken: "qualified-token", projectSlug: "effective-project" },
            agentDiscoveryEnabled: true,
            integrationPolicy: {
              schemaVersion: 1,
              mode: "allowlist",
              integrations: { salesforce: { allowedToolIds: null } },
            },
          });
          assertEquals(order, ["config"]);
          assertEquals(remoteConfigReads > 0, true);
        });
      } finally {
        await server.stop();
      }
    });
  });
});
