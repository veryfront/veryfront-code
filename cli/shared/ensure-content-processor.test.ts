import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolve, tryResolve, unregister } from "../../src/extensions/contracts.ts";
import type { ContentProcessor } from "veryfront/extensions/content";
import { ensureBuiltinContentProcessor } from "./ensure-content-processor.ts";

/** The error Node raises for an uninstalled optional peer dependency. */
function missingPackageError(): Error {
  return Object.assign(
    new Error(
      "Cannot find package '@veryfront/ext-content-mdx' imported from " +
        "/app/node_modules/veryfront/esm/cli/shared/ensure-content-processor.js",
    ),
    { code: "ERR_MODULE_NOT_FOUND" },
  );
}

class StubContentProcessor {
  compileMdx() {
    return Promise.reject(new Error("unused"));
  }
  compileMarkdown() {
    return Promise.reject(new Error("unused"));
  }
  getRemarkPlugins() {
    return [];
  }
  getRehypePlugins() {
    return [];
  }
}

describe("cli/shared/ensure-content-processor", () => {
  it("registers the MDX processor when the extension is installed", async () => {
    try {
      await ensureBuiltinContentProcessor(() =>
        Promise.resolve({ MdxContentProcessor: StubContentProcessor })
      );

      assertEquals(
        tryResolve<ContentProcessor>("ContentProcessor") instanceof StubContentProcessor,
        true,
      );
    } finally {
      unregister("ContentProcessor");
    }
  });

  // @veryfront/ext-content-mdx is an optional peer, so a plain
  // `npm install veryfront` does not install it. Server startup calls this
  // unconditionally (cli/shared/server-startup.ts), so throwing here would
  // break `npx veryfront dev` for every project — including the ones with no
  // .mdx file at all.
  it("does not fail startup when the MDX extension is not installed", async () => {
    await ensureBuiltinContentProcessor(() => Promise.reject(missingPackageError()));

    assertEquals(tryResolve<ContentProcessor>("ContentProcessor"), undefined);
  });

  // With no processor registered, the compile path is what reports the
  // problem, and it names the package to install.
  it("leaves the actionable install message to the content compile path", async () => {
    await ensureBuiltinContentProcessor(() => Promise.reject(missingPackageError()));

    let message = "";
    try {
      resolve<ContentProcessor>("ContentProcessor");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    assertStringIncludes(message, "@veryfront/ext-content-mdx");
  });

  // What importFirstPartyExtensionModule actually throws: the raw resolution
  // error is wrapped, its message gains an install hint, and the original pair
  // (package + workspace source) lands on `cause` as an AggregateError. The
  // classifier's message patterns are anchored, so the wrapper itself never
  // matches — only the cause chain does.
  it("tolerates the wrapped install-hint error the real loader throws", async () => {
    const packageError = new Error(
      "Cannot find package '@veryfront/ext-content-mdx' imported from " +
        "/app/node_modules/veryfront/esm/src/extensions/first-party-import.js",
    );
    const sourceError = new Error(
      "Cannot find module " +
        "'/app/node_modules/veryfront/esm/extensions/ext-content-mdx/src/index.ts'",
    );
    const wrapped = new Error(
      `${packageError.message} First-party extension "ext-content-mdx" is not ` +
        "installed; install @veryfront/ext-content-mdx alongside veryfront to enable it.",
      { cause: new AggregateError([packageError, sourceError], packageError.message) },
    );

    await ensureBuiltinContentProcessor(() => Promise.reject(wrapped));

    assertEquals(tryResolve<ContentProcessor>("ContentProcessor"), undefined);
  });

  // A broken transitive dependency inside an *installed* extension must not be
  // mistaken for "not installed" and silently swallowed.
  it("rethrows real load failures from an installed extension", async () => {
    await assertRejects(
      () => ensureBuiltinContentProcessor(() => Promise.reject(new Error("boom"))),
      Error,
      "boom",
    );
  });
});
