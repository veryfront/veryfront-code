import { assert, assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { chatTokens, getChatTokensCSS } from "./chat-tokens.ts";
import * as theme from "./theme.ts";

describe("chat theme", () => {
  it("cn joins class values without third-party Tailwind conflict merging", () => {
    assertEquals(
      theme.cn("px-2", false && "hidden", ["py-1", { block: true }], "px-4"),
      "px-2 py-1 block px-4",
    );
  });

  it("chat variant helpers return configured defaults and overrides", () => {
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

  it("token CSS uses Studio tokens with the open Inter font stack", () => {
    const css = theme.generateTokenCSS();
    assert(css.includes("--background:#F0EFE9"));
    assert(css.includes("--secondary:#FFFFFF"));
    assert(css.includes("font-family:Inter,ui-sans-serif,system-ui,sans-serif"));
    assertEquals(css.includes(["Gell", "ix"].join("")), false);
    assertEquals(css.includes(["S", "öhne"].join("")), false);
  });

  it("chat style provider tokens use Studio surface values", () => {
    const css = getChatTokensCSS();
    assert(css.includes("--background: #F0EFE9;"));
    assert(css.includes("--secondary: #FFFFFF;"));
    assert(css.includes("--chat-message-user: var(--primary);"));
    assertEquals(chatTokens.light["--chat-background"], "0 0% 100%");
  });

  it("theme module does not expose the removed variant utility", () => {
    const removedExport = ["c", "v", "a"].join("");
    assertEquals(removedExport in theme, false);
  });

  it("every chat cva variant resolves to classes", () => {
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
    // chat button variants + sizes. The base class string is non-empty, so each
    // key is pinned to a class only that key contributes: a deleted key resolves
    // to `undefined`, which clsx drops without shortening the result.
    const buttonVariantExamples = [
      [{ variant: "primary" }, "bg-[var(--primary)]"],
      [{ variant: "ghost" }, "hover:bg-[var(--accent)]"],
      [{ variant: "outline" }, "border-[var(--outline-border)]"],
      [{ variant: "icon-ghost" }, "!p-0"],
    ] as const;
    for (const [options, expected] of buttonVariantExamples) {
      assert(
        theme.chatButtonVariants(options).includes(expected),
        `button variant="${options.variant}" resolves to ${expected}`,
      );
    }
    const buttonSizeExamples = [
      [{ size: "sm" }, "h-[32px]"],
      [{ size: "default" }, "h-[38px]"],
      [{ size: "icon-xs" }, "size-7"],
      [{ size: "icon-sm" }, "size-7"],
      [{ size: "icon-default" }, "size-8"],
      [{ size: "icon-lg" }, "size-9"],
    ] as const;
    for (const [options, expected] of buttonSizeExamples) {
      assert(
        theme.chatButtonVariants(options).includes(expected),
        `button size="${options.size}" resolves to ${expected}`,
      );
    }
    // chat container layouts
    const containerVariantExamples = [
      [{ variant: "default" }, "h-full bg-[var(--background)]"],
      [{ variant: "embedded" }, "bg-transparent"],
      [{ variant: "floating" }, "h-[600px]"],
    ] as const;
    for (const [options, expected] of containerVariantExamples) {
      assert(
        theme.chatContainerVariants(options).includes(expected),
        `container variant="${options.variant}" resolves to ${expected}`,
      );
    }
  });

  it("mergeThemes overlays user values without discarding sibling defaults", () => {
    const merged = theme.mergeThemes(theme.defaultChatTheme, {
      message: { user: "custom" },
      input: undefined,
    } as never);

    const defaults = theme.defaultChatTheme.message!;
    const mergedMessage = merged.message!;
    assertEquals(mergedMessage.user, "custom", "a user value overrides its default");
    assertEquals(
      mergedMessage.assistant,
      defaults.assistant,
      "sibling keys of a nested object survive the merge",
    );
    assertEquals(
      mergedMessage.system,
      defaults.system,
      "the system style survives a partial nested override",
    );
    assertEquals(
      mergedMessage.tool,
      defaults.tool,
      "the tool style survives a partial nested override",
    );
    assertEquals(
      merged.input,
      theme.defaultChatTheme.input,
      "an explicit undefined is skipped, not written over the default",
    );

    assertStrictEquals(
      theme.mergeThemes(theme.defaultChatTheme),
      theme.defaultChatTheme,
      "no user theme returns the default object unchanged",
    );
  });
});
