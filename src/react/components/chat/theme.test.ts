import { assert, assertEquals } from "#std/assert";
import * as theme from "./theme.ts";

Deno.test("cn joins class values without third-party Tailwind conflict merging", () => {
  assertEquals(
    theme.cn("px-2", false && "hidden", ["py-1", { block: true }], "px-4"),
    "px-2 py-1 block px-4",
  );
});

Deno.test("chat variant helpers return configured defaults and overrides", () => {
  assert(
    theme.messageVariants({ role: "user" }).includes(
      "bg-[var(--chat-bubble)]",
    ),
  );
  assert(theme.messageVariants({ role: undefined }).includes("max-w-none"));
  assertEquals(theme.messageVariants({ role: null }), "");

  const button = theme.chatButtonVariants({
    variant: "ghost",
    size: "icon-sm",
    className: "custom-class",
  });
  assert(button.includes("bg-transparent"));
  assert(button.includes("size-9"));
  assert(button.includes("custom-class"));
});

Deno.test("theme module does not expose the removed variant utility", () => {
  const removedExport = ["c", "v", "a"].join("");
  assertEquals(removedExport in theme, false);
});
