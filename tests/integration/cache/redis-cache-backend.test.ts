import { assertEquals, assertNotEquals, assertRejects } from "#std/assert";
import { createClient } from "npm:redis@5.11.0";
import {
  buildRevisionedCacheKey,
  isRevisionedCacheBackend,
  registerOwnedDistributedCacheKeyPrefix,
} from "veryfront/extensions/distributed/cache-support";
import { RedisCacheBackend } from "../../../extensions/ext-redis/src/cache-backend.ts";
import { createRedisCacheAdministration } from "../../../extensions/ext-redis/src/cache-administration.ts";
import {
  createRedisClientManager,
  type RedisClient,
  type RedisClientManager,
} from "../../../extensions/ext-redis/src/redis-client-manager.ts";

const REDIS_URL = Deno.env.get("REDIS_CACHE_TEST_URL") ?? "redis://127.0.0.1:6379";

function frame(state: "p" | "a", revision: string, payload = ""): string {
  return `\0VFCAS1\0${state}\0${revision}\0${payload}`;
}

async function requireRedis7(client: ReturnType<typeof createClient>): Promise<void> {
  const serverInfo = await client.info("server");
  const major = Number(serverInfo.match(/(?:^|\r?\n)redis_version:(\d+)\./)?.[1]);
  assertEquals(major, 7, "release gate requires Redis major version 7");
}

function createSwitchableManager(initial: RedisClient): RedisClientManager & {
  use(client: RedisClient): void;
} {
  let current = initial;
  return {
    use(client) {
      current = client;
    },
    getClient: () => Promise.resolve(current),
    disconnect: () => Promise.resolve(),
    isConfigured: () => true,
  };
}

