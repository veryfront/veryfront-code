import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DenoRedisAdapter } from "./deno.ts";

function createMockClient() {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  return {
    calls,
    client: {
      hset(key: string, fields: Record<string, string>) {
        calls.push({ method: "hset", args: [key, fields] });
        return Promise.resolve(Object.keys(fields).length);
      },
      hgetall(key: string) {
        calls.push({ method: "hgetall", args: [key] });
        return Promise.resolve(["field1", "value1", "field2", "value2"]);
      },
      hdel(key: string, ...fields: string[]) {
        calls.push({ method: "hdel", args: [key, ...fields] });
        return Promise.resolve(fields.length);
      },
      del(...keys: string[]) {
        calls.push({ method: "del", args: keys });
        return Promise.resolve(keys.length);
      },
      sadd(key: string, ...members: string[]) {
        calls.push({ method: "sadd", args: [key, ...members] });
        return Promise.resolve(members.length);
      },
      srem(key: string, ...members: string[]) {
        calls.push({ method: "srem", args: [key, ...members] });
        return Promise.resolve(members.length);
      },
      smembers(key: string) {
        calls.push({ method: "smembers", args: [key] });
        return Promise.resolve(["m1", "m2"]);
      },
      rpush(key: string, ...values: string[]) {
        calls.push({ method: "rpush", args: [key, ...values] });
        return Promise.resolve(values.length);
      },
      lrange(key: string, start: number, stop: number) {
        calls.push({ method: "lrange", args: [key, start, stop] });
        return Promise.resolve(["a", "b"]);
      },
      lindex(key: string, index: number) {
        calls.push({ method: "lindex", args: [key, index] });
        return Promise.resolve("item");
      },
      lset(key: string, index: number, value: string) {
        calls.push({ method: "lset", args: [key, index, value] });
        return Promise.resolve("OK" as const);
      },
      llen(key: string) {
        calls.push({ method: "llen", args: [key] });
        return Promise.resolve(5);
      },
      xadd(key: string, id: string, fields: Record<string, string>) {
        calls.push({ method: "xadd", args: [key, id, fields] });
        return Promise.resolve("1-0");
      },
      xgroupCreate(key: string, group: string, id: string, mkstream?: boolean) {
        calls.push({ method: "xgroupCreate", args: [key, group, id, mkstream] });
        return Promise.resolve("OK");
      },
      xreadgroup(
        streams: Array<{ key: string; xid: string }>,
        options: { group: string; consumer: string },
      ) {
        calls.push({ method: "xreadgroup", args: [streams, options] });
        return Promise.resolve([
          {
            key: "stream1",
            messages: [
              { id: "1-0", fieldValues: ["f1", "v1", "f2", "v2"] },
            ],
          },
        ]);
      },
      xack(key: string, group: string, ...ids: string[]) {
        calls.push({ method: "xack", args: [key, group, ...ids] });
        return Promise.resolve(ids.length);
      },
      keys(pattern: string) {
        calls.push({ method: "keys", args: [pattern] });
        return Promise.resolve(["k1", "k2"]);
      },
      exists(...keys: string[]) {
        calls.push({ method: "exists", args: keys });
        return Promise.resolve(1);
      },
      expire(key: string, seconds: number) {
        calls.push({ method: "expire", args: [key, seconds] });
        return Promise.resolve(1);
      },
      set(key: string, value: string, options?: unknown) {
        calls.push({ method: "set", args: [key, value, options] });
        return Promise.resolve("OK");
      },
      get(key: string) {
        calls.push({ method: "get", args: [key] });
        return Promise.resolve("value");
      },
      close() {
        calls.push({ method: "close", args: [] });
        return Promise.resolve();
      },
    },
  };
}

describe("platform/adapters/redis/deno", () => {
  describe("DenoRedisAdapter", () => {
    it("should proxy hset to client", async () => {
      const { client, calls } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      await adapter.hset("key", { f: "v" });
      assertEquals(calls[0].method, "hset");
    });

    it("should convert hgetall response to object", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.hgetall("key");
      assertEquals(result, { field1: "value1", field2: "value2" });
    });

    it("should proxy hdel to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.hdel("key", "f1", "f2");
      assertEquals(result, 2);
    });

    it("should proxy del to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.del("k1", "k2");
      assertEquals(result, 2);
    });

    it("should proxy sadd to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.sadd("set", "m1");
      assertEquals(result, 1);
    });

    it("should proxy smembers to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.smembers("set");
      assertEquals(result, ["m1", "m2"]);
    });

    it("should proxy rpush to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.rpush("list", "a", "b");
      assertEquals(result, 2);
    });

    it("should proxy lrange to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.lrange("list", 0, -1);
      assertEquals(result, ["a", "b"]);
    });

    it("should proxy lindex to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.lindex("list", 0);
      assertEquals(result, "item");
    });

    it("should proxy lset to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.lset("list", 0, "val");
      assertEquals(result, "OK");
    });

    it("should proxy llen to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.llen("list");
      assertEquals(result, 5);
    });

    it("should proxy xadd to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.xadd("stream", "*", { key: "val" });
      assertEquals(result, "1-0");
    });

    it("should proxy xgroupCreate to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.xgroupCreate("stream", "group", "0", true);
      assertEquals(result, "OK");
    });

    it("should convert xreadgroup response with arrayToObject", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.xreadgroup(
        [{ key: "stream1", xid: ">" }],
        { group: "g", consumer: "c" },
      );
      assertEquals(result.length, 1);
      assertEquals(result[0].key, "stream1");
      assertEquals(result[0].messages[0].data, { f1: "v1", f2: "v2" });
    });

    it("should return empty array for xreadgroup with empty streams", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.xreadgroup([], { group: "g", consumer: "c" });
      assertEquals(result, []);
    });

    it("should handle xreadgroup returning null", async () => {
      const { client } = createMockClient();
      client.xreadgroup = () => Promise.resolve(null);
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.xreadgroup(
        [{ key: "s", xid: ">" }],
        { group: "g", consumer: "c" },
      );
      assertEquals(result, []);
    });

    it("should proxy keys to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.keys("*");
      assertEquals(result, ["k1", "k2"]);
    });

    it("should proxy exists to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.exists("k1");
      assertEquals(result, 1);
    });

    it("should proxy expire to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.expire("key", 60);
      assertEquals(result, 1);
    });

    it("should proxy set to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.set("key", "val", { nx: true });
      assertEquals(result, "OK");
    });

    it("should proxy get to client", async () => {
      const { client } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      const result = await adapter.get("key");
      assertEquals(result, "value");
    });

    it("should call client.close on quit", async () => {
      const { client, calls } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      await adapter.quit();
      assertEquals(calls.some((c) => c.method === "close"), true);
    });

    it("should call client.close on disconnect", async () => {
      const { client, calls } = createMockClient();
      const adapter = new DenoRedisAdapter(client as any);
      await adapter.disconnect();
      assertEquals(calls.some((c) => c.method === "close"), true);
    });
  });
});
