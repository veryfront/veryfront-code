import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("snapshot storage on edge hosts", () => {
  it("snapshot provider capture rejects unsupported hosts before invoking proxy traps", async () => {
    const script = `
    Object.defineProperty(globalThis, "caches", { value: {}, configurable: true });
    Object.defineProperty(globalThis, "WebSocketPair", { value: function() {}, configurable: true });
    const { canIdentifyProxyWithoutHooks } = await import("#veryfront/platform/compat/error-introspection.ts");
    const { createDependencySnapshotStoreHandle } = await import("#veryfront/platform/adapters/dependency-snapshot-store.ts");
    let traps = 0;
    const provider = new Proxy({
      publish: () => Promise.resolve(),
      read: () => Promise.resolve(null),
    }, {
      getOwnPropertyDescriptor(target, key) {
        traps++;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    let rejected = false;
    try { createDependencySnapshotStoreHandle(provider); } catch { rejected = true; }
    const { DependencySnapshotRegistry } = await import("#veryfront/transforms/esm/dependency-snapshot-registry.ts");
    const { createDependencyPinningSnapshot, hashDependencyPins } = await import("#veryfront/transforms/esm/dependency-snapshot.ts");
    const registry = new DependencySnapshotRegistry();
    const snapshot = createDependencyPinningSnapshot("on:" + hashDependencyPins({}), {});
    await registry.remember("edge-local", snapshot);
    const localHistoryWorks = registry.peek("edge-local", snapshot.cacheKey) === snapshot;
    console.log(JSON.stringify({ canIdentifyProxyWithoutHooks, rejected, traps, localHistoryWorks }));
  `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../../", import.meta.url),
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    assertEquals(JSON.parse(new TextDecoder().decode(output.stdout)), {
      canIdentifyProxyWithoutHooks: false,
      rejected: true,
      traps: 0,
      localHistoryWorks: true,
    });
  });
});
