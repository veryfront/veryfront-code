import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  __resetOperatorVeryfrontApiOriginsForTests,
  __runWithOutboundFetchTransportForTests,
} from "#veryfront/security/http/outbound-fetch.ts";
import { handleIntegrationCommand } from "../../../../../../cli/commands/integration/handler.ts";

it("integration reaches an operator-exported API origin that resolves to a private address", async () => {
  const apiUrl = "https://api.staging.example";
  const previous = Deno.env.get("VERYFRONT_API_URL");
  const requests: string[] = [];
  const reply = (input: RequestInfo | URL) => {
    requests.push(String(input));
    return Promise.resolve(Response.json({ detail: "reached" }, { status: 403 }));
  };
  const transport = {
    fetch: reply,
    pinnedFetch: (url: URL) => reply(url),
    resolveHost: () => Promise.resolve(["10.255.128.3"]),
  };
  Deno.env.set("VERYFRONT_API_URL", apiUrl);
  __resetOperatorVeryfrontApiOriginsForTests();
  try {
    await __runWithOutboundFetchTransportForTests(
      transport,
      () =>
        assertRejects(() =>
          handleIntegrationCommand({ _: ["integration", "list"], project: "alpha" }, {
            resolveConfig: () =>
              Promise.resolve({ apiUrl, apiToken: "synthetic-token", projectSlug: "alpha" }),
            registerSignals: () => () => {},
          })
        ),
    );
  } finally {
    __resetOperatorVeryfrontApiOriginsForTests();
    if (previous === undefined) Deno.env.delete("VERYFRONT_API_URL");
    else Deno.env.set("VERYFRONT_API_URL", previous);
  }
  assertEquals(requests.length > 0, true, "the private staging API must be dispatched to");
  assertEquals(requests.every((url) => url.startsWith(`${apiUrl}/`)), true);
});
