import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import { isRetriableConnectFailure } from "#veryfront/platform/compat/http/pinned-fetch.ts";

describe("Connection retry policy intrinsics", () => {
  it("does not admit a reset after project code replaces Set.has", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Set.prototype, "has")!;
    let resetAdmitted: boolean;
    try {
      Object.defineProperty(Set.prototype, "has", { ...descriptor, value: () => true });
      resetAdmitted = isRetriableConnectFailure({ code: "ECONNRESET" });
    } finally {
      Object.defineProperty(Set.prototype, "has", descriptor);
    }
    assertEquals(resetAdmitted, false);
  });
});
