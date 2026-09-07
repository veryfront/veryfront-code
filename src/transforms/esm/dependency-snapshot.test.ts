import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createDependencyPinningSnapshot,
  decodeDependencySnapshot,
  encodeDependencySnapshot,
  hashDependencyPins,
} from "./dependency-snapshot.ts";

describe("dependency snapshot storage codec", () => {
  const namespace = "a".repeat(64);
  it("preserves the existing pin identity and canonical bytes across insertion order", () => {
    const a = { react: "19.2.4", zod: "4.0.0" };
    const b = { zod: "4.0.0", react: "19.2.4" };
    const key = `on:${hashDependencyPins(a)}`;
    assertEquals(hashDependencyPins({}), "54uvgwr2ih7p");
    assertEquals(
      encodeDependencySnapshot(namespace, createDependencyPinningSnapshot(key, a)),
      encodeDependencySnapshot(namespace, createDependencyPinningSnapshot(key, b)),
    );
  });
  it("rejects tampered dependencies and effective configuration under the original key", () => {
    const dependencies = { react: "19.2.4" };
    const configured = { react: { declaration: "^19", effective: "19.2.4" } };
    const key = `on:${hashDependencyPins(dependencies, configured)}`;
    const value = encodeDependencySnapshot(
      namespace,
      createDependencyPinningSnapshot(key, dependencies, configured),
    );
    const badDependencies = JSON.parse(value);
    badDependencies.snapshot.dependencies.react = "18.0.0";
    assertThrows(() => decodeDependencySnapshot(JSON.stringify(badDependencies), namespace, key));
    const badConfiguration = JSON.parse(value);
    badConfiguration.snapshot.configuredVersions.react.effective = "18.0.0";
    assertThrows(() => decodeDependencySnapshot(JSON.stringify(badConfiguration), namespace, key));
    assertThrows(() => decodeDependencySnapshot(value, "b".repeat(64), key));
  });
  it("owns frozen copies of dependency maps including prototype-shaped names", () => {
    const dependencies = JSON.parse('{"__proto__":"1.0.0","react":"19.2.4"}');
    const snapshot = createDependencyPinningSnapshot(
      `on:${hashDependencyPins(dependencies)}`,
      dependencies,
    );
    const value = encodeDependencySnapshot(namespace, snapshot);
    dependencies.react = "changed";
    const restored = decodeDependencySnapshot(value, namespace, snapshot.cacheKey);
    assertEquals(restored.dependencies?.react, "19.2.4");
    assertEquals(restored.dependencies?.["__proto__"], "1.0.0");
    assertEquals(Object.getPrototypeOf(restored.dependencies), null);
    assertEquals(Object.isFrozen(restored.dependencies), true);
    assertEquals(Object.isFrozen(restored), true);
  });
});
