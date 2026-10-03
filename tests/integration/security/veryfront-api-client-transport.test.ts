import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  HEADER_METHODS,
  installCredentialProbes,
  installGlobalFetchProbe,
} from "../../../src/security/http/credential-probes.test-helpers.ts";
import { VeryfrontApiClient } from "../../../src/platform/adapters/veryfront-api-client/client.ts";

const TOKEN = "vf-api-client-run-token-canary-93be";

/** Every string reachable from `value` through own properties, without calling getters. */
function reachableStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null || seen.has(value)) return [];
  seen.add(value);
  const strings: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) {
      strings.push(...reachableStrings(descriptor.value, seen));
    }
  }
  return strings;
}

// Replaces the global fetch and patches shared prototypes, so it runs as an integration test.
describe("VeryfrontApiClient transport", () => {
  it("sends the token past a replaced global fetch and patched Headers members", async () => {
    const authorizations: (string | undefined)[] = [];
    // The host transport the client sends through, captured before project code.
    installMockFetch((_input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      authorizations.push(
        headers && Object.hasOwn(headers, "authorization") ? headers.authorization : undefined,
      );
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    // Project code, loaded later: it replaces the global fetch and every
    // Headers member native fetch does not call itself.
    const fetchProbe = installGlobalFetchProbe();
    const probes = installCredentialProbes({
      headerMethods: HEADER_METHODS.filter((name) => name !== "has" && name !== "append"),
    });
    let client: VeryfrontApiClient;
    let result: unknown;
    try {
      client = new VeryfrontApiClient({
        apiBaseUrl: "https://api.example.test",
        apiToken: TOKEN,
        projectSlug: "demo",
        retry: { maxRetries: 0 },
      });
      result = await client.getFileById("file-1");
    } finally {
      probes.restore();
      fetchProbe.restore();
      restoreMockFetch();
    }

    assertEquals(result, null);
    assertEquals(authorizations, [`Bearer ${TOKEN}`]);
    assertEquals(fetchProbe.calls(), 0);
    assertEquals(probes.saw(TOKEN), false);
    // The token is not a plain property anywhere on the client.
    assertEquals(reachableStrings(client).includes(TOKEN), false);
  });
});
