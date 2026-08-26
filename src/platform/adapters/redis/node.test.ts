import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NodeRedisAdapter } from "./node.ts";

interface ClientCall {
  readonly method: string;
  readonly args: unknown[];
}

function createMockClient() {
  const calls: ClientCall[] = [];

  const client = {
    calls,
    hSet(key: string, fields: Record<string, string>) {
      calls.push({ method: "hSet", args: [key, fields] });
      return Promise.resolve(Object.keys(fields).length);
    },
    hGetAll(key: string) {
      calls.push({ method: "hGetAll", args: [key] });
      return Promise.resolve({ field1: "value1", field2: "value2" });
    },
    hDel(key: string, fields: string[]) {
      calls.push({ method: "hDel", args: [key, fields] });
      return Promise.resolve(fields.length);
    },
    del(keys: string[]) {
      calls.push({ method: "del", args: [keys] });
      return Promise.resolve(keys.length);
    },
    sAdd(key: string, members: string[]) {
      calls.push({ method: "sAdd", args: [key, members] });
      return Promise.resolve(members.length);
    },
    sRem(key: string, members: string[]) {
      calls.push({ method: "sRem", args: [key, members] });
      return Promise.resolve(members.length);
    },
    sMembers(key: string) {
      calls.push({ method: "sMembers", args: [key] });
      return Promise.resolve(["m1", "m2"]);
    },
    rPush(key: string, values: string[]) {
      calls.push({ method: "rPush", args: [key, values] });
      return Promise.resolve(values.length);
    },
    lRange(key: string, start: number, stop: number) {
      calls.push({ method: "lRange", args: [key, start, stop] });
      return Promise.resolve(["a", "b"]);
    },
    lIndex(key: string, index: number) {
      calls.push({ method: "lIndex", args: [key, index] });
      return Promise.resolve("item");
    },
    lSet(key: string, index: number, value: string) {
      calls.push({ method: "lSet", args: [key, index, value] });
      return Promise.resolve("OK" as const);
    },
    lLen(key: string) {
      calls.push({ method: "lLen", args: [key] });
      return Promise.resolve(5);
    },
    xAdd(key: string, id: string, fields: Record<string, string>) {
      calls.push({ method: "xAdd", args: [key, id, fields] });
      return Promise.resolve("1-0");
    },
    xAck(key: string, group: string, ids: string[]) {
      calls.push({ method: "xAck", args: [key, group, ids] });
      return Promise.resolve(ids.length);
    },
    xGroupCreate(key: string, group: string, id: string, options?: { MKSTREAM?: boolean }) {
      calls.push({ method: "xGroupCreate", args: [key, group, id, options] });
      return Promise.resolve("OK");
    },
    xReadGroup(
      group: string,
      consumer: string,
      streams: Array<{ key: string; id: string }>,
      options?: { BLOCK?: number; COUNT?: number },
    ): Promise<
      | Array<{ name: string; messages: Array<{ id: string; message: Record<string, string> }> }>
      | null
    > {
      calls.push({ method: "xReadGroup", args: [group, consumer, streams, options] });
      return Promise.resolve([
        {
          name: "stream1",
          messages: [{ id: "1-0", message: { f1: "v1", f2: "v2" } }],
        },
      ]);
    },
    xRead(
      streams: Array<{ key: string; id: string }>,
      options?: { BLOCK?: number; COUNT?: number },
    ): Promise<
      | Array<{ name: string; messages: Array<{ id: string; message: Record<string, string> }> }>
      | null
    > {
      calls.push({ method: "xRead", args: [streams, options] });
      return Promise.resolve([
        {
          name: "stream1",
          messages: [{ id: "2-0", message: { revision: "2", status: "running" } }],
        },
      ]);
    },
    set(key: string, value: string, options?: { NX?: true; PX?: number; EX?: number }) {
      calls.push({ method: "set", args: [key, value, options] });
      return Promise.resolve("OK");
    },
    get(key: string) {
      calls.push({ method: "get", args: [key] });
      return Promise.resolve("value");
    },
    keys(pattern: string) {
      calls.push({ method: "keys", args: [pattern] });
      return Promise.resolve(["k1", "k2"]);
    },
    scan(cursor: number, options?: { MATCH?: string; COUNT?: number }) {
      calls.push({ method: "scan", args: [cursor, options] });
      return Promise.resolve({ cursor: 0, keys: ["k1", "k2"] });
    },
    exists(keys: string[]) {
      calls.push({ method: "exists", args: [keys] });
      return Promise.resolve(1);
    },
    expire(key: string, seconds: number) {
      calls.push({ method: "expire", args: [key, seconds] });
      return Promise.resolve(1);
    },
    eval(script: string, options?: { keys?: string[]; arguments?: string[] }) {
      calls.push({ method: "eval", args: [script, options] });
      return Promise.resolve("eval-result");
    },
    close() {
      calls.push({ method: "close", args: [] });
      return Promise.resolve();
    },
    destroy() {
      calls.push({ method: "destroy", args: [] });
      return Promise.resolve();
    },
  };

  return { client, calls };
}

