import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isResponseLike } from "./response-like.ts";

describe("isResponseLike", () => {
  it("accepts native responses", () => {
    assertEquals(isResponseLike(new Response("ok", { status: 201 })), true);
  });

  it("accepts response-shaped values from another runtime realm", () => {
    assertEquals(
      isResponseLike({
        status: 401,
        headers: new Headers(),
        bodyUsed: false,
        text: async () => "unauthorized",
        json: async () => ({ error: "unauthorized" }),
      }),
      true,
    );
  });

  it("accepts minimal response-shaped test doubles", () => {
    assertEquals(
      isResponseLike({
        status: 400,
        headers: new Headers(),
        text: async () => "bad request",
        json: async () => ({ error: "bad request" }),
      }),
      true,
    );
  });

  it("rejects ordinary objects with only a status", () => {
    assertEquals(isResponseLike({ status: 200 }), false);
  });
});
