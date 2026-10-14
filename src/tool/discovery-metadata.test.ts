import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { normalizeToolDiscoveryMetadata } from "./discovery-metadata.ts";

it("copies only bounded versioned navigation fields", () => {
  assertEquals(
    normalizeToolDiscoveryMetadata({
      version: 1,
      type: "platform",
      domain: "agents",
      resource: "Agents",
      operation: "run",
      execute: true,
    }),
    { version: 1, type: "platform", domain: "agents", resource: "Agents", operation: "run" },
  );
});

it("ignores invalid navigation without evaluating accessors", () => {
  let reads = 0;
  const accessor = {
    version: 1,
    get type() {
      reads++;
      return "platform";
    },
  };
  for (
    const value of [
      undefined,
      null,
      accessor,
      { version: 2, type: "platform" },
      { version: 1, type: "other" },
      { version: 1, type: "platform", resource: "x".repeat(129) },
      { version: 1, type: "platform", operation: "x".repeat(129) },
      { version: 1, type: "integration", extra: "x".repeat(3_000) },
    ]
  ) {
    assertEquals(normalizeToolDiscoveryMetadata(value), undefined);
  }
  assertEquals(reads, 0);
});

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