function firstCall(calls: readonly ClientCall[]): ClientCall {
  const call = calls[0];
  assertExists(call, "expected the Redis client mock to capture a call");
  return call;
}

describe("platform/adapters/redis/node", () => {
  describe("NodeRedisAdapter", () => {
    it("should proxy hset to the camelCase client method (hSet)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      await adapter.hset("key", { f: "v" });
      const call = firstCall(calls);
      assertEquals(call.method, "hSet");
      assertEquals(call.args, ["key", { f: "v" }]);
    });

    it("should return the hgetall object as-is", async () => {
      const { client } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      const result = await adapter.hgetall("key");
      assertEquals(result, { field1: "value1", field2: "value2" });
    });

    it("should pass del keys as an array (not spread)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      const result = await adapter.del("k1", "k2");
      assertEquals(result, 2);
      assertEquals(firstCall(calls).args, [["k1", "k2"]]);
    });

    it("should map mkstream to the MKSTREAM option on xgroupCreate", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      await adapter.xgroupCreate("stream", "group", "0", true);
      assertEquals(firstCall(calls).args[3], { MKSTREAM: true });
    });

    it("should reshape xreadgroup streams and responses (name->key, message->data)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      const result = await adapter.xreadgroup(
        [{ key: "stream1", xid: ">" }],
        { group: "g", consumer: "c", block: 100, count: 5 },
      );
      // request shape: xid -> id, group/consumer/BLOCK/COUNT forwarded
      const call = firstCall(calls);
      assertEquals(call.args[0], "g");
      assertEquals(call.args[1], "c");
      assertEquals(call.args[2], [{ key: "stream1", id: ">" }]);
      assertEquals(call.args[3], { BLOCK: 100, COUNT: 5 });
      // response shape: name -> key, message -> data
      assertEquals(result.length, 1);
      const stream = result[0];
      assertExists(stream);
      const message = stream.messages[0];
      assertExists(message);
      assertEquals(stream.key, "stream1");
      assertEquals(message.data, { f1: "v1", f2: "v2" });
    });

    it("should return an empty array when xreadgroup yields null", async () => {
      const { client } = createMockClient();
      client.xReadGroup = () => Promise.resolve(null);
      const adapter = new NodeRedisAdapter(client as never);
      const result = await adapter.xreadgroup(
        [{ key: "s", xid: ">" }],
        { group: "g", consumer: "c" },
      );
      assertEquals(result, []);
    });

    it("should reshape xread streams and responses without a consumer group", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      const result = await adapter.xread(
        [{ key: "stream1", xid: "1-0" }],
        { block: 25, count: 8 },
      );

      const call = firstCall(calls);
      assertEquals(call.method, "xRead");
      assertEquals(call.args, [
        [{ key: "stream1", id: "1-0" }],
        { BLOCK: 25, COUNT: 8 },
      ]);
      assertEquals(result, [{
        key: "stream1",
        messages: [{ id: "2-0", data: { revision: "2", status: "running" } }],
      }]);
    });

    it("should return an empty array when xread yields null", async () => {
      const { client } = createMockClient();
      client.xRead = () => Promise.resolve(null);
      const adapter = new NodeRedisAdapter(client as never);
      assertEquals(await adapter.xread([{ key: "s", xid: "0-0" }]), []);
    });

    it("should map lowercase set options (nx/px/ex) to redis NX/PX/EX", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      await adapter.set("key", "val", { nx: true, px: 1000, ex: 60 });
      assertEquals(firstCall(calls).args[2], { NX: true, PX: 1000, EX: 60 });
    });

    it("should leave NX undefined when nx is falsy", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      await adapter.set("key", "val");
      assertEquals(firstCall(calls).args[2], { NX: undefined, PX: undefined, EX: undefined });
    });

    it("should call client.close on quit (v5 rename)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      await adapter.quit();
      assertEquals(calls.some((c) => c.method === "close"), true);
    });

    it("should call client.destroy on disconnect (v5 rename)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      await adapter.disconnect();
      assertEquals(calls.some((c) => c.method === "destroy"), true);
    });

    it("normalizes synchronous destroy failures into promise rejections", async () => {
      const { client } = createMockClient();
      client.destroy = () => {
        throw new Error("destroy failed");
      };
      const adapter = new NodeRedisAdapter(client as never);

      const pending = adapter.disconnect();
      await assertRejects(() => pending, Error, "destroy failed");
    });

    it("should forward hdel fields as an array (hDel)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      const result = await adapter.hdel("key", "f1", "f2");
      assertEquals(result, 2);
      assertEquals(firstCall(calls).args, ["key", ["f1", "f2"]]);
    });

    it("should forward sadd members as an array (sAdd)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      const result = await adapter.sadd("set", "m1", "m2");
      assertEquals(result, 2);
      assertEquals(firstCall(calls).args, ["set", ["m1", "m2"]]);
    });

    it("should forward srem members as an array (sRem)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      const result = await adapter.srem("set", "m1");
      assertEquals(result, 1);
      assertEquals(firstCall(calls).args, ["set", ["m1"]]);
    });

    it("should proxy smembers (sMembers)", async () => {
      const { client } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      assertEquals(await adapter.smembers("set"), ["m1", "m2"]);
    });

    it("should forward rpush values as an array (rPush)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      const result = await adapter.rpush("list", "a", "b");
      assertEquals(result, 2);
      assertEquals(firstCall(calls).args, ["list", ["a", "b"]]);
    });

    it("should proxy lrange (lRange)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      assertEquals(await adapter.lrange("list", 2, 5), ["a", "b"]);
      assertEquals(
        firstCall(calls).args,
        ["list", 2, 5],
        "lrange must forward start/stop to lRange",
      );
    });

    it("should proxy lindex (lIndex)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      assertEquals(await adapter.lindex("list", 3), "item");
      assertEquals(firstCall(calls).args, ["list", 3], "lindex must forward the index to lIndex");
    });

    it("should proxy lset (lSet)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      assertEquals(await adapter.lset("list", 4, "v"), "OK");
      assertEquals(
        firstCall(calls).args,
        ["list", 4, "v"],
        "lset must forward the index and value to lSet",
      );
    });

    it("should proxy llen (lLen)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      assertEquals(await adapter.llen("list"), 5);
      assertEquals(firstCall(calls).args, ["list"], "llen must forward the key to lLen");
    });

    it("should proxy xadd (xAdd)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      assertEquals(await adapter.xadd("stream", "*", { k: "v" }), "1-0");
      assertEquals(
        firstCall(calls).args,
        ["stream", "*", { k: "v" }],
        "xadd must forward the entry id and fields to xAdd",
      );
    });

    it("should forward xack ids as an array (xAck)", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      const result = await adapter.xack("stream", "group", "1-0", "1-1");
      assertEquals(result, 2);
      assertEquals(firstCall(calls).args, ["stream", "group", ["1-0", "1-1"]]);
    });

    it("should proxy keys", async () => {
      const { client } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      assertEquals(await adapter.keys("*"), ["k1", "k2"]);
    });

    it("should proxy scan options", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      assertEquals(await adapter.scan(7, { MATCH: "prefix:*", COUNT: 100 }), {
        cursor: 0,
        keys: ["k1", "k2"],
      });
      assertEquals(firstCall(calls).args, [7, { MATCH: "prefix:*", COUNT: 100 }]);
    });

    it("should forward exists keys as an array", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      const result = await adapter.exists("k1", "k2");
      assertEquals(result, 1);
      assertEquals(firstCall(calls).args, [["k1", "k2"]]);
    });

    it("should proxy expire", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      assertEquals(await adapter.expire("key", 60), 1);
      assertEquals(firstCall(calls).args, ["key", 60], "expire must forward the ttl in seconds");
    });

    it("should proxy get", async () => {
      const { client } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      assertEquals(await adapter.get("key"), "value");
    });

    it("should map eval keys/args into the redis options object", async () => {
      const { client, calls } = createMockClient();
      const adapter = new NodeRedisAdapter(client as never);
      await adapter.eval("return 1", ["k1"], ["a1"]);
      assertEquals(firstCall(calls).args, ["return 1", { keys: ["k1"], arguments: ["a1"] }]);
    });
  });
});
