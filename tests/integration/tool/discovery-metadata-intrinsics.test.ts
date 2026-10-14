import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { normalizeToolDiscoveryMetadata } from "#veryfront/tool/discovery-metadata.ts";

it("never reads or writes inherited navigation accessors", () => {
  let hooks = 0;
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "domain");
  let absent: unknown;
  let present: unknown;
  try {
    Object.defineProperty(Object.prototype, "domain", {
      configurable: true,
      get() {
        hooks++;
        return "forged";
      },
      set() {
        hooks++;
      },
    });
    absent = normalizeToolDiscoveryMetadata({ version: 1, type: "platform" });
    present = normalizeToolDiscoveryMetadata({ version: 1, type: "platform", domain: "agents" });
  } finally {
    if (original) Object.defineProperty(Object.prototype, "domain", original);
    else Reflect.deleteProperty(Object.prototype, "domain");
  }
  assertEquals(hooks, 0);
  assertEquals(absent, { version: 1, type: "platform" });
  assertEquals(present, { version: 1, type: "platform", domain: "agents" });
});
