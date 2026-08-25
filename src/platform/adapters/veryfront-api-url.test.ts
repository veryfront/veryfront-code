import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { createVeryfrontApiRequestUrlResolver } from "./veryfront-api-url.ts";

Deno.test("Veryfront API URL resolver preserves configured base paths", () => {
  const resolveUrl = createVeryfrontApiRequestUrlResolver("https://api.example.test/v1");

  assertEquals(
    resolveUrl("/runs/run_parent/children/run_child/event-writer-token"),
    "https://api.example.test/v1/runs/run_parent/children/run_child/event-writer-token",
  );
  assertEquals(
    resolveUrl("projects/project_1"),
    "https://api.example.test/v1/projects/project_1",
  );
});

Deno.test("Veryfront API URL resolver rejects a different request origin", () => {
  const resolveUrl = createVeryfrontApiRequestUrlResolver("https://api.example.test/v1");

  assertThrows(
    () => resolveUrl("https://attacker.example/runs/run_1"),
    TypeError,
    "origin",
  );
});

Deno.test("Veryfront API URL resolver rejects paths outside the configured base path", () => {
  const resolveUrl = createVeryfrontApiRequestUrlResolver("https://api.example.test/v1");

  for (
    const pathOrUrl of [
      "/../admin",
      "../admin",
      "/%2e%2e/admin",
    ]
  ) {
    assertThrows(
      () => resolveUrl(pathOrUrl),
      TypeError,
      "base path",
      pathOrUrl,
    );
  }
});

Deno.test("Veryfront API URL resolver permits the configured base path and descendants", () => {
  const resolveUrl = createVeryfrontApiRequestUrlResolver("https://api.example.test/v1/");

  assertEquals(
    resolveUrl("https://api.example.test/v1/runs/run_1?after=cursor"),
    "https://api.example.test/v1/runs/run_1?after=cursor",
  );
  assertEquals(
    resolveUrl("?health=1"),
    "https://api.example.test/v1?health=1",
  );
  assertEquals(
    resolveUrl("https://api.example.test/admin/health"),
    "https://api.example.test/admin/health",
  );
});

Deno.test("Veryfront API URL resolver rejects credentials and malformed base URLs", () => {
  const resolveUrl = createVeryfrontApiRequestUrlResolver("https://api.example.test/v1");

  assertThrows(
    () => resolveUrl("https://user:pass@api.example.test/v1/runs/run_1"),
    TypeError,
    "credentials",
    "a same-origin request URL carrying userinfo must be rejected",
  );
  assertThrows(
    () => resolveUrl("ftp://api.example.test/v1/runs"),
    TypeError,
    "http or https",
    "non-http request URLs must be rejected",
  );

  for (
    const [baseUrl, message] of [
      ["https://user:pass@api.example.test", "credentials"],
      ["ftp://api.example.test", "http or https"],
      [" https://api.example.test ", "non-empty absolute URL"],
      ["", "non-empty absolute URL"],
      ["https://api.example.test/v1?x=1", "query or fragment"],
      ["https://api.example.test/v1#f", "query or fragment"],
    ] as const
  ) {
    assertThrows(
      () => createVeryfrontApiRequestUrlResolver(baseUrl),
      TypeError,
      message,
      baseUrl,
    );
  }
});
