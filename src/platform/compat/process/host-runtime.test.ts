import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getEnv } from "./env.ts";
import {
  createInMemoryHostRuntime,
  HostExit,
  type HostRuntime,
  IN_MEMORY_HOST_CWD,
  isHostExit,
  liveHostRuntime,
} from "./host-runtime.ts";

describe("platform/compat/process/host-runtime", () => {
  describe("createInMemoryHostRuntime", () => {
    it("starts from the given env, cwd, and args", () => {
      const host = createInMemoryHostRuntime({
        env: { PORT: "3001" },
        cwd: "/work/app",
        args: ["dev", "--open"],
      });

      assertEquals(host.env.get("PORT"), "3001", "seeded env key is readable");
      assertEquals(host.env.has("PORT"), true, "seeded env key reports present");
      assertEquals(host.env.toObject(), { PORT: "3001" }, "toObject returns only seeded keys");
      assertEquals(host.cwd(), "/work/app", "cwd is the seeded directory");
      assertEquals(host.args(), ["dev", "--open"], "args are the seeded argv");
    });

    it("defaults to an empty env, a fixed cwd, and no args", () => {
      const host = createInMemoryHostRuntime();

      assertEquals(host.env.toObject(), {}, "env starts empty");
      assertEquals(host.env.get("HOME"), undefined, "no key leaks in from the real process");
      assertEquals(host.cwd(), IN_MEMORY_HOST_CWD, "cwd is the documented default");
      assertEquals(host.args(), [], "args start empty");
      assertEquals(host.exits, [], "no exit has been recorded");
    });

    it("keeps env writes isolated between instances", () => {
      const first = createInMemoryHostRuntime({ env: { SHARED: "first" } });
      const second = createInMemoryHostRuntime({ env: { SHARED: "second" } });

      first.env.set("ONLY_FIRST", "1");
      second.env.delete("SHARED");

      assertEquals(first.env.get("SHARED"), "first", "first keeps its own value");
      assertEquals(first.env.has("ONLY_FIRST"), true, "first sees its own write");
      assertEquals(second.env.has("ONLY_FIRST"), false, "second never sees first's write");
      assertEquals(second.env.has("SHARED"), false, "second's delete is local to second");
    });

    it("does not let a seed object or a returned snapshot alias the env", () => {
      const seed: Record<string, string> = { A: "1" };
      const host = createInMemoryHostRuntime({ env: seed });

      seed.B = "2";
      const snapshot = host.env.toObject();
      snapshot.C = "3";

      assertEquals(host.env.has("B"), false, "later seed mutation is not observed");
      assertEquals(host.env.has("C"), false, "snapshot mutation is not observed");
    });

    it("records exits and throws a recognisable host exit instead of terminating", () => {
      const host = createInMemoryHostRuntime();

      const error = assertThrows(() => host.exit(2), HostExit, "code 2");

      assert(isHostExit(error), "exit throws a HostExit");
      assertEquals(error.code, 2, "the thrown exit carries its code");
      assertEquals(host.exits, [2], "the exit is recorded");

      const defaultExit = assertThrows(() => host.exit(), HostExit, "code 0");

      assert(isHostExit(defaultExit), "a bare exit also throws a HostExit");
      assertEquals(defaultExit.code, 0, "exit defaults to code 0");
      assertEquals(host.exits, [2, 0], "every exit is recorded in order");
    });

    it("delivers emitted signals to subscribers until they unsubscribe", () => {
      const host = createInMemoryHostRuntime();
      const seen: string[] = [];
      const stopInt = host.onSignal("SIGINT", () => seen.push("int"));
      host.onSignal("SIGTERM", () => seen.push("term"));

      assertEquals(host.emitSignal("SIGINT"), 1, "one SIGINT handler ran");
      assertEquals(host.emitSignal("SIGTERM"), 1, "one SIGTERM handler ran");
      assertEquals(seen, ["int", "term"], "each signal reached only its own subscriber");

      stopInt();
      stopInt();

      assertEquals(host.emitSignal("SIGINT"), 0, "an unsubscribed handler no longer runs");
      assertEquals(host.emitSignal("SIGTERM"), 1, "other subscriptions are unaffected");
      assertEquals(seen, ["int", "term", "term"], "unsubscribe is idempotent and local");
    });

    it("runs subscribers in subscription order and tolerates unsubscribe during emit", () => {
      const host = createInMemoryHostRuntime();
      const order: number[] = [];
      const stopSecond = host.onSignal("SIGTERM", () => order.push(2));
      host.onSignal("SIGTERM", () => {
        order.push(1);
        stopSecond();
      });

      assertEquals(host.emitSignal("SIGTERM"), 2, "both handlers ran this emit");
      assertEquals(order, [2, 1], "handlers ran in subscription order");
      assertEquals(host.emitSignal("SIGTERM"), 1, "the handler removed mid-emit is gone");
    });
  });

  describe("liveHostRuntime", () => {
    it("is a single shared instance", () => {
      assert(liveHostRuntime() === liveHostRuntime(), "the live host is a singleton");
    });

    it("reads and writes the same environment as getEnv", () => {
      const host: HostRuntime = liveHostRuntime();
      const key = "VERYFRONT_HOST_RUNTIME_CONTRACT_TEST";

      assertEquals(host.env.get(key), getEnv(key), "an unset key agrees before any write");
      host.env.set(key, "live");

      assertEquals(getEnv(key), "live", "a host write is visible through getEnv");
      assertEquals(host.env.get(key), "live", "a host write is visible through the host");
      assertEquals(host.env.has(key), true, "has tracks the written key");
      assertEquals(host.env.toObject()[key], "live", "toObject includes the written key");

      host.env.delete(key);

      assertEquals(getEnv(key), undefined, "a host delete is visible through getEnv");
      assertEquals(host.env.has(key), false, "has tracks the deleted key");
    });

    it("reports a real working directory and argv", () => {
      const host = liveHostRuntime();

      assert(host.cwd().length > 0, "cwd is non-empty");
      assert(Array.isArray(host.args()), "args is an array");
    });
  });
});
