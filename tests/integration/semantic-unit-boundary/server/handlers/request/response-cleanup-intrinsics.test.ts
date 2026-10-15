import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withResponseCleanup } from "#veryfront/server/handlers/request/response-cleanup.ts";

it("preserves response metadata and cleanup after project response intrinsic replacement", async () => {
  const input = new Response("hello", {
    status: 200,
    statusText: "Accepted stream",
    headers: { "x-runtime": "trusted" },
  });
  input.headers.append("set-cookie", "first=1; Path=/");
  input.headers.append("set-cookie", "second=2; Path=/");
  const responseFields = ["status", "statusText", "headers", "body"] as const;
  // Bun makes response accessors immutable; exercise only replaceable host surfaces.
  const descriptors = responseFields.map((field) =>
    [field, Object.getOwnPropertyDescriptor(Response.prototype, field)!] as const
  ).filter(([, descriptor]) => descriptor.configurable);
  const iterator = Object.getOwnPropertyDescriptor(Headers.prototype, Symbol.iterator)!;
  const poison = () => {
    throw new Error("project intrinsic invoked");
  };
  let cleaned = 0;
  let response: Response;
  try {
    for (const [field, descriptor] of descriptors) {
      Object.defineProperty(Response.prototype, field, { ...descriptor, get: poison });
    }
    Object.defineProperty(Headers.prototype, Symbol.iterator, { ...iterator, value: poison });
    response = withResponseCleanup(input, () => cleaned++, new AbortController().signal);
  } finally {
    for (const [field, descriptor] of descriptors) {
      Object.defineProperty(Response.prototype, field, descriptor);
    }
    Object.defineProperty(Headers.prototype, Symbol.iterator, iterator);
  }
  assertEquals(response.status, 200);
  assertEquals(response.statusText, "Accepted stream");
  assertEquals(response.headers.getSetCookie(), ["first=1; Path=/", "second=2; Path=/"]);
  assertEquals(response.headers.get("x-runtime"), "trusted");
  assertEquals(cleaned, 0);
  assertEquals(await response.text(), "hello");
  assertEquals(cleaned, 1);
});
