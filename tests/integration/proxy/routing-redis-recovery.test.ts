import "#veryfront/schemas/_test-setup.ts";
import { createClient } from "npm:redis@5.11.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import { RedisRuntimeProviderName } from "#veryfront/extensions/distributed/redis-runtime-provider.ts";
import { clearModuleCache } from "#veryfront/platform/adapters/redis/modules.ts";
import { createRoutingRedisClient } from "#veryfront/extensions/distributed/routing-redis-client.ts";
import { startProxyRoutingInvalidationBus as startExtensionBus } from "../../../extensions/ext-redis/src/routing-invalidation-bus.ts";
import { createRedisRuntimeProvider } from "../../../extensions/ext-redis/src/redis-runtime-provider.ts";
import {
  type ProxyRoutingInvalidationBus,
  startProxyRoutingInvalidationBus,
} from "#veryfront/proxy/routing-invalidation-redis.ts";

const inputPath = Deno.env.get("PLATFORM_REDIS_PROOF_INPUT");
const statePath = Deno.env.get("PLATFORM_REDIS_PROOF_STATE");
const variant = Deno.env.get("PLATFORM_REDIS_PROOF_VARIANT") ?? "core";
const midPublish = Deno.env.get("PLATFORM_REDIS_PROOF_MID_PUBLISH") === "1";
const baseline = Deno.env.get("PLATFORM_REDIS_PROOF_BASELINE") === "1";
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
async function waitFor(predicate: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 30_000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Local Redis proof timed out: ${label}`);
    await delay();
  }
}
async function boundedOutcome(promise: Promise<unknown>, timeoutMs = 1_000) {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise.then(() => "resolved" as const, () => "rejected" as const),
      new Promise<"deadline">((resolve) => {
        timer = setTimeout(() => resolve("deadline"), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
async function marker(name: string, record: Record<string, unknown>) {
  await Deno.writeTextFile(
    `${statePath}/${name}.json`,
    JSON.stringify({
      scope: "isolated-proxy-redis-recovery",
      variant,
      cycle: 1,
      runtimeQualified: false,
      ...record,
    }),
    { mode: 0o600 },
  );
}
function event(eventId: string) {
  return {
    version: 1 as const,
    eventId,
    projectId: "project-1",
    projectSlug: "demo-project",
    deploymentId: "deployment-1",
    environmentId: "environment-1",
    environmentName: "production",
    releaseId: "release-1",
  };
}

it("proves the explicitly configured isolated Redis routing recovery contract", {
  ignore: !inputPath || !statePath,
}, async () => {
  assert(inputPath && statePath);
  assert(variant === "core" || variant === "extension");
  assert(!baseline || variant === "core");
  assert(!midPublish || (!baseline && variant === "core"));
  const input = JSON.parse(await Deno.readTextFile(inputPath));
  const url = new URL(input.url);
  assertEquals(url.protocol, "redis:");
  assertEquals(url.hostname, "127.0.0.1");
  assertEquals(Number(url.port), input.port);
  assert(url.username || url.password, "The isolated Redis proof requires authentication");
  let midAckUnsubscribes = 0;
  let offlineRawUnsubscribes = 0;
  const clients: Array<
    { client: ReturnType<typeof createClient>; reconnecting: number; ready: number }
  > = [];
  const provider = createRedisRuntimeProvider();
  const createObservedClient = (options: Parameters<typeof createClient>[0]) => {
    const client = createClient(options);
    if (midPublish) {
      const unsubscribe = client.unsubscribe.bind(client);
      Object.defineProperty(client, "unsubscribe", {
        value: (...args: Parameters<typeof client.unsubscribe>) => {
          if (!client.isReady) offlineRawUnsubscribes++;
          if (args[0] === "vf-proxy-routing-invalidations-v1:ack:mid-outage") midAckUnsubscribes++;
          return unsubscribe(...args);
        },
      });
    }
    const observed = { client, reconnecting: 0, ready: 0 };
    client.on("reconnecting", () => observed.reconnecting++);
    client.on("ready", () => observed.ready++);
    clients.push(observed);
    return client;
  };
  register(RedisRuntimeProviderName, {
    ...provider,
    loadModule: () => Promise.resolve({ createClient: createObservedClient }),
  });
  clearModuleCache();
  const seen = [new Set<string>(), new Set<string>()];
  const originalVerify = crypto.subtle.verify.bind(crypto.subtle);
  const verifyDescriptor = Object.getOwnPropertyDescriptor(crypto.subtle, "verify");
  let invalidSignatures = 0;
  Object.defineProperty(crypto.subtle, "verify", {
    configurable: true,
    value: async (...args: Parameters<SubtleCrypto["verify"]>) => {
      const valid = await originalVerify(...args);
      if (!valid) invalidSignatures++;
      return valid;
    },
  });
  const secret = crypto.randomUUID();
  let releaseMidHandlers: (() => void) | undefined;
  const midHandlers = new Promise<void>((resolve) => {
    releaseMidHandlers = resolve;
  });
  let midDeliveries = 0;
  let readyAfterRetirement = 0;
  let interruptedPublish: Promise<unknown> | undefined;
  let probe: ReturnType<typeof createClient> | undefined;
  const ackChannel = "vf-proxy-routing-invalidations-v1:ack:mid-outage";
  const buses: ProxyRoutingInvalidationBus[] = [];
  try {
    for (let replica = 0; replica < 2; replica++) {
      const startBus = variant === "extension"
        ? startExtensionBus
        : startProxyRoutingInvalidationBus;
      const bus = await startBus({
        ...(variant === "extension"
          ? { createClient: (url: string) => createRoutingRedisClient(createObservedClient, url) }
          : {}),
        redisUrl: input.url,
        integritySecret: secret,
        expectedReplicas: 2,
        replicaId: `replica-${replica}`,
        acknowledgementTimeoutMs: midPublish ? 5_000 : 1_000,
        onInvalidate: (value) => {
          seen[replica]!.add(value.eventId);
          if (midPublish && value.eventId === "mid-outage") {
            midDeliveries++;
            return midHandlers;
          }
        },
        logger: {
          info(message, extra) {
            if (
              message.includes("reconnected and resubscribed") && extra?.clientRole === "subscriber"
            ) readyAfterRetirement++;
          },
          warn() {},
          error() {},
        },
      });
      assert(bus);
      buses.push(bus);
    }
    const initial = await buses[0]!.publish(event("initial"));
    assertEquals(initial, { acknowledged: 2, converged: true, recipients: 2 });
    assertEquals(clients.length, 4);
    if (!baseline) {
      const outsider = createClient({ url: input.url, disableOfflineQueue: true });
      outsider.on("error", () => {});
      try {
        await outsider.connect();
        const payload = JSON.stringify(event("wrong-signature"));
        const issuedAtMs = Date.now();
        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(crypto.randomUUID()),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
        const signature = new Uint8Array(
          await crypto.subtle.sign(
            "HMAC",
            key,
            new TextEncoder().encode(
              `vf-proxy-routing-invalidation:event:v1\0${issuedAtMs}\0${payload}`,
            ),
          ),
        );
        const encoded = btoa(String.fromCharCode(...signature)).replace(/\+/g, "-").replace(
          /\//g,
          "_",
        ).replace(/=+$/, "");
        await outsider.publish(
          "vf-proxy-routing-invalidations-v1",
          JSON.stringify({ version: 1, issuedAtMs, payload, signature: encoded }),
        );
        await waitFor(() => invalidSignatures >= 2, "real HMAC rejection");
        await outsider.publish(
          "vf-proxy-routing-invalidations-v1",
          JSON.stringify(event("unsigned")),
        );
        assertEquals(await buses[0]!.publish(event("signature-fence")), {
          acknowledged: 2,
          converged: true,
          recipients: 2,
        });
        assert(
          seen.every((replica) => !replica.has("wrong-signature") && !replica.has("unsigned")),
        );
      } finally {
        if (outsider.isOpen) outsider.destroy();
      }
    }

    if (midPublish) {
      probe = createClient({ url: input.url, disableOfflineQueue: true });
      probe.on("error", () => {});
      await probe.connect();
      interruptedPublish = buses[0]!.publish(event("mid-outage"));
      // Observe the rejection immediately; the assertion follows after disconnect.
      void interruptedPublish.catch(() => {});
      await waitFor(() => midDeliveries === 2, "mid-publish handlers reached");
      assertEquals<unknown>(await probe.sendCommand(["PUBSUB", "NUMSUB", ackChannel]), [
        ackChannel,
        1,
      ]);
    }
    await marker("ready", {
      baseline,
      clientsReady: 4,
      initialAcknowledgements: 2,
      midPublish,
      acknowledgementSubscriptionObserved: midPublish,
    });
    if (midPublish) {
      await waitFor(() => clients.every((c) => !c.client.isReady), "actual mid-publish disconnect");
      assertEquals(await boundedOutcome(interruptedPublish!, 10_000), "rejected");
      assertEquals(midAckUnsubscribes, 0);
      assertEquals(offlineRawUnsubscribes, 0);
      releaseMidHandlers!();
      await marker("logical-retirement", {
        pendingPublishRejected: true,
        noOfflineRawUnsubscribeClaimed: true,
      });
    }
    await waitFor(
      () =>
        baseline
          ? clients.every(({ client, ready }) => ready > 0 && !client.isOpen)
          : clients.every(({ reconnecting }) => reconnecting >= 7),
      "observed reconnect boundary",
    );
    if (!baseline) {
      assertEquals(
        await boundedOutcome(buses[0]!.publish(event(midPublish ? "mid-outage" : "offline"))),
        "rejected",
      );
    }
    await marker("outage-observed", {
      baseline,
      reconnecting: clients.map((c) => c.reconnecting),
      terminalClients: clients.filter((c) => !c.client.isOpen).length,
      offlinePublishRejected: !baseline,
    });
    await waitFor(async () => {
      try {
        const record = JSON.parse(await Deno.readTextFile(`${statePath}/restarted.json`));
        return record.variant === variant && record.cycle === 1;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
      }
    }, "supervisor restart acknowledgement");
    if (baseline) {
      const outcome = await boundedOutcome(
        buses[0]!.publish(event(midPublish ? "mid-outage" : "offline")),
      );
      assert(outcome !== "resolved");
      await marker("baseline-failure", {
        observedPermanentDisconnect: true,
        postRestartPublishOutcome: outcome,
        postRestartPublishConverged: false,
        proofQualified: false,
      });
    } else {
      await waitFor(
        () => clients.every((c) => c.client.isReady && c.ready >= 2),
        "client resubscription readiness",
      );
      if (midPublish) {
        await waitFor(
          () => readyAfterRetirement >= 2 && !!probe?.isReady,
          "retirement-confirmed facade readiness",
        );
        assertEquals<unknown>(await probe!.sendCommand(["PUBSUB", "NUMSUB", ackChannel]), [
          ackChannel,
          0,
        ]);
        await marker("retirement-drained", {
          oldAcknowledgementSubscribers: 0,
          rawAcknowledgementRetirements: midAckUnsubscribes,
          offlineRawUnsubscribes,
          subscriberFacadesReady: 2,
        });
      }
      assertEquals(await buses[0]!.publish(event(midPublish ? "mid-outage" : "offline")), {
        acknowledged: 2,
        converged: true,
        recipients: 2,
      });
      assert(seen.every((replica) => replica.has(midPublish ? "mid-outage" : "offline")));
      await marker("recovered", { clientsRecovered: 4, postRestartAcknowledgements: 2 });
    }
    if (!baseline) {
      const allClosed = await boundedOutcome(Promise.allSettled(buses.map((bus) => bus.close())));
      assertEquals(allClosed, "resolved");
      assert(clients.every((c) => !c.client.isOpen));
      assertEquals(await boundedOutcome(buses[0]!.publish(event("closed"))), "rejected");
      const invalidAuthUrl = new URL(input.url);
      invalidAuthUrl.password = crypto.randomUUID();
      const startupClients: ReturnType<typeof createClient>[] = [];
      const startup = startExtensionBus({
        redisUrl: invalidAuthUrl.toString(),
        integritySecret: secret,
        replicaId: "startup-refusal",
        onInvalidate() {},
        createClient: (url: string) =>
          createRoutingRedisClient((options) => {
            const client = createClient(options);
            startupClients.push(client);
            return client;
          }, url),
        logger: { info() {}, warn() {}, error() {} },
      });
      assertEquals(await boundedOutcome(startup, 15_000), "rejected");
      assert(startupClients.every((client) => !client.isOpen));
      await marker("completed", {
        signedConvergenceVerified: true,
        midPublishRetirementVerified: midPublish,
        oldAcknowledgementSubscriptionRemoved: midPublish,
        offlineRawUnsubscribePrevented: offlineRawUnsubscribes === 0,
        wrongHmacRejected: true,
        unsignedEventRejected: true,
        initialStartupFailureFinite: true,
        offlinePublishRejected: true,
        allOwnedClientsClosed: true,
        latePublishRejected: true,
        proofQualified: false,
      });
    }
  } finally {
    releaseMidHandlers!();
    if (probe?.isOpen) probe.destroy();
    await boundedOutcome(Promise.allSettled(buses.map((bus) => bus.close())));
    for (const { client } of clients) if (client.isOpen) client.destroy();
    if (verifyDescriptor) Object.defineProperty(crypto.subtle, "verify", verifyDescriptor);
    else Reflect.deleteProperty(crypto.subtle, "verify");
    unregister(RedisRuntimeProviderName);
    clearModuleCache();
    await provider.close();
  }
});
