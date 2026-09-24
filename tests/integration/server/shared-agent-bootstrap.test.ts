import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import { enablePrivateVeryfrontApiClientSourceContext } from "#veryfront/platform/adapters/veryfront-api-client/client.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { getRuntimeRequestContext } from "#veryfront/platform/runtime-request-context.ts";
import { resolveVerifiedControlPlaneBranchBinding } from "#veryfront/proxy/control-plane-signature.ts";
import { createVeryfrontHandler } from "#veryfront/server/runtime-handler/index.ts";
import { createControlPlaneSignature } from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import {
  createAgentStreamRequestBody,
  createNoopFsAdapter,
} from "#veryfront/server/handlers/request/agent-stream.handler.test-helpers.ts";

const SOURCE_ID = "20000000-1000-4000-8000-100000000005";
const SOURCE_ENV = "20000000-1000-4000-8000-100000000007";

describe("shared agent runtime bootstrap", () => {
  for (const authentic of [false, true]) {
    it(`${authentic ? "starts signed discovery" : "rejects a forged signature"} without reading source environment variables`, async () => {
      const body = createAgentStreamRequestBody({
        project: { runtimeTargetBranchName: "consumer-trunk" },
        sourceProject: {
          projectId: SOURCE_ID,
          projectSlug: "source-project",
          runtimeTargetKind: "environment",
          runtimeTargetEnvironmentId: SOURCE_ENV,
        },
        agentSource: {
          type: "environment",
          environmentName: "staging",
          releaseId: "source-release",
        },
        credentials: { authToken: "consumer-token", sourceAuthToken: "source-read-token" },
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        requestId: "run_1",
        projectId: SOURCE_ID,
        audience: "source-project",
      });
      const sourceReads: Array<{ projectId?: string; token?: string; executionProject?: string }> =
        [];
      const fs = createNoopFsAdapter([]);
      const sourceClient = new VeryfrontApiClient({
        apiBaseUrl: "https://api.veryfront.org",
        projectSlug: SOURCE_ID,
        retry: { maxRetries: 0 },
      });
      enablePrivateVeryfrontApiClientSourceContext(sourceClient);
      sourceClient.enableContextualToken();
      const recordRead = async () => {
        sourceReads.push({
          projectId: getCurrentRequestContext()?.projectId,
          token: getCurrentRequestContext()?.token,
          executionProject: getRuntimeRequestContext()?.projectId,
        });
        await sourceClient.listReleaseFiles("source-release");
      };
      fs.readFile = async () => {
        await recordRead();
        throw new Deno.errors.NotFound("No source file");
      };
      fs.readDir = async function* () {
        await recordRead();
        yield* [];
      };
      fs.exists = async () => {
        await recordRead();
        return false;
      };
      const adapter = { ...createMockAdapter(), fs };
      adapter.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", publicKeyPem);
      adapter.env.set("VERYFRONT_API_BASE_URL", "https://api.veryfront.org");
      adapter.env.set("VERYFRONT_API_URL", "http://veryfront-api:80");
      const apiKeys = ["VERYFRONT_API_URL", "VERYFRONT_API_BASE_URL"] as const;
      const previousApi = apiKeys.map((key) => Deno.env.get(key));
      Deno.env.set(apiKeys[0], "http://veryfront-api:80");
      Deno.env.set(apiKeys[1], "https://api.veryfront.org");
      const previousTrust = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
      const previousKey = Deno.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
      Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
      Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", publicKeyPem);
      let fetches = 0;
      try {
        const handler = createVeryfrontHandler("/shared-bootstrap", adapter, {
          projectDir: "/shared-bootstrap",
          allowHostProjectCodeExecution: true,
          config: { fs: { veryfront: { proxyMode: true } } },
        });
        const req = new Request(
          "https://source-project.staging.example.com/api/control-plane/runs/run_1/stream",
          {
            method: "POST",
            headers: {
              "x-veryfront-control-plane-jws": authentic ? jws : "invalid-signature",
              "x-project-id": SOURCE_ID,
              "x-project-slug": "source-project",
              "x-release-id": "source-release",
              "x-environment": "production",
              "x-environment-name": "staging",
              "x-environment-id": SOURCE_ENV,
              "x-token": "consumer-token",
            },
            body,
          },
        );
        if (authentic) {
          assertEquals(
            await resolveVerifiedControlPlaneBranchBinding(req, new URL(req.url), {
              audience: "source-project",
              expectedProjectId: SOURCE_ID,
            }),
            {},
          );
        }
        const response = await withMockFetch((input, init) => {
          fetches++;
          assertEquals(
            String(input).startsWith(
              `https://api.veryfront.org/projects/${SOURCE_ID}/releases/source-release/files?`,
            ),
            true,
          );
          assertEquals(new Headers(init?.headers).get("authorization"), "Bearer source-read-token");
          return Promise.resolve(
            Response.json({
              data: [],
              page_info: { self: null, first: null, next: null, prev: null },
              release_id: "source-release",
              release_version: "v1",
            }),
          );
        }, () => handler(req));
        assertEquals(response.status, authentic ? 404 : 401);
        const result = await response.json();
        if (authentic) {
          assertEquals(result, { error: "Agent not found" });
          assertEquals(sourceReads.length > 0, true);
          assertEquals(
            sourceReads.every((read) =>
              read.projectId === SOURCE_ID && read.token === "source-read-token" &&
              read.executionProject === "10000000-1000-4000-8000-100000000005"
            ),
            true,
          );
        } else assertEquals(sourceReads, []);
        assertEquals(fetches, authentic ? sourceReads.length : 0);
      } finally {
        apiKeys.forEach((key, index) =>
          previousApi[index] === undefined
            ? Deno.env.delete(key)
            : Deno.env.set(key, previousApi[index]!)
        );
        if (previousTrust === undefined) Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
        else Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousTrust);
        if (previousKey === undefined) Deno.env.delete("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
        else Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", previousKey);
      }
    });
  }
});
