import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateDataResult } from "./data-result-validation.ts";
import {
  DataResultSchema,
  ResponseCookieSchema,
  StaticDataResultSchema,
} from "./schemas/data.schema.ts";

describe("validateDataResult", () => {
  it("preserves redirect and not-found precedence over props", () => {
    assertEquals(
      validateDataResult(
        {
          props: { ignored: true },
          redirect: { destination: "/next" },
          notFound: true,
          revalidate: Number.POSITIVE_INFINITY,
          headers: { "x-page-state": "redirected" },
        },
        "getServerData",
      ),
      {
        redirect: { destination: "/next" },
        headers: { "x-page-state": "redirected" },
      },
    );

    assertEquals(
      validateDataResult(
        {
          props: { ignored: true },
          notFound: true,
          revalidate: "ignored",
          headers: { "x-page-state": "missing" },
        },
        "getServerData",
      ),
      {
        notFound: true,
        headers: { "x-page-state": "missing" },
      },
    );
  });

  it("rejects negative revalidation values", () => {
    assertThrows(
      () =>
        validateDataResult(
          { props: { value: "fresh" }, revalidate: -100 },
          "getStaticData",
        ),
      TypeError,
      "getStaticData must return a valid data result object",
    );
  });

  it("rejects negative revalidation values in the exported schemas", () => {
    for (const schema of [DataResultSchema, StaticDataResultSchema]) {
      assertEquals(schema.safeParse({ props: {}, revalidate: -1 }).success, false);
      assertEquals(schema.safeParse({ props: {}, revalidate: 0 }).success, true);
    }
  });

  it("keeps exported schema validation aligned with response metadata rules", () => {
    assertEquals(
      StaticDataResultSchema.safeParse({
        props: {},
        cookies: [{ name: "session", value: "unsafe" }],
      }).success,
      false,
    );
    assertEquals(
      StaticDataResultSchema.safeParse({ props: {}, headers: { "x-state": "ready" } }).success,
      false,
    );
    assertEquals(
      DataResultSchema.safeParse({ props: {}, headers: { "set-cookie": "unsafe=1" } }).success,
      false,
    );
    assertEquals(
      DataResultSchema.safeParse({
        props: {},
        cookies: [{ name: "session", value: "safe", maxAge: 1.5 }],
      }).success,
      false,
    );
    assertEquals(
      DataResultSchema.safeParse({
        props: {},
        cookies: [{ name: "session", value: "safe", unsupported: true }],
      }).success,
      false,
    );
    assertEquals(
      DataResultSchema.safeParse({
        props: {},
        headers: { "x-page-state": "ready" },
        cookies: [{ name: "session", value: "safe", maxAge: 60, httpOnly: true }],
      }).success,
      true,
    );
  });

  it("keeps standalone cookie validation aligned with runtime rules", () => {
    for (
      const cookie of [
        { name: "session", value: "unsafe", maxAge: 1.5 },
        { name: "session", value: "unsafe", expires: "not-a-date" },
        { name: "__Secure-session", value: "unsafe" },
        { name: "__Host-session", value: "unsafe", secure: true, path: "/nested" },
        { name: "session", value: "unsafe", sameSite: "none" },
      ]
    ) {
      assertEquals(ResponseCookieSchema.safeParse(cookie).success, false);
    }

    assertEquals(
      ResponseCookieSchema.safeParse({
        name: "__Host-session",
        value: "safe",
        secure: true,
        path: "/",
        sameSite: "none",
      }).success,
      true,
    );
  });
});
