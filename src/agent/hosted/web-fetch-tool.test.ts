import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { createHostedWebFetchTool } from "./web-fetch-tool.ts";

Deno.test("createHostedWebFetchTool fetches an explicit HTTPS URL without prior search", async () => {
  const requestedUrls: string[] = [];
  const acceptHeaders: string[] = [];
  const tool = createHostedWebFetchTool({
    fetch: (input, init) => {
      const requestInit = init as globalThis.RequestInit | undefined;
      requestedUrls.push(String(input));
      assertEquals(requestInit?.redirect, "follow");
      acceptHeaders.push(new Headers(requestInit?.headers).get("accept") ?? "");
      return Promise.resolve(
        new Response("Create agent docs", {
          status: 200,
          headers: { "content-type": "text/markdown; charset=utf-8" },
        }),
      );
    },
  });

  const result = await tool.execute?.({
    url: "https://api.veryfront.com/docs/mcp?tool=create_agent",
  });

  assertEquals(requestedUrls, ["https://api.veryfront.com/docs/mcp?tool=create_agent"]);
  assertEquals(
    acceptHeaders,
    ["text/markdown,text/plain,text/html,application/xhtml+xml,application/xml,*/*;q=0.8"],
  );
  assertEquals((result as { type?: unknown }).type, "web_fetch_result");
  assertEquals(
    (result as { url?: unknown }).url,
    "https://api.veryfront.com/docs/mcp?tool=create_agent",
  );
  assertEquals(
    (result as { content?: { source?: { data?: unknown; mediaType?: unknown } } }).content
      ?.source?.mediaType,
    "text/markdown; charset=utf-8",
  );
  assertStringIncludes(
    String((result as { content?: { source?: { data?: unknown } } }).content?.source?.data),
    "Create agent docs",
  );
});

Deno.test("createHostedWebFetchTool rejects non-http URLs", async () => {
  const tool = createHostedWebFetchTool({
    fetch: () => {
      throw new Error("fetch should not be called");
    },
  });

  await assertRejects(
    () => tool.execute?.({ url: "file:///etc/passwd" }) as Promise<unknown>,
    Error,
    "web_fetch only supports http and https URLs",
  );
});
