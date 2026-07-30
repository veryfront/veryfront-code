import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractHandlerRequestPathname, extractRequestPathname } from "./request-instance.ts";

describe("request-instance diagnostics", () => {
  it("does not follow inherited descriptor values for accessor fields", () => {
    let requestUrlReads = 0;
    const request = Object.defineProperty({}, "url", {
      configurable: true,
      get(): never {
        requestUrlReads += 1;
        throw new Error("request URL accessor must not run");
      },
    });
    let contextRequestReads = 0;
    const context = Object.defineProperty({}, "req", {
      configurable: true,
      get(): never {
        contextRequestReads += 1;
        throw new Error("context request accessor must not run");
      },
    });
    const previousValue = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "value",
    );
    let inheritedValueReads = 0;
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      get(): never {
        inheritedValueReads += 1;
        throw new Error("inherited descriptor value must not run");
      },
    });

    let requestPathname: string | undefined;
    let contextPathname: string | undefined;
    try {
      requestPathname = extractRequestPathname(request);
      contextPathname = extractHandlerRequestPathname(context);
    } finally {
      if (previousValue) {
        Object.defineProperty(Object.prototype, "value", previousValue);
      } else {
        Reflect.deleteProperty(Object.prototype, "value");
      }
    }

    assertEquals(requestPathname, undefined);
    assertEquals(contextPathname, undefined);
    assertEquals(requestUrlReads, 0);
    assertEquals(contextRequestReads, 0);
    assertEquals(inheritedValueReads, 0);
  });
});
