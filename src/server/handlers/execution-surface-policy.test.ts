import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fromFileUrl } from "#veryfront/compat/path";

/**
 * Guards the shared-runtime execution boundary against silent drift.
 *
 * Every surface that refuses to run tenant project code must ask the same
 * question: `requiresIsolatedProjectRuntime(ctx)`, which refuses only when the
 * runtime is shared *and* the host did not grant execution. Asking the
 * narrower `isSharedProjectRuntime(ctx)` instead denies hosts that were
 * explicitly granted the capability.
 *
 * That drift has now happened twice. veryfront-code#3364 converted three
 * surfaces and left three behind; the survivors were invisible because the
 * adapter Proxy fixed in #3378 made the predicate answer `false` for exactly
 * the remote-filesystem projects it governs, so the gate never fired anywhere
 * it was wrong. Once the Proxy was corrected, markdown preview started
 * returning 503 on staging (veryfront-issue-inbox#376, #366).
 *
 * Per-handler tests cannot catch this, because each one is individually
 * consistent. Only an inventory across surfaces can, so this test is the
 * inventory. It reads source rather than behaviour deliberately: a behavioural
 * sweep can only cover the surfaces someone remembered to add to it, whereas
 * an unlisted file here is a failure by construction.
 */

const HANDLERS_DIR = fromFileUrl(new URL(".", import.meta.url));

/** Surfaces that gate tenant code execution. These must honour the capability. */
const CAPABILITY_GATED_SURFACES = [
  "preview/markdown-preview.handler.ts",
  "request/api/api-handler-wrapper.ts",
  "request/api/app-router-handler.ts",
  "request/api/project-discovery.ts",
  "request/module/module.handler.ts",
  "request/public-agent-metadata.handler.ts",
  "request/public-agents-list.handler.ts",
  "request/snippet.handler.ts",
  "request/ssr/ssr.handler.ts",
  "response/cors.ts",
].toSorted();

/**
 * Files that legitimately read the narrower predicate because they are not
 * execution gates. Each needs a reason, because "it compiles" is how the
 * original drift got in.
 */
const NON_GATE_USES: Record<string, string> = {
  "response/cors.ts":
    "Avoids reloading request-scoped hosted config after its separate capability gate admits route inspection.",
};

async function readHandlerSources(): Promise<Map<string, string>> {
  const sources = new Map<string, string>();

  async function walk(relativeDir: string): Promise<void> {
    for await (const entry of Deno.readDir(`${HANDLERS_DIR}${relativeDir}`)) {
      const relativePath = `${relativeDir}${entry.name}`;
      if (entry.isDirectory) {
        await walk(`${relativePath}/`);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      if (entry.name.endsWith(".test-helpers.ts")) continue;
      sources.set(relativePath, await Deno.readTextFile(`${HANDLERS_DIR}${relativePath}`));
    }
  }

  await walk("");
  return sources;
}

/** Read the tree once so every assertion inspects the same snapshot. */
let cachedSources: Promise<Map<string, string>> | undefined;
function handlerSources(): Promise<Map<string, string>> {
  cachedSources ??= readHandlerSources();
  return cachedSources;
}

/** Strip imports first, so only real call sites count. */
function callsPredicate(source: string, predicate: string): boolean {
  const body = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("import "))
    .join("\n");
  return new RegExp(`\\b${predicate}\\s*\\(`).test(body);
}

describe("server/handlers shared-runtime execution boundary", () => {
  it("gates every execution surface on the capability, not on sharedness alone", async () => {
    const sources = await handlerSources();
    const drifted: string[] = [];

    for (const [path, source] of sources) {
      if (!callsPredicate(source, "isSharedProjectRuntime")) continue;
      if (path in NON_GATE_USES) continue;
      drifted.push(path);
    }

    assertEquals(
      drifted.toSorted(),
      [],
      `These files call isSharedProjectRuntime() directly. If a file gates tenant code ` +
        `execution it must call requiresIsolatedProjectRuntime() instead, so a host that ` +
        `was granted allowHostProjectCodeExecution is served. If it is not an execution ` +
        `gate, add it to NON_GATE_USES with a reason.`,
    );
  });

  it("keeps the capability-gated inventory accurate", async () => {
    const sources = await handlerSources();

    const missing = CAPABILITY_GATED_SURFACES.filter((path) => {
      const source = sources.get(path);
      return !source || !callsPredicate(source, "requiresIsolatedProjectRuntime");
    });

    assertEquals(
      missing,
      [],
      `These surfaces are listed as capability-gated but no longer call ` +
        `requiresIsolatedProjectRuntime(). Either restore the call or remove the entry ` +
        `deliberately. Silently dropping the gate is how a surface stops being enforced.`,
    );

    const unlisted = [...sources.keys()]
      .filter((path) => callsPredicate(sources.get(path)!, "requiresIsolatedProjectRuntime"))
      .filter((path) => !CAPABILITY_GATED_SURFACES.includes(path))
      .toSorted();

    assertEquals(
      unlisted,
      [],
      `New execution surfaces found. Add them to CAPABILITY_GATED_SURFACES and give each ` +
        `a paired fail-closed and granted-path test. A fail-closed test alone cannot ` +
        `distinguish a correct predicate from a hardcoded denial.`,
    );
  });

  it("documents why each non-gate use of the narrow predicate is safe", async () => {
    const sources = await handlerSources();
    const stale = Object.keys(NON_GATE_USES).filter((path) => {
      const source = sources.get(path);
      return !source || !callsPredicate(source, "isSharedProjectRuntime");
    });

    assertEquals(
      stale,
      [],
      "NON_GATE_USES lists files that no longer call isSharedProjectRuntime(). Remove them.",
    );
  });
});
