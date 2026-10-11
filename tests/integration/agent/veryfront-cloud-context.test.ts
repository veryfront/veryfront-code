import { AsyncLocalStorage } from "node:async_hooks";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getCurrentVeryfrontCloudModelCallCapture,
  runWithVeryfrontCloudContext,
  runWithVeryfrontCloudModelCallCapture,
} from "#veryfront/provider/veryfront-cloud/context.ts";

const receipt = {
  eventId: "9007199254740993",
  projectId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  modelCallId: "33333333-3333-4333-8333-333333333333",
};

describe("trusted Cloud model capture scope", () => {
  it("survives replacement of ordinary Cloud context without accepting its fields as authority", () => {
    const ambient = { apiToken: "synthetic-token", modelCallCapture: receipt };
    runWithVeryfrontCloudContext(ambient, () => {
      assertEquals(getCurrentVeryfrontCloudModelCallCapture(), undefined);
      runWithVeryfrontCloudModelCallCapture({ receipt, assertActive() {} }, () => {
        runWithVeryfrontCloudContext({ apiToken: "synthetic-owned-token" }, () => {
          assertEquals(getCurrentVeryfrontCloudModelCallCapture(), receipt);
        });
      });
    });
    assertEquals(getCurrentVeryfrontCloudModelCallCapture(), undefined);
  });

  it("keeps concurrent calls independent and copies receipt fields before invocation", async () => {
    const first = { ...receipt };
    const second = { ...receipt, modelCallId: "44444444-4444-4444-8444-444444444444" };
    const seen = await Promise.all([first, second].map((owned) => {
      const expected = owned.modelCallId;
      return runWithVeryfrontCloudModelCallCapture(
        { receipt: owned, assertActive() {} },
        async () => {
          owned.modelCallId = "55555555-5555-4555-8555-555555555555";
          await Promise.resolve();
          assertEquals(getCurrentVeryfrontCloudModelCallCapture()?.modelCallId, expected);
          return expected;
        },
      );
    }));
    assertEquals(new Set(seen).size, 2);
    assertEquals(getCurrentVeryfrontCloudModelCallCapture(), undefined);
  });

  it("rechecks invocation authority every time transport reads the capture", () => {
    let active = true;
    runWithVeryfrontCloudModelCallCapture({
      receipt,
      assertActive() {
        if (!active) throw new TypeError("Synthetic revoked capture scope");
      },
    }, () => {
      assertEquals(getCurrentVeryfrontCloudModelCallCapture(), receipt);
      active = false;
      assertThrows(() => getCurrentVeryfrontCloudModelCallCapture(), TypeError, "revoked");
    });
  });

  it("keeps capture receipts out of replaced async-context and freeze hooks", () => {
    const run = AsyncLocalStorage.prototype.run;
    const getStore = AsyncLocalStorage.prototype.getStore;
    const freeze = Object.freeze;
    const observed: unknown[] = [];
    try {
      AsyncLocalStorage.prototype.run = function (
        this: AsyncLocalStorage<unknown>,
        ...args: unknown[]
      ) {
        observed.push(args[0]);
        return Reflect.apply(run, this, args);
      };
      AsyncLocalStorage.prototype.getStore = function (this: AsyncLocalStorage<unknown>) {
        const store = Reflect.apply(getStore, this, []);
        observed.push(store);
        return store;
      };
      Object.freeze = function <T>(value: T): Readonly<T> {
        observed.push(value);
        return Reflect.apply(freeze, Object, [value]) as Readonly<T>;
      };
      runWithVeryfrontCloudModelCallCapture({ receipt, assertActive() {} }, () => {
        assertEquals(getCurrentVeryfrontCloudModelCallCapture(), receipt);
      });
    } finally {
      AsyncLocalStorage.prototype.run = run;
      AsyncLocalStorage.prototype.getStore = getStore;
      Object.freeze = freeze;
    }
    assertEquals(JSON.stringify(observed).includes(receipt.modelCallId), false);
    assertEquals(getCurrentVeryfrontCloudModelCallCapture(), undefined);
  });

  it("clears enclosing capture authority for an explicitly uncorrelated dispatch", () => {
    runWithVeryfrontCloudModelCallCapture({ receipt, assertActive() {} }, () => {
      runWithVeryfrontCloudModelCallCapture({ receipt: undefined, assertActive() {} }, () => {
        assertEquals(getCurrentVeryfrontCloudModelCallCapture(), undefined);
      });
      assertEquals(getCurrentVeryfrontCloudModelCallCapture(), receipt);
    });
  });
});
