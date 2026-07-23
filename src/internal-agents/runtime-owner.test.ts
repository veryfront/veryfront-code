import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveRuntimeOwnerInvokeUrl } from "./runtime-owner.ts";

function createDynamicImportStub(
  module: {
    networkInterfaces: () => Record<
      string,
      Array<{ address?: string; family?: string; internal?: boolean }> | undefined
    >;
  },
): <T = unknown>(specifier: string) => Promise<T> {
  return async <T>(_specifier: string) => module as T;
}

describe("internal-agents/runtime-owner", () => {
  it("prefers explicit pod env overrides for the runtime owner url", async () => {
    const request = new Request(
      "https://demo-project.preview.veryfront.org/api/control-plane/runs/run_1/stream",
    );

    const ownerUrl = await resolveRuntimeOwnerInvokeUrl(request, {
      getHostEnv: (key) => {
        if (key === "POD_IP") return "10.0.0.7";
        if (key === "VERYFRONT_RUNTIME_OWNER_PORT") return "20000";
        return undefined;
      },
      getDenoNetworkInterfaces: () => [],
      dynamicImport: createDynamicImportStub({
        networkInterfaces: () => ({}),
      }),
    });

    assertEquals(ownerUrl, "http://10.0.0.7:20000/channels/invoke");
  });

  it("falls back to detected runtime interfaces when no explicit pod host is configured", async () => {
    const request = new Request(
      "https://demo-project.preview.veryfront.org/api/control-plane/runs/run_1/stream",
    );

    const ownerUrl = await resolveRuntimeOwnerInvokeUrl(request, {
      getHostEnv: (key) => {
        if (key === "PROXY_MODE") return "1";
        return undefined;
      },
      getDenoNetworkInterfaces: () => [
        { address: "127.0.0.1", family: "IPv4", internal: true },
        { address: "10.0.0.9", family: "IPv4", internal: false },
      ],
      dynamicImport: createDynamicImportStub({
        networkInterfaces: () => ({}),
      }),
    });

    assertEquals(ownerUrl, "http://10.0.0.9:20000/channels/invoke");
  });

  it("does not let a generic PORT env override the runtime listener port", async () => {
    const request = new Request(
      "https://demo-project.preview.veryfront.org:21000/api/control-plane/runs/run_1/stream",
    );

    const ownerUrl = await resolveRuntimeOwnerInvokeUrl(request, {
      getHostEnv: (key) => {
        if (key === "PORT") return "3000";
        return undefined;
      },
      getDenoNetworkInterfaces: () => [
        { address: "10.0.0.9", family: "IPv4", internal: false },
      ],
      dynamicImport: createDynamicImportStub({
        networkInterfaces: () => ({}),
      }),
    });

    assertEquals(ownerUrl, "http://10.0.0.9:21000/channels/invoke");
  });

  it("returns a null owner url when Deno interface probing throws", async () => {
    const request = new Request(
      "https://demo-project.preview.veryfront.org/api/control-plane/runs/run_1/stream",
    );

    const ownerUrl = await resolveRuntimeOwnerInvokeUrl(request, {
      getHostEnv: () => undefined,
      getDenoNetworkInterfaces: () => {
        throw new Error("Requires sys access");
      },
      dynamicImport: createDynamicImportStub({
        networkInterfaces: () => ({
          lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
        }),
      }),
    });

    assertEquals(ownerUrl, null);
  });

  it("returns null when no routable runtime owner host can be determined", async () => {
    const request = new Request(
      "https://demo-project.preview.veryfront.org/api/control-plane/runs/run_1/stream",
    );

    const ownerUrl = await resolveRuntimeOwnerInvokeUrl(request, {
      getHostEnv: () => undefined,
      getDenoNetworkInterfaces: () => [],
      dynamicImport: createDynamicImportStub({
        networkInterfaces: () => ({
          lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
        }),
      }),
    });

    assertEquals(ownerUrl, null);
  });

  it("rejects malformed explicit hosts instead of retaining the loopback placeholder", async () => {
    const request = new Request(
      "https://demo-project.preview.veryfront.org/api/control-plane/runs/run_1/stream",
    );

    const ownerUrl = await resolveRuntimeOwnerInvokeUrl(request, {
      getHostEnv: (key) => key === "VERYFRONT_RUNTIME_OWNER_HOST" ? "user@host" : undefined,
      getDenoNetworkInterfaces: () => [],
      dynamicImport: createDynamicImportStub({ networkInterfaces: () => ({}) }),
    });

    assertEquals(ownerUrl, null);
  });

  it("rejects non-canonical numeric hosts that URL parsing can reinterpret", async () => {
    const request = new Request(
      "https://demo-project.preview.veryfront.org/api/control-plane/runs/run_1/stream",
    );

    for (const host of ["2130706433", "0177.0.0.1", "0x7f000001"]) {
      const ownerUrl = await resolveRuntimeOwnerInvokeUrl(request, {
        getHostEnv: (key) => key === "VERYFRONT_RUNTIME_OWNER_HOST" ? host : undefined,
        getDenoNetworkInterfaces: () => [],
        dynamicImport: createDynamicImportStub({ networkInterfaces: () => ({}) }),
      });

      assertEquals(ownerUrl, null);
    }
  });

  it("formats an explicit IPv6 runtime owner host", async () => {
    const request = new Request(
      "https://demo-project.preview.veryfront.org/api/control-plane/runs/run_1/stream",
    );

    const ownerUrl = await resolveRuntimeOwnerInvokeUrl(request, {
      getHostEnv: (key) => {
        if (key === "VERYFRONT_RUNTIME_OWNER_HOST") return "2001:db8::1";
        if (key === "VERYFRONT_RUNTIME_OWNER_PORT") return "20000";
        return undefined;
      },
      getDenoNetworkInterfaces: () => [],
      dynamicImport: createDynamicImportStub({ networkInterfaces: () => ({}) }),
    });

    assertEquals(ownerUrl, "http://[2001:db8::1]:20000/channels/invoke");
  });
});
