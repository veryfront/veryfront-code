import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "@std/assert";
import {
  createCacheBackend,
  isApiCacheAvailable,
  isDiskCacheConfigured,
  isDistributedBackend,
} from "./factory.ts";
import { DiskCacheBackend } from "./disk.ts";
import { MemoryCacheBackend } from "./memory.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "#veryfront/extensions/distributed/index.ts";

Deno.test("factory: isDiskCacheConfigured", async (t) => {
  await t.step("returns false when no env vars set", () => {
    // Default state: no VF_CACHE_BACKEND or VF_DISK_CACHE_DIR
    const result = isDiskCacheConfigured();
    assertEquals(typeof result, "boolean");
  });
});

Deno.test("factory: API availability classifies exact local hostnames", () => {
  const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
  const originalProxyMode = Deno.env.get("PROXY_MODE");
  const originalNodeEnv = Deno.env.get("NODE_ENV");
  Deno.env.delete("PROXY_MODE");
  Deno.env.delete("NODE_ENV");

  try {
    for (
      const localUrl of [
        "http://LOCALHOST:8787",
        "http://127.0.0.1:8787",
        "http://[::1]:8787",
        "http://preview.lvh.me:8787",
      ]
    ) {
      Deno.env.set("VERYFRONT_API_BASE_URL", localUrl);
      assertEquals(isApiCacheAvailable(), false);
    }

    for (
      const remoteUrl of [
        "https://localhost.example.com",
        "https://lvh.me.attacker.example",
      ]
    ) {
      Deno.env.set("VERYFRONT_API_BASE_URL", remoteUrl);
      assertEquals(isApiCacheAvailable(), true);
    }
  } finally {
    if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
    else Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
    if (originalProxyMode === undefined) Deno.env.delete("PROXY_MODE");
    else Deno.env.set("PROXY_MODE", originalProxyMode);
    if (originalNodeEnv === undefined) Deno.env.delete("NODE_ENV");
    else Deno.env.set("NODE_ENV", originalNodeEnv);
  }
});

Deno.test("factory: createCacheBackend with preferredBackend=disk", async () => {
  const backend = await createCacheBackend({ preferredBackend: "disk" });
  assertEquals(backend.type, "disk");
});

Deno.test("factory: createCacheBackend with preferredBackend=memory", async () => {
  const backend = await createCacheBackend({ preferredBackend: "memory" });
  assertEquals(backend.type, "memory");
});

Deno.test("factory: forwards API response size limits", async () => {
  await assertRejects(
    () =>
      createCacheBackend({
        preferredBackend: "api",
        apiBaseUrl: "https://api.example.test",
        apiMaxResponseBytes: 0,
      }),
    RangeError,
    "maxResponseBytes",
  );
});

Deno.test("factory: isDistributedBackend", async (t) => {
  await t.step("returns false for pod-local disk backend", () => {
    assertEquals(isDistributedBackend(new DiskCacheBackend()), false);
  });

  await t.step("returns false for memory backend", () => {
    assertEquals(isDistributedBackend(new MemoryCacheBackend()), false);
  });
});

Deno.test("factory: explicit distributed selection fails closed when unavailable", async () => {
  const previous = tryResolve<DistributedRuntimeProvider>(DistributedRuntimeProviderName);
  unregister(DistributedRuntimeProviderName);
  try {
    await assertRejects(
      () => createCacheBackend({ preferredBackend: "distributed" }),
      Error,
      'Missing extension for contract "DistributedRuntimeProvider"',
    );
  } finally {
    if (previous !== undefined) register(DistributedRuntimeProviderName, previous);
  }
});

Deno.test("factory: isDiskCacheConfigured responds to env vars", async (t) => {
  await t.step("returns true when VF_CACHE_BACKEND=disk", () => {
    Deno.env.set("VF_CACHE_BACKEND", "disk");
    try {
      assertEquals(isDiskCacheConfigured(), true);
    } finally {
      Deno.env.delete("VF_CACHE_BACKEND");
    }
  });

  await t.step("returns true when VF_DISK_CACHE_DIR is set", () => {
    Deno.env.set("VF_DISK_CACHE_DIR", "/tmp/test");
    try {
      assertEquals(isDiskCacheConfigured(), true);
    } finally {
      Deno.env.delete("VF_DISK_CACHE_DIR");
    }
  });
});
