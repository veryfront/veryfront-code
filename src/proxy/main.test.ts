import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";

describe("proxy main request URL parsing", () => {
  it("parses the incoming request URL once in the router", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));
    const requestUrlParses = source.match(/new URL\(req\.url\)/g) ?? [];

    assertEquals(requestUrlParses.length, 1);
  });

  it("uses an independent request body for every upstream attempt", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "getReplayableRequestBodies(req, maxRetries)");
    assertStringIncludes(source, "body: upstreamBodies[attempt] ?? null");
  });
});
