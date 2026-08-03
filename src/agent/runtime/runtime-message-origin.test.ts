import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isGenuineUserTurnMessage,
  isRuntimeGeneratedUserMessage,
  markRuntimeGeneratedUserMessage,
} from "./runtime-message-origin.ts";

describe("agent/runtime message origin", () => {
  it("distinguishes genuine user turns from tagged runtime continuations", () => {
    const runtimeMessage = markRuntimeGeneratedUserMessage({
      role: "user",
    });

    assertEquals(isRuntimeGeneratedUserMessage(runtimeMessage), true);
    assertEquals(isGenuineUserTurnMessage(runtimeMessage), false);
    assertEquals(isGenuineUserTurnMessage({ role: "user" }), true);
    assertEquals(isGenuineUserTurnMessage({ role: "assistant" }), false);
    assertEquals(
      isGenuineUserTurnMessage({
        role: "user",
        metadata: {
          __veryfrontRuntimeGeneratedUserMessage: "unavailable-tool-recovery",
        },
      }),
      true,
    );
  });

  it("does not invoke accessor-backed or proxy message fields", () => {
    let reads = 0;
    const accessorRole = Object.defineProperty(
      {},
      "role",
      {
        get() {
          reads += 1;
          return "user";
        },
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const revokedMessage = Proxy.revocable({ role: "user" }, {});
    revokedMessage.revoke();

    const original = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value: "user",
    });
    try {
      assertEquals(isRuntimeGeneratedUserMessage(accessorRole), false);
      assertEquals(
        isRuntimeGeneratedUserMessage({ role: "user", metadata: revoked.proxy }),
        false,
      );
      assertEquals(isRuntimeGeneratedUserMessage(revokedMessage.proxy), false);
      assertEquals(isGenuineUserTurnMessage(revokedMessage.proxy), false);
      assertEquals(reads, 0);
    } finally {
      if (original) {
        Object.defineProperty(Object.prototype, "value", original);
      } else {
        delete (Object.prototype as Record<string, unknown>).value;
      }
    }
  });
});
