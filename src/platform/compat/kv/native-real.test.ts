import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NativeKv, type NativeKvBackend } from "./native-adapter.ts";

const openNativeKv = Reflect.get(Deno, "openKv") as
  | ((path?: string) => Promise<NativeKvBackend>)
  | undefined;

describe("NativeKv real Deno KV contract", { skip: typeof openNativeKv !== "function" }, () => {
  it("stores portable keys and values near the shared limits", async () => {
    const path = await Deno.makeTempFile({ prefix: "veryfront-native-kv-" });
    await Deno.remove(path);
    const kv = new NativeKv(await openNativeKv!(path));
    const key = ["x".repeat(2_000)];
    const value = "x".repeat(59 * 1_024);

    try {
      await kv.set(key, value);

      assertEquals((await kv.get<string>(key)).value, value);
    } finally {
      kv.close();
      await Deno.remove(path);
    }
  });

  it("stores structurally dense values within the portable JSON limit", async () => {
    const path = await Deno.makeTempFile({ prefix: "veryfront-native-kv-" });
    await Deno.remove(path);
    const kv = new NativeKv(await openNativeKv!(path));
    const value = Array.from({ length: 20_000 }, () => [] as unknown[]);

    try {
      await kv.set(["dense"], value);

      assertEquals((await kv.get<unknown[][]>(["dense"])).value, value);
    } finally {
      kv.close();
      await Deno.remove(path);
    }
  });

  it("reads legacy native values written before canonical payload encoding", async () => {
    const path = await Deno.makeTempFile({ prefix: "veryfront-native-kv-" });
    await Deno.remove(path);
    const backend = await openNativeKv!(path);
    await backend.set(["legacy"], { compatible: true });
    const kv = new NativeKv(backend);

    try {
      assertEquals((await kv.get(["legacy"])).value, { compatible: true });
    } finally {
      kv.close();
      await Deno.remove(path);
    }
  });
});