Deno.test(
  "two-independent-wrapper Redis 7 revisioned cache release gate preserves atomic history",
  async () => {
    const namespace = `vf:cache:integration:${crypto.randomUUID()}:`;
    const counterKey = `\0vf:cache:atomic:v1:counter:${namespace}`;
    const logicalKey = buildRevisionedCacheKey("shared-transform");
    const dataKey = `${namespace}${logicalKey}`;
    const firstManager = createRedisClientManager({ getEnv: () => undefined });
    const secondManager = createRedisClientManager({ getEnv: () => undefined });
    const first = new RedisCacheBackend(namespace, {
      clientManager: firstManager,
      clientOptions: { url: REDIS_URL },
    });
    const second = new RedisCacheBackend(namespace, {
      clientManager: secondManager,
      clientOptions: { url: REDIS_URL },
    });
    const control = createClient({ url: REDIS_URL });

    try {
      await control.connect();
      await requireRedis7(control);

      assertEquals(await first.initialize(), true);
      assertEquals(await second.initialize(), true);
      assertEquals(isRevisionedCacheBackend(first), true);
      assertEquals(isRevisionedCacheBackend(second), true);

      const absent = await first.getWithRevision!(logicalKey);
      assertEquals(absent.value, null);
      const deadline = Date.now() + 60_000;
      const outcomes = await Promise.all([
        first.compareExchange!(logicalKey, absent.revision, {
          kind: "set",
          value: "first-writer",
          expiresAtMs: deadline,
        }),
        second.compareExchange!(logicalKey, absent.revision, {
          kind: "set",
          value: "second-writer",
          expiresAtMs: deadline,
        }),
      ]);
      assertEquals(outcomes.toSorted(), [false, true]);

      const winner = await second.getWithRevision!(logicalKey);
      assertEquals(["first-writer", "second-writer"].includes(winner.value ?? ""), true);
      assertNotEquals(winner.revision, absent.revision);
      assertEquals(
        await first.compareExchange!(logicalKey, absent.revision, { kind: "delete" }),
        false,
      );

      assertEquals(
        await first.compareExchange!(logicalKey, winner.revision, {
          kind: "set",
          value: winner.value!,
          expiresAtMs: deadline,
        }),
        true,
      );
      const sameBytes = await second.getWithRevision!(logicalKey);
      assertNotEquals(sameBytes.revision, winner.revision);
      assertEquals(await control.pExpireTime(dataKey), deadline);
      assertEquals(
        await control.get(dataKey),
        `\0VFCAS1\0p\0${sameBytes.revision}\0${winner.value}`,
      );

      const beforeExpiringCounterData = await control.get(dataKey);
      const beforeExpiringCounterValue = await control.get(counterKey);
      assertEquals(await control.expire(counterKey, 60), 1);
      await assertRejects(() => first.getWithRevision!(logicalKey), Error);
      assertEquals(await control.get(dataKey), beforeExpiringCounterData);
      assertEquals(await control.get(counterKey), beforeExpiringCounterValue);
      const expiringCounterTtl = await control.pTTL(counterKey);
      assertEquals(expiringCounterTtl > 0 && expiringCounterTtl <= 60_000, true);
      assertEquals(await control.persist(counterKey), 1);
      assertEquals(await control.ttl(counterKey), -1);
      assertEquals(await first.initialize(), true);
      assertEquals(await second.initialize(), true);

      await control.del(dataKey);
      assertEquals(
        await second.compareExchange!(logicalKey, sameBytes.revision, { kind: "delete" }),
        false,
      );
      const afterRawDelete = await first.getWithRevision!(logicalKey);
      assertNotEquals(afterRawDelete.revision, sameBytes.revision);

      assertEquals(
        await first.compareExchange!(logicalKey, afterRawDelete.revision, {
          kind: "set",
          value: "already-expired",
          expiresAtMs: 1,
        }),
        true,
      );
      const expiredSet = await second.getWithRevision!(logicalKey);
      assertEquals(expiredSet.value, null);
      assertNotEquals(expiredSet.revision, afterRawDelete.revision);
      const tombstoneTtl = await control.pTTL(dataKey);
      assertEquals(tombstoneTtl >= 295_000 && tombstoneTtl <= 300_000, true);
      assertEquals(await control.ttl(counterKey), -1);

      assertEquals(
        await second.compareExchange!(logicalKey, expiredSet.revision, { kind: "delete" }),
        true,
      );
      const absentDelete = await second.getWithRevision!(logicalKey);
      assertEquals(absentDelete.value, null);
      assertNotEquals(absentDelete.revision, expiredSet.revision);

      await control.pExpire(dataKey, 1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const afterTombstoneExpiry = await second.getWithRevision!(logicalKey);
      assertNotEquals(afterTombstoneExpiry.revision, absentDelete.revision);

      const beforeMalformedCounter = await control.get(counterKey);
      await control.set(dataKey, "legacy-unframed", { PX: 60_000 });
      await assertRejects(() => first.getWithRevision!(logicalKey), Error);
      assertEquals(await control.get(counterKey), beforeMalformedCounter);
      assertEquals(await control.get(dataKey), "legacy-unframed");

      assertEquals(await first.initialize(), true);
      await control.del(dataKey);
      await control.rPush(dataKey, ["wrong-type"]);
      const beforeWrongTypeCounter = await control.get(counterKey);
      await assertRejects(() => first.getWithRevision!(logicalKey), Error);
      assertEquals(await control.get(counterKey), beforeWrongTypeCounter);
      assertEquals(await control.type(dataKey), "list");

      await control.del(dataKey);
      assertEquals(await first.initialize(), true);
      const validationSnapshot = await first.getWithRevision!(logicalKey);
      const stableData = await control.get(dataKey);
      const stableCounter = await control.get(counterKey);
      for (
        const invoke of [
          () => first.compareExchange!(logicalKey, "+1", { kind: "delete" }),
          () =>
            first.compareExchange!(logicalKey, validationSnapshot.revision, {
              kind: "set",
              value: "invalid",
              expiresAtMs: 0,
            }),
          () =>
            first.compareExchange!(logicalKey, validationSnapshot.revision, {
              kind: "set",
              value: "invalid",
              expiresAtMs: 1.5,
            }),
          () =>
            first.compareExchange!(logicalKey, validationSnapshot.revision, {
              kind: "set",
              value: "invalid",
              expiresAtMs: Number.MAX_SAFE_INTEGER + 1,
            }),
        ]
      ) {
        await assertRejects(invoke, Error);
        assertEquals(await control.get(counterKey), stableCounter);
        assertEquals(await control.get(dataKey), stableData);
        assertEquals(await first.initialize(), true);
      }

      for (
        const malformedCounter of [
          "+1",
          "-1",
          " 1",
          "1 ",
          "9223372036854775808",
        ]
      ) {
        await control.set(counterKey, malformedCounter);
        const unchangedData = await control.get(dataKey);
        await assertRejects(() => first.getWithRevision!(logicalKey), Error);
        assertEquals(await control.get(counterKey), malformedCounter);
        assertEquals(await control.get(dataKey), unchangedData);
        await control.set(counterKey, stableCounter!);
        assertEquals(await first.initialize(), true);
      }

      await control.del(counterKey);
      await control.rPush(counterKey, ["wrong-type"]);
      const beforeCounterWrongTypeData = await control.get(dataKey);
      await assertRejects(() => first.getWithRevision!(logicalKey), Error);
      assertEquals(await control.type(counterKey), "list");
      assertEquals(await control.get(dataKey), beforeCounterWrongTypeData);

      await control.del([counterKey, dataKey]);
      await control.set(counterKey, "9223372036854775806");
      assertEquals(await first.initialize(), true);
      const maximum = await first.getWithRevision!(logicalKey);
      assertEquals(maximum.revision, "9223372036854775807");
      assertEquals(await control.get(counterKey), "9223372036854775807");
      await control.del(dataKey);
      await assertRejects(() => first.getWithRevision!(logicalKey), Error);
      assertEquals(await control.get(counterKey), "9223372036854775807");
      assertEquals(await control.exists(dataKey), 0);

      await control.set(counterKey, "7");
      assertEquals(await second.initialize(), true);
      await control.del([counterKey, dataKey]);
      await assertRejects(() => second.getWithRevision!(logicalKey), Error);
      assertEquals(await control.exists(counterKey), 0);
      assertEquals(await control.exists(dataKey), 0);
    } finally {
      await Promise.allSettled([
        control.del([dataKey, counterKey]),
        firstManager.disconnect(),
        secondManager.disconnect(),
      ]);
      if (control.isOpen) await control.disconnect();
    }
  },
);

Deno.test(
  "Redis 7 final SET denial preserves the prior frame and skips only one counter revision",
  async () => {
    const namespace = `vf:cache:integration:set-failure:${crypto.randomUUID()}:`;
    const counterKey = `\0vf:cache:atomic:v1:counter:${namespace}`;
    const logicalKey = buildRevisionedCacheKey("set-failure");
    const dataKey = `${namespace}${logicalKey}`;
    const username = `vfcas_${crypto.randomUUID().replaceAll("-", "")}`;
    const password = crypto.randomUUID();
    const control = createClient({ url: REDIS_URL });
    const normal = createClient({ url: REDIS_URL });
    const restricted = createClient({ url: REDIS_URL, username, password });
    const manager = createSwitchableManager(normal as unknown as RedisClient);
    const backend = new RedisCacheBackend(namespace, { clientManager: manager });

    try {
      await Promise.all([control.connect(), normal.connect()]);
      await requireRedis7(control);
      assertEquals(await backend.initialize(), true);
      const absent = await backend.getWithRevision!(logicalKey);
      assertEquals(
        await backend.compareExchange!(logicalKey, absent.revision, {
          kind: "set",
          value: "prior-value",
          expiresAtMs: Date.now() + 60_000,
        }),
        true,
      );
      const prior = await backend.getWithRevision!(logicalKey);
      const priorFrame = await control.get(dataKey);
      const priorExpireAt = await control.pExpireTime(dataKey);
      const priorCounter = await control.get(counterKey);
      assertEquals(priorFrame, frame("p", prior.revision, "prior-value"));

      await control.sendCommand([
        "ACL",
        "SETUSER",
        username,
        "reset",
        "on",
        `>${password}`,
        `~${dataKey}`,
        `~?${counterKey.slice(1)}`,
        "+eval",
        "+get",
        "+ttl",
        "+incr",
        "+time",
        "-set",
      ]);
      await restricted.connect();
      manager.use(restricted as unknown as RedisClient);

      await assertRejects(
        () =>
          backend.compareExchange!(logicalKey, prior.revision, {
            kind: "set",
            value: "denied-value",
            expiresAtMs: Date.now() + 120_000,
          }),
        Error,
      );

      const afterFrame = await control.get(dataKey);
      assertEquals(afterFrame, priorFrame);
      assertEquals(afterFrame?.split("\0")[3], prior.revision);
      assertEquals(await control.pExpireTime(dataKey), priorExpireAt);
      assertEquals(
        await control.get(counterKey),
        (BigInt(priorCounter!) + 1n).toString(),
      );
    } finally {
      manager.use(normal as unknown as RedisClient);
      if (restricted.isOpen) {
        await Promise.allSettled([
          Promise.resolve().then(() => restricted.disconnect()),
        ]);
      }
      if (control.isOpen) {
        await Promise.allSettled([
          Promise.resolve().then(() => control.del([dataKey, counterKey])),
          Promise.resolve().then(() => control.sendCommand(["ACL", "DELUSER", username])),
        ]);
      }
      await Promise.allSettled([
        Promise.resolve().then(() => normal.isOpen ? normal.disconnect() : undefined),
        Promise.resolve().then(() => control.isOpen ? control.disconnect() : undefined),
      ]);
    }
  },
);

Deno.test(
  "Redis 7 administration and pattern deletion count live state at EVAL execution",
  async () => {
    const id = crypto.randomUUID();
    const namespace = `vf:cache:integration-admin-${crypto.randomUUID()}:`;
    registerOwnedDistributedCacheKeyPrefix(namespace);
    const counterKey = `\0vf:cache:atomic:v1:counter:${namespace}`;
    const ordinaryLogical = `${id}:ordinary`;
    const frameLookingOrdinaryLogical = `${id}:ordinary:vf:revisioned:v1:suffix`;
    const presentLogical = buildRevisionedCacheKey(`${id}:present`);
    const absentLogical = buildRevisionedCacheKey(`${id}:absent`);
    const physicalKeys = [
      `${namespace}${ordinaryLogical}`,
      `${namespace}${frameLookingOrdinaryLogical}`,
      `${namespace}${presentLogical}`,
      `${namespace}${absentLogical}`,
    ];
    const control = createClient({ url: REDIS_URL });
    const normal = createClient({ url: REDIS_URL });
    let beforeMatchingScanReturns: (() => Promise<void>) | undefined;
    const wrapped = new Proxy(normal, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === "scan") {
          return async (
            cursor: string,
            options?: { MATCH?: string; COUNT?: number },
          ) => {
            const page = await target.scan(cursor, options);
            if (page.keys.includes(physicalKeys[2]!) && beforeMatchingScanReturns) {
              const hook = beforeMatchingScanReturns;
              beforeMatchingScanReturns = undefined;
              await hook();
            }
            return page;
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as RedisClient;
    const manager = createSwitchableManager(wrapped);
    const backend = new RedisCacheBackend(namespace, { clientManager: manager });
    const administration = createRedisCacheAdministration(manager, {});
    const mutatorManager = createRedisClientManager({ getEnv: () => undefined });
    const mutator = new RedisCacheBackend(namespace, {
      clientManager: mutatorManager,
      clientOptions: { url: REDIS_URL },
    });

    async function createStates(): Promise<void> {
      await control.set(physicalKeys[0]!, "ordinary-value", { PX: 60_000 });
      await control.set(
        physicalKeys[1]!,
        frame("a", "7"),
        { PX: 60_000 },
      );
      const presentAbsent = await backend.getWithRevision!(presentLogical);
      assertEquals(
        await backend.compareExchange!(presentLogical, presentAbsent.revision, {
          kind: "set",
          value: "present-value",
          expiresAtMs: Date.now() + 60_000,
        }),
        true,
      );
      await backend.getWithRevision!(absentLogical);
    }

    async function createLivePresent(): Promise<void> {
      const absent = await backend.getWithRevision!(presentLogical);
      assertEquals(
        await backend.compareExchange!(presentLogical, absent.revision, {
          kind: "set",
          value: "present-value",
          expiresAtMs: Date.now() + 60_000,
        }),
        true,
      );
    }

    try {
      await Promise.all([control.connect(), normal.connect()]);
      await requireRedis7(control);
      assertEquals(await backend.initialize(), true);
      assertEquals(await mutator.initialize(), true);
      await createStates();

      const broadListing = await administration.listKeys({ prefix: namespace, limit: 1_000 });
      assertEquals(broadListing.keys.includes(physicalKeys[0]!), true);
      assertEquals(broadListing.keys.includes(physicalKeys[1]!), true);
      assertEquals(broadListing.keys.includes(physicalKeys[2]!), true);
      assertEquals(broadListing.keys.includes(physicalKeys[3]!), false);
      assertEquals(broadListing.keys.includes(counterKey), false);

      assertEquals(await administration.deleteKeys(physicalKeys), 3);
      assertEquals(await control.exists(physicalKeys), 0);

      await createLivePresent();
      assertEquals(
        await administration.listKeys({ prefix: physicalKeys[2]!, limit: 10 }),
        { keys: [physicalKeys[2]!], truncated: false },
      );
      const listedLive = await mutator.getWithRevision!(presentLogical);
      assertEquals(
        await mutator.compareExchange!(presentLogical, listedLive.revision, {
          kind: "delete",
        }),
        true,
      );
      assertEquals(await administration.deleteKeys([physicalKeys[2]!]), 0);
      assertEquals(await control.exists(physicalKeys[2]!), 0);

      await createLivePresent();
      beforeMatchingScanReturns = async () => {
        const scannedLive = await mutator.getWithRevision!(presentLogical);
        assertEquals(scannedLive.value, "present-value");
        assertEquals(
          await mutator.compareExchange!(presentLogical, scannedLive.revision, {
            kind: "delete",
          }),
          true,
        );
      };
      assertEquals(await backend.delByPattern(`*${id}:present*`), 0);
      assertEquals(beforeMatchingScanReturns, undefined);
      assertEquals(await control.exists(physicalKeys[2]!), 0);
    } finally {
      await Promise.allSettled([control.del(physicalKeys), control.del(counterKey)]);
      await mutatorManager.disconnect();
      if (normal.isOpen) await normal.disconnect();
      if (control.isOpen) await control.disconnect();
    }
  },
);
