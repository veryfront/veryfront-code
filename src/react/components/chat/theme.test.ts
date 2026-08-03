import { assert, assertEquals } from "#std/assert";
import { chatTokens, getChatTokensCSS } from "./chat-tokens.ts";
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
  assert(button.includes("hover:bg-[var(--accent)]"));
  assert(button.includes("size-7"));
  assert(button.includes("custom-class"));
});

Deno.test("token CSS uses Studio tokens with the open Inter font stack", () => {
  const css = theme.generateTokenCSS();
  assert(css.includes("--background:#F0EFE9"));
  assert(css.includes("--secondary:#FFFFFF"));
  assert(css.includes("font-family:Inter,ui-sans-serif,system-ui,sans-serif"));
  assertEquals(css.includes(["Gell", "ix"].join("")), false);
  assertEquals(css.includes(["S", "öhne"].join("")), false);
});

Deno.test("chat style provider tokens use Studio surface values", () => {
  const css = getChatTokensCSS();
  assert(css.includes("--background: #F0EFE9;"));
  assert(css.includes("--secondary: #FFFFFF;"));
  assert(css.includes("--chat-message-user: var(--primary);"));
  assertEquals(chatTokens.light["--chat-background"], "0 0% 100%");
});

Deno.test("theme module does not expose the removed variant utility", () => {
  const removedExport = ["c", "v", "a"].join("");
  assertEquals(removedExport in theme, false);
});

Deno.test("every chat cva variant resolves to classes", () => {
  // message roles
  const messageRoleExamples = [
    { role: "system" },
    { role: "user" },
    { role: "assistant" },
    { role: "tool" },
  ] as const;
  for (const options of messageRoleExamples) {
    assert(theme.messageVariants(options).length > 0, `message role="${options.role}"`);
  }
  // chat button variants + sizes
  const buttonVariantExamples = [
    { variant: "primary" },
    { variant: "ghost" },
    { variant: "outline" },
    { variant: "icon-ghost" },
  ] as const;
  for (const options of buttonVariantExamples) {
    assert(theme.chatButtonVariants(options).length > 0, `button variant="${options.variant}"`);
  }
  const buttonSizeExamples = [
    { size: "sm" },
    { size: "default" },
    { size: "icon-xs" },
    { size: "icon-sm" },
    { size: "icon-default" },
    { size: "icon-lg" },
  ] as const;
  for (const options of buttonSizeExamples) {
    assert(theme.chatButtonVariants(options).length > 0, `button size="${options.size}"`);
  }
  // chat container layouts
  const containerVariantExamples = [
    { variant: "default" },
    { variant: "embedded" },
    { variant: "floating" },
  ] as const;
  for (const options of containerVariantExamples) {
    assert(
      theme.chatContainerVariants(options).length > 0,
      `container variant="${options.variant}"`,
    );
  }
});
