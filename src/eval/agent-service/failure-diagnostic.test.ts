import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agentServiceFailureDiagnostic } from "./failure-diagnostic.ts";

describe("safe adapter failure metadata", () => {
  it("prefers a direct allowlisted code and permits one native cause", () => {
    const cause = new Error("private cause");
    Object.defineProperty(cause, "code", { value: "ECONNRESET" });
    const error = new TypeError("private message", { cause });
    Object.defineProperty(error, "code", { value: "ETIMEDOUT" });
    assertEquals(agentServiceFailureDiagnostic("request-fetch", error), {
      stage: "request-fetch",
      errorName: "TypeError",
      transportCode: "ETIMEDOUT",
    });
    assertEquals(agentServiceFailureDiagnostic("request-fetch", new Error("private", { cause })), {
      stage: "request-fetch",
      errorName: "Error",
      transportCode: "ECONNRESET",
    });
  });

  it("emits only the documented fixed native names and transport codes", () => {
    for (
      const code of [
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "ENOTFOUND",
        "EAI_AGAIN",
        "ECONNABORTED",
        "EPIPE",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_HEADERS_TIMEOUT",
        "UND_ERR_BODY_TIMEOUT",
        "UND_ERR_SOCKET",
        "ERR_STREAM_PREMATURE_CLOSE",
      ]
    ) {
      const error = new Error("private");
      Object.defineProperty(error, "code", { value: code });
      assertEquals(agentServiceFailureDiagnostic("request-fetch", error).transportCode, code);
    }
    for (
      const name of [
        "Error",
        "TypeError",
        "SyntaxError",
        "RangeError",
        "AbortError",
        "TimeoutError",
        "AggregateError",
      ]
    ) {
      const error = new Error("private");
      Object.defineProperty(error, "name", { value: name });
      assertEquals(agentServiceFailureDiagnostic("request-fetch", error).errorName, name);
    }
  });

  it("does not copy unknown names, codes, messages, stacks or arbitrary cause properties", () => {
    const error = new Error("private message", { cause: { code: "ECONNRESET" } });
    Object.defineProperties(error, {
      name: { value: "PrivateCustomerError" },
      code: { value: "private code" },
    });
    assertEquals(agentServiceFailureDiagnostic("response-read", error), {
      stage: "response-read",
      errorName: "redacted",
      transportCode: "redacted",
    });
    for (
      const value of [undefined, null, "private message", { name: "TypeError", code: "ECONNRESET" }]
    ) {
      assertEquals(agentServiceFailureDiagnostic("request-build", value), {
        stage: "request-build",
        errorName: "redacted",
        transportCode: "redacted",
      });
    }
  });

  it("does not execute property getters or proxy traps", () => {
    let hooks = 0;
    const getter = () => {
      hooks++;
      throw new Error("private getter");
    };
    const error = new Error();
    Object.defineProperties(error, {
      name: { get: getter },
      code: { get: getter },
      cause: { get: getter },
      message: { get: getter },
      stack: { get: getter },
    });
    assertEquals(agentServiceFailureDiagnostic("request-fetch", error), {
      stage: "request-fetch",
      errorName: "redacted",
      transportCode: "redacted",
    });
    const proxy = new Proxy(new Error(), {
      get: getter,
      getPrototypeOf: getter,
      getOwnPropertyDescriptor: getter,
    });
    assertEquals(agentServiceFailureDiagnostic("request-fetch", proxy), {
      stage: "request-fetch",
      errorName: "redacted",
      transportCode: "redacted",
    });
    const withProxyCause = new Error("private", { cause: proxy });
    assertEquals(
      agentServiceFailureDiagnostic("request-fetch", withProxyCause).transportCode,
      "redacted",
    );
    assertEquals(hooks, 0);
  });

  it("does not inspect a proxy prototype or traverse further causes", () => {
    let hooks = 0;
    const error = new Error();
    Object.setPrototypeOf(
      error,
      new Proxy(Error.prototype, {
        get() {
          hooks++;
          throw new Error("private");
        },
        getOwnPropertyDescriptor() {
          hooks++;
          throw new Error("private");
        },
      }),
    );
    assertEquals(agentServiceFailureDiagnostic("request-fetch", error).errorName, "redacted");
    const inner = new Error();
    Object.defineProperty(inner, "code", { value: "ECONNRESET" });
    assertEquals(
      agentServiceFailureDiagnostic(
        "request-fetch",
        new Error("", {
          cause: new Error("", { cause: inner }),
        }),
      ).transportCode,
      "redacted",
    );
    assertEquals(hooks, 0);
  });
});
