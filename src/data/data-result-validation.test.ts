import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateDataResult } from "./data-result-validation.ts";
import { DataResultSchema, StaticDataResultSchema } from "./schemas/data.schema.ts";

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
});
