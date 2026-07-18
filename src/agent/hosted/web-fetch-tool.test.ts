import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { createHostedWebFetchTool } from "./web-fetch-tool.ts";

function createTestWebFetchTool(
  options: Parameters<typeof createHostedWebFetchTool>[0] = {},
) {
  return createHostedWebFetchTool({
    resolveHost: () => Promise.resolve(["93.184.216.34"]),
    ...options,
  });
}

Deno.test("createHostedWebFetchTool fetches an explicit HTTPS URL without prior search", async () => {
  const requestedUrls: string[] = [];
  const acceptHeaders: string[] = [];
  const tool = createTestWebFetchTool({
    fetch: (input, init) => {
      const requestInit = init as globalThis.RequestInit | undefined;
      requestedUrls.push(String(input));
      assertEquals(requestInit?.redirect, "manual");
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
  assertEquals((result as { complete?: unknown }).complete, true);
  assertEquals((result as { truncated?: unknown }).truncated, false);
});

Deno.test("createHostedWebFetchTool rejects non-http URLs", async () => {
  const tool = createTestWebFetchTool({
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

Deno.test("createHostedWebFetchTool returns resumable slices for large pages", async () => {
  const body = "0123456789abcdef";
  const tool = createTestWebFetchTool({
    maxContentChars: 8,
    fetch: () =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
  });

  const first = await tool.execute?.({
    url: "https://veryfront.com/long-doc",
  });

  assertEquals(
    (first as { content?: { source?: { data?: unknown } } }).content?.source?.data,
    "01234567",
  );
  assertEquals((first as { complete?: unknown }).complete, false);
  assertEquals((first as { truncated?: unknown }).truncated, true);
  assertEquals((first as { page_info?: unknown }).page_info, {
    offset: 0,
    returned_chars: 8,
    total_chars: 16,
    next: "8",
  });

  const second = await tool.execute?.({
    url: "https://veryfront.com/long-doc",
    cursor: "8",
  });

  assertEquals(
    (second as { content?: { source?: { data?: unknown } } }).content?.source?.data,
    "89abcdef",
  );
  assertEquals((second as { complete?: unknown }).complete, true);
  assertEquals((second as { truncated?: unknown }).truncated, false);
  assertEquals((second as { page_info?: unknown }).page_info, {
    offset: 8,
    returned_chars: 8,
    total_chars: 16,
    next: null,
  });
});

Deno.test("createHostedWebFetchTool honors host content limits above the default", async () => {
  const body = "x".repeat(500_001);
  const tool = createTestWebFetchTool({
    maxContentChars: 600_000,
    fetch: () =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
  });

  const result = await tool.execute?.({
    url: "https://veryfront.com/large-doc",
  });

  assertEquals(
    (result as { content?: { source?: { data?: string } } }).content?.source?.data?.length,
    500_001,
  );
  assertEquals((result as { complete?: unknown }).complete, true);
  assertEquals((result as { truncated?: unknown }).truncated, false);
  assertEquals((result as { page_info?: unknown }).page_info, {
    offset: 0,
    returned_chars: 500_001,
    total_chars: 500_001,
    next: null,
  });
});

Deno.test("createHostedWebFetchTool honors smaller per-call content limits", async () => {
  const tool = createTestWebFetchTool({
    fetch: () =>
      Promise.resolve(
        new Response("anthropic/claude-sonnet-4-6 appears after the old cutoff", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
  });

  const first = await tool.execute?.({
    url: "https://veryfront.com/docs/create-agent",
    max_content_chars: 10,
  });

  assertEquals(
    (first as { content?: { source?: { data?: unknown } } }).content?.source?.data,
    "anthropic/",
  );
  assertEquals((first as { complete?: unknown }).complete, false);
  assertEquals((first as { page_info?: { next?: unknown } }).page_info?.next, "10");
});

Deno.test("createHostedWebFetchTool rejects invalid pagination inputs", async () => {
  const tool = createTestWebFetchTool({
    fetch: () =>
      Promise.resolve(
        new Response("docs", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
  });

  await assertRejects(
    () =>
      tool.execute?.({
        url: "https://veryfront.com/docs",
        cursor: "not-an-offset",
      }) as Promise<unknown>,
    Error,
    "web_fetch cursor must be a non-negative integer offset returned by a previous web_fetch result",
  );

  await assertRejects(
    () =>
      tool.execute?.({
        url: "https://veryfront.com/docs",
        max_content_chars: 0,
      }) as Promise<unknown>,
    Error,
    "web_fetch max_content_chars must be a positive integer",
  );

  await assertRejects(
    () =>
      tool.execute?.({
        url: "https://veryfront.com/docs",
        cursor: "5",
      }) as Promise<unknown>,
    Error,
    "web_fetch cursor exceeds fetched content length",
  );
});

Deno.test("createHostedWebFetchTool blocks internal network targets", async () => {
  let fetchCalls = 0;
  const tool = createTestWebFetchTool({
    fetch: () => {
      fetchCalls++;
      return Promise.resolve(new Response("internal"));
    },
  });

  await assertRejects(
    () => tool.execute?.({ url: "http://127.0.0.1/private" }) as Promise<unknown>,
    Error,
    "network egress blocked",
  );
  assertEquals(fetchCalls, 0);
});

Deno.test("createHostedWebFetchTool blocks hostnames that resolve internally", async () => {
  let fetchCalls = 0;
  const tool = createHostedWebFetchTool({
    resolveHost: () => Promise.resolve(["10.0.0.5"]),
    fetch: () => {
      fetchCalls++;
      return Promise.resolve(new Response("internal"));
    },
  });

  await assertRejects(
    () => tool.execute?.({ url: "https://service.example/private" }) as Promise<unknown>,
    Error,
    "resolved to internal address",
  );
  assertEquals(fetchCalls, 0);
});

Deno.test("createHostedWebFetchTool validates every redirect target", async () => {
  let fetchCalls = 0;
  const tool = createTestWebFetchTool({
    fetch: () => {
      fetchCalls++;
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/metadata" },
        }),
      );
    },
  });

  await assertRejects(
    () => tool.execute?.({ url: "https://public.example/start" }) as Promise<unknown>,
    Error,
    "network egress blocked",
  );
  assertEquals(fetchCalls, 1);
});

Deno.test("createHostedWebFetchTool rejects responses above the byte cap", async () => {
  const tool = createTestWebFetchTool({
    maxResponseBytes: 4,
    fetch: () => Promise.resolve(new Response("12345", { status: 200 })),
  });

  await assertRejects(
    () => tool.execute?.({ url: "https://public.example/large" }) as Promise<unknown>,
    Error,
    "response exceeds maximum size",
  );
});
