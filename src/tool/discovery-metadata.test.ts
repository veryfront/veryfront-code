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
    ]
  ) {
    assertEquals(normalizeToolDiscoveryMetadata(value), undefined);
  }
  assertEquals(reads, 0);
});

it("ignores extension values without reflecting them", () => {
  let calls = 0;
  const extension = new Proxy({}, {
    getPrototypeOf() {
      calls++;
      throw new Error("extension reflected");
    },
    ownKeys() {
      calls++;
      throw new Error("extension reflected");
    },
  });
  assertEquals(
    normalizeToolDiscoveryMetadata({ version: 1, type: "integration", extra: extension }),
    { version: 1, type: "integration" },
  );
  assertEquals(
    normalizeToolDiscoveryMetadata({ version: 1, type: "integration", extra: "x".repeat(3000) }),
    { version: 1, type: "integration" },
  );
  assertEquals(normalizeToolDiscoveryMetadata(extension), undefined);
  assertEquals(calls, 0);
});
