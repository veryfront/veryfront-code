import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getDataContextSchema,
  getDataResultSchema,
  getStaticPathsResultSchema,
} from "./data.schema.ts";

describe("data schemas", () => {
  it("bounds route parameter names, values, and cardinality", () => {
    const base = {
      query: new URLSearchParams(),
      request: new Request("http://localhost/"),
      url: new URL("http://localhost/"),
    };

    assertEquals(
      getDataContextSchema().safeParse({
        ...base,
        params: { ["x".repeat(257)]: "value" },
      }).success,
      false,
    );
    assertEquals(
      getDataContextSchema().safeParse({
        ...base,
        params: { id: "x".repeat(4_097) },
      }).success,
      false,
    );
    assertEquals(
      getDataContextSchema().safeParse({
        ...base,
        params: Object.fromEntries(
          Array.from({ length: 257 }, (_, index) => [`key-${index}`, "value"]),
        ),
      }).success,
      false,
    );
    assertEquals(
      getDataContextSchema().safeParse({
        ...base,
        params: Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [
            `key-${index}`,
            "x".repeat(4_096),
          ]),
        ),
      }).success,
      false,
    );
  });

  it("bounds data context URLs and queries", () => {
    const base = {
      params: {},
      query: new URLSearchParams(),
      request: new Request("http://localhost/"),
      url: new URL("http://localhost/"),
    };

    assertEquals(
      getDataContextSchema().safeParse({
        ...base,
        url: new URL(`http://localhost/${"x".repeat(16_385)}`),
      }).success,
      false,
    );
    assertEquals(
      getDataContextSchema().safeParse({
        ...base,
        query: new URLSearchParams({ value: "x".repeat(32_769) }),
      }).success,
      false,
    );
  });

  it("bounds redirects and static path collections", () => {
    assertEquals(
      getDataResultSchema().safeParse({
        redirect: { destination: "x".repeat(8_193) },
      }).success,
      false,
    );
    assertEquals(
      getDataResultSchema().safeParse({
        redirect: { destination: "javascript:alert(1)" },
      }).success,
      false,
    );

    const path = { params: { id: "1" } };
    assertEquals(
      getStaticPathsResultSchema().safeParse({
        paths: Array(100_001).fill(path),
        fallback: false,
      }).success,
      false,
    );
  });

  it("preserves supported fractional and negative revalidation values", () => {
    assertEquals(
      getDataResultSchema().safeParse({ props: {}, revalidate: 0.5 }).success,
      true,
    );
    assertEquals(
      getDataResultSchema().safeParse({ props: {}, revalidate: -1 }).success,
      true,
    );
  });
});
