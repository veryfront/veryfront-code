import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildResponseInit } from "./response-init.ts";

describe("agent service response init", () => {
  it("supplies own defaults in dictionaries without prototypes", () => {
    const init = buildResponseInit({});

    assertEquals(Object.getPrototypeOf(init), null);
    assertEquals(Object.keys(init), ["headers", "status", "statusText"]);
    assertEquals(Object.getPrototypeOf(init.headers), null);
    assertEquals(Object.keys(init.headers!), []);
    assertEquals(init.status, 200);
    assertEquals(init.statusText, "");
  });

  it("keeps headers independent between constructed option dictionaries", () => {
    const first = buildResponseInit({});
    const headers = first.headers as Record<string, string>;
    headers["Access-Control-Allow-Origin"] = "https://untrusted.example.test";

    const second = buildResponseInit({});
    assertEquals(Object.keys(second.headers!), []);
  });

  it("preserves explicit values, including values native validation must reject", () => {
    const valid = buildResponseInit({}, 201, "Created");
    assertEquals(valid.status, 201);
    assertEquals(valid.statusText, "Created");

    const invalid = buildResponseInit({}, 99, "invalid\ntext");
    assertEquals(invalid.status, 99);
    assertEquals(invalid.statusText, "invalid\ntext");
  });

  it("overrides inherited data properties with explicit response defaults", () => {
    const prototype = {
      headers: { "Access-Control-Allow-Origin": "https://untrusted.example.test" },
      status: 503,
      statusText: "Injected",
    };
    const init = buildResponseInit(prototype);

    assertEquals(Object.keys(init.headers!), []);
    assertEquals(init.status, 200);
    assertEquals(init.statusText, "");
  });

  for (const field of ["headers", "status", "statusText"]) {
    it(`rejects ${field} accessors without invoking them`, () => {
      let accessorCalls = 0;
      const accessors: PropertyDescriptor[] = [
        { get: () => accessorCalls++ },
        { set: () => accessorCalls++ },
        { get: () => accessorCalls++, set: () => accessorCalls++ },
        { get: undefined },
      ];
      for (const descriptor of accessors) {
        const prototype = Object.create(null);
        Object.defineProperty(prototype, field, descriptor);

        assertThrows(
          () => buildResponseInit(prototype, 201, "Created"),
          TypeError,
          "Cannot construct a response with inherited option accessors",
        );
      }
      assertEquals(accessorCalls, 0);
    });
  }
});
