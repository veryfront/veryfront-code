import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agentServiceFailureDiagnostic } from "./failure-diagnostic.ts";

describe("safe adapter failure metadata", () => {
  it("rejects deep proxy prototype chains without invoking their traps", () => {
    let hooks = 0;
    const proxy = new Proxy({}, {
      getPrototypeOf() {
        hooks++;
        throw new Error("private");
      },
    });
    const error = new DOMException("private", "AbortError");
    Object.setPrototypeOf(error, Object.create(proxy));
    assertEquals(agentServiceFailureDiagnostic("request-fetch", error), {
      stage: "request-fetch",
      errorName: "redacted",
      transportCode: "redacted",
    });
    assertEquals(hooks, 0);
  });

  it("fails closed when the prototype chain exceeds the bounded walk", () => {
    const error = new DOMException("private", "AbortError");
    let prototype = DOMException.prototype;
    for (let depth = 0; depth < 40; depth++) prototype = Object.create(prototype);
    Object.setPrototypeOf(error, prototype);
    assertEquals(agentServiceFailureDiagnostic("request-fetch", error), {
      stage: "request-fetch",
      errorName: "redacted",
      transportCode: "redacted",
    });
  });
  it("recognizes real DOMException abort and timeout reasons", async () => {
    const controller = new AbortController();
    controller.abort();
    const signal = AbortSignal.timeout(1);
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true })
    );
    for (
      const [error, name] of [
        [new DOMException("private abort", "AbortError"), "AbortError"],
        [new DOMException("private timeout", "TimeoutError"), "TimeoutError"],
        [controller.signal.reason, "AbortError"],
        [signal.reason, "TimeoutError"],
      ] as const
    ) {
      assertEquals(agentServiceFailureDiagnostic("request-fetch", error), {
        stage: "request-fetch",
        errorName: name,
        transportCode: "redacted",
      });
    }
  });

  it("keeps DOMException overrides and unknown names redacted without invoking hooks", () => {
    let hooks = 0;
    const getter = () => {
      hooks++;
      throw new Error("private");
    };
    const error = new DOMException("private", "AbortError");
    Object.defineProperties(error, {
      name: { get: getter },
      message: { get: getter },
      code: { get: getter },
      cause: { get: getter },
    });
    const spoof = Object.create(DOMException.prototype);
    Object.defineProperties(spoof, { name: { get: getter }, message: { get: getter } });
    const copiedSlots = Object.create(DOMException.prototype);
    Object.defineProperties(
      copiedSlots,
      Object.getOwnPropertyDescriptors(new DOMException("private", "AbortError")),
    );
    const revocable = Proxy.revocable(new DOMException("private", "AbortError"), {
      get: getter,
      getPrototypeOf: getter,
      getOwnPropertyDescriptor: getter,
    });
    revocable.revoke();
    for (
      const value of [
        error,
        spoof,
        copiedSlots,
        revocable.proxy,
        new DOMException("private", "PrivateError"),
      ]
    ) {
      assertEquals(agentServiceFailureDiagnostic("request-fetch", value), {
        stage: "request-fetch",
        errorName: "redacted",
        transportCode: "redacted",
      });
    }
    assertEquals(hooks, 0);
  });

  it("does not extend transport-code authority to non-native DOMExceptions", () => {
    const error = new DOMException("private", "AbortError");
    Object.defineProperty(error, "code", { value: "ECONNRESET" });
    // Native Error hosts retain the existing code rule; Bun's separate host
    // brand permits only the name, never direct or cause transport metadata.
    const result = agentServiceFailureDiagnostic("request-fetch", error);
    assertEquals(result.errorName, "AbortError");
    const native = agentServiceFailureDiagnostic(
      "request-fetch",
      new Error("private", { cause: error }),
    );
    assertEquals(result.transportCode, native.transportCode);
  });

  it("does not invoke replaced or inherited host-symbol slot getters", () => {
    let hooks = 0;
    const getter = () => {
      hooks++;
      throw new Error("private");
    };
    for (const key of Object.getOwnPropertySymbols(new DOMException())) {
      const error = new DOMException("private", "AbortError");
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      if (!descriptor?.configurable) continue;
      Object.defineProperty(error, key, { get: getter });
      assertEquals(agentServiceFailureDiagnostic("request-fetch", error).errorName, "redacted");
      const inherited = new DOMException("private", "AbortError");
      Reflect.deleteProperty(inherited, key);
      const prototype = Object.create(DOMException.prototype);
      Object.defineProperty(prototype, key, { get: getter });
      Object.defineProperty(prototype, "name", { get: getter });
      Object.setPrototypeOf(inherited, prototype);
      assertEquals(agentServiceFailureDiagnostic("request-fetch", inherited).errorName, "redacted");
    }
    assertEquals(hooks, 0);
  });
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
