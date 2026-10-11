import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/client.ts";
import type { VeryfrontAPIConfig } from "#veryfront/platform/adapters/veryfront-api-client/types.ts";

const PROJECT_ID = "00000000-0000-4000-8000-000000000123";

const baseConfig = {
  apiBaseUrl: "http://test.api",
  apiToken: "config-token",
  projectSlug: "config-slug",
};

function createClient(config: VeryfrontAPIConfig = baseConfig): VeryfrontApiClient {
  return new VeryfrontApiClient(config);
}

describe("VeryfrontApiClient dependencies", () => {
  it("reads the dependency history of a branch through dependencies.getHistory", async () => {
    const client = createClient({ ...baseConfig, projectId: PROJECT_ID });
    await client.initialize();
    const requests: string[] = [];
    const history = await withMockFetch((input) => {
      requests.push(String(input));
      return Promise.resolve(
        new Response(
          `{"version":1,"project_id":"${PROJECT_ID}","branch":"feature-a","entries":[` +
            `{"dependencies":{"__proto__":"raw","react":"^19"},"expires_at":1}]}`,
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }, () => client.dependencies.getHistory({ branch: "feature-a" }));

    assertEquals(requests, [
      "http://test.api/projects/config-slug/dependencies/history?branch=feature-a",
    ]);
    assertEquals(history.branch, "feature-a");
    const dependencies = history.entries[0]!.dependencies;
    assertEquals(Object.hasOwn(dependencies, "__proto__"), true);
    assertEquals(Object.getOwnPropertyDescriptor(dependencies, "__proto__")?.value, "raw");
    assertEquals(dependencies.react, "^19");
  });

  it("pins specifiers through dependencies.resolve", async () => {
    const client = createClient();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const resolution = await withMockFetch((input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return request.text().then((body) => {
        requests.push({ url: request.url, method: request.method, body: JSON.parse(body) });
        return Response.json({
          pins: { react: "19.2.4" },
          persisted: false,
          skipped: { zod: "declaration_changed" },
        });
      });
    }, () =>
      client.dependencies.resolve({
        specifiers: ["react@^19", "zod@^3", "missing-package"],
        branch: "feature-a",
        expectedDeclarations: { react: "^19", zod: "^3", "missing-package": null },
      }));

    assertEquals(requests, [{
      url: "http://test.api/projects/config-slug/dependencies/resolve",
      method: "POST",
      body: {
        specifiers: ["react@^19", "zod@^3", "missing-package"],
        branch: "feature-a",
        expected_declarations: { react: "^19", zod: "^3", "missing-package": null },
      },
    }]);
    assertEquals({ ...resolution.pins }, { react: "19.2.4" });
    assertEquals(resolution.persisted, false);
    assertEquals({ ...resolution.skipped }, { zod: "declaration_changed" });
  });

  it("sends no branch for main", async () => {
    const client = createClient();
    const bodies: unknown[] = [];
    await withMockFetch((input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return request.text().then((body) => {
        bodies.push(JSON.parse(body));
        return Response.json({ pins: {}, persisted: true, skipped: {} });
      });
    }, () => client.dependencies.resolve({ specifiers: ["react"], branch: "main" }));

    assertEquals(bodies, [{ specifiers: ["react"] }]);
  });

  it("rejects a resolution with an unknown skip reason", async () => {
    const client = createClient();
    await withMockFetch(
      () =>
        Promise.resolve(
          Response.json({ pins: {}, persisted: true, skipped: { react: "other" } }),
        ),
      () =>
        assertRejects(
          () => client.dependencies.resolve({ specifiers: ["react"] }),
          VeryfrontError,
          "dependency resolution contains an invalid dependency skip reason",
        ),
    );
  });
});
