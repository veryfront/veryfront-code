import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agentServiceFailureDiagnostic } from "#veryfront/eval/agent-service/failure-diagnostic.ts";

// Replaces a process-global host intrinsic; keep this outside hermetic units.
describe("adapter failure diagnostics with replaced host intrinsics", () => {
  it("uses the captured DOMException accessor even if the prototype is later replaced", () => {
    const descriptor = Object.getOwnPropertyDescriptor(DOMException.prototype, "name");
    if (!descriptor) throw new Error("Missing native DOMException name");
    let hooks = 0;
    Object.defineProperty(DOMException.prototype, "name", {
      configurable: true,
      get() {
        hooks++;
        return "PrivateError";
      },
    });
    try {
      assertEquals(
        agentServiceFailureDiagnostic("request-fetch", new DOMException("private", "AbortError"))
          .errorName,
        "AbortError",
      );
      assertEquals(
        agentServiceFailureDiagnostic("request-fetch", new Error("private")).errorName,
        "Error",
      );
      assertEquals(hooks, 0);
    } finally {
      Object.defineProperty(DOMException.prototype, "name", descriptor);
    }
  });
});
