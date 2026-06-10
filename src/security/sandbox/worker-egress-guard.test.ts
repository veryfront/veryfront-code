import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertWorkerEgressAllowed,
  assertWorkerHostEgressAllowed,
  isInternalEgressIp,
  isInternalEgressOverrideEnabled,
  WORKER_INTERNAL_EGRESS_OVERRIDE_ENV,
  WorkerEgressBlockedError,
} from "./worker-egress-guard.ts";

describe("worker-egress-guard", () => {
  it("identifies loopback, metadata, private, and link-local addresses", () => {
    assertEquals(isInternalEgressIp("127.0.0.1"), true);
    assertEquals(isInternalEgressIp("169.254.169.254"), true);
    assertEquals(isInternalEgressIp("169.254.1.2"), true);
    assertEquals(isInternalEgressIp("10.1.2.3"), true);
    assertEquals(isInternalEgressIp("172.16.0.1"), true);
    assertEquals(isInternalEgressIp("172.31.255.255"), true);
    assertEquals(isInternalEgressIp("192.168.1.10"), true);
    assertEquals(isInternalEgressIp("::1"), true);
    assertEquals(isInternalEgressIp("fe80::1"), true);
    assertEquals(isInternalEgressIp("fd00::1"), true);
    assertEquals(isInternalEgressIp("93.184.216.34"), false);
    assertEquals(isInternalEgressIp("2606:2800:220:1:248:1893:25c8:1946"), false);
  });

  it("blocks direct metadata, private, link-local, and localhost targets", async () => {
    await assertRejects(
      () => assertWorkerEgressAllowed("http://169.254.169.254/latest/meta-data/"),
      WorkerEgressBlockedError,
      "Worker network egress blocked",
    );
    await assertRejects(
      () => assertWorkerEgressAllowed("http://10.0.0.5/private"),
      WorkerEgressBlockedError,
      "Worker network egress blocked",
    );
    await assertRejects(
      () => assertWorkerEgressAllowed("http://[fe80::1]/"),
      WorkerEgressBlockedError,
      "Worker network egress blocked",
    );
    await assertRejects(
      () => assertWorkerEgressAllowed("http://localhost/internal"),
      WorkerEgressBlockedError,
      "Worker network egress blocked",
    );
  });

  it("allows public direct IP targets", async () => {
    await assertWorkerEgressAllowed("https://93.184.216.34/");
    await assertWorkerEgressAllowed("https://[2606:2800:220:1:248:1893:25c8:1946]/");
  });

  it("blocks hostnames that resolve to private addresses", async () => {
    await assertRejects(
      () =>
        assertWorkerHostEgressAllowed("tenant.example", {
          resolveHost: () => Promise.resolve(["10.1.2.3"]),
        }),
      WorkerEgressBlockedError,
      "resolved to internal address",
    );
  });

  it("allows hostnames that resolve only to public addresses", async () => {
    await assertWorkerHostEgressAllowed("api.example.com", {
      resolveHost: () => Promise.resolve(["93.184.216.34"]),
    });
  });

  it("requires hostname resolution by default", async () => {
    await assertRejects(
      () =>
        assertWorkerHostEgressAllowed("api.example.com", {
          resolveHost: () => Promise.resolve([]),
        }),
      WorkerEgressBlockedError,
      "unable to resolve host",
    );
  });

  it("allows internal targets only when the self-hosted override is enabled", async () => {
    await assertWorkerEgressAllowed("http://127.0.0.1:3000/internal", {
      allowInternalEgress: true,
      resolveHost: () => Promise.resolve(["127.0.0.1"]),
    });
  });

  it("parses the explicit internal egress override env value", () => {
    assertEquals(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, "VERYFRONT_WORKER_ALLOW_INTERNAL_EGRESS");
    assertEquals(isInternalEgressOverrideEnabled("1"), true);
    assertEquals(isInternalEgressOverrideEnabled("true"), true);
    assertEquals(isInternalEgressOverrideEnabled("yes"), true);
    assertEquals(isInternalEgressOverrideEnabled("on"), true);
    assertEquals(isInternalEgressOverrideEnabled("0"), false);
    assertEquals(isInternalEgressOverrideEnabled(undefined), false);
  });
});
