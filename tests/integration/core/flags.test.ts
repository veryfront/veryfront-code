import { assertEquals } from "std/assert/mod.ts";

Deno.test("flags | isRSCEnabled toggles with env", async () => {
  const prev = Deno.env.get("VERYFRONT_EXPERIMENTAL_RSC");
  try {
    // unset -> false
    if (prev !== undefined) Deno.env.delete("VERYFRONT_EXPERIMENTAL_RSC");
    const { isRSCEnabled } = await import("@veryfront/utils/feature-flags.ts?x=1");
    assertEquals(isRSCEnabled(), false);

    // truthy -> true
    Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "1");
    const { isRSCEnabled: is2 } = await import("@veryfront/utils/feature-flags.ts?x=2");
    assertEquals(is2(), true);

    // empty string still considered falsey in our implementation
    Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "");
    const { isRSCEnabled: is3 } = await import("@veryfront/utils/feature-flags.ts?x=3");
    assertEquals(is3(), false);
  } finally {
    if (prev === undefined) Deno.env.delete("VERYFRONT_EXPERIMENTAL_RSC");
    else Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", prev);
  }
});
