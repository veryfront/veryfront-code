import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { walk } from "@std/fs/walk";

// `veryfront/ui` is the base layer: `chat` depends on `ui`, never the reverse.
// This test enforces that contract so a stray import back into `chat/` can't
// silently reintroduce the dependency (regression guard for PR #2798).
const UI_DIR = new URL(".", import.meta.url).pathname;

/** Matches any import/export specifier that reaches into the chat module. */
const CHAT_IMPORT = /from\s+["']([^"']*)["']/g;

function referencesChat(specifier: string): boolean {
  return (
    specifier.includes("components/chat") ||
    specifier.startsWith("../chat/") ||
    specifier.startsWith("../../chat/")
  );
}

describe("veryfront/ui module boundary", () => {
  it("does not import anything from the chat module", async () => {
    const offenders: string[] = [];

    for await (
      const entry of walk(UI_DIR, {
        exts: [".ts", ".tsx"],
        includeDirs: false,
      })
    ) {
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      const source = await Deno.readTextFile(entry.path);
      for (const match of source.matchAll(CHAT_IMPORT)) {
        const specifier = match[1];
        if (specifier && referencesChat(specifier)) {
          offenders.push(`${entry.name} -> ${specifier}`);
        }
      }
    }

    assertEquals(
      offenders,
      [],
      `ui/** must not import chat internals:\n  - ${offenders.join("\n  - ")}`,
    );
  });

  it("guards against the exact chat-tokens back-import that regressed before", async () => {
    // AppShell used to import `ChatTokens` from chat; the token layer now lives
    // in `ui/tokens.tsx`. Assert the offending import string is gone.
    const appShell = await Deno.readTextFile(`${UI_DIR}app-shell.tsx`);
    assert(
      !appShell.includes("chat-tokens-style"),
      "app-shell.tsx must render the local ui token style, not chat's",
    );
  });
});
