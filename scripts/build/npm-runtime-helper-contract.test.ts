import { assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PUBLISHED_RUNTIME_HELPERS } from "../../src/platform/compat/published-runtime-helpers.ts";
import { assertNpmRuntimeHelperContract } from "./npm-runtime-helper-contract.ts";

async function createEmittedPackage(
  imports: readonly string[],
): Promise<string> {
  const directory = await Deno.makeTempDir();
  const esmRoot = `${directory}/esm`;
  await Deno.mkdir(`${esmRoot}/src/example`, { recursive: true });
  await Deno.writeTextFile(
    `${esmRoot}/src/example/module.js`,
    imports.map((specifier) => `import "${specifier}";`).join("\n"),
  );
  await Deno.mkdir(`${esmRoot}/deps/example`, { recursive: true });
  await Deno.writeTextFile(
    `${esmRoot}/deps/example/runtime.js`,
    "export {};\n",
  );

  for (const helper of PUBLISHED_RUNTIME_HELPERS) {
    await Deno.writeTextFile(`${esmRoot}/${helper}`, "export {};\n");
  }

  return esmRoot;
}

describe("npm runtime helper contract", () => {
  it("accepts the emitted DNT helper set", async () => {
    const esmRoot = await createEmittedPackage([
      "../../_dnt.shims.js",
      "../../_dnt.polyfills.js",
      "../../deno.js",
      "../../deps/example/runtime.js",
    ]);

    try {
      await assertNpmRuntimeHelperContract(esmRoot, PUBLISHED_RUNTIME_HELPERS);
    } finally {
      await Deno.remove(new URL("..", `file://${esmRoot}/`).pathname, {
        recursive: true,
      });
    }
  });

  it("rejects unrecognized package-root imports", async () => {
    const esmRoot = await createEmittedPackage([
      "../../_dnt.shims.js",
      "../../_dnt.polyfills.js",
      "../../deno.js",
      "../../_dnt.future.js",
    ]);
    await Deno.writeTextFile(`${esmRoot}/_dnt.future.js`, "export {};\n");

    try {
      await assertRejects(
        () =>
          assertNpmRuntimeHelperContract(esmRoot, PUBLISHED_RUNTIME_HELPERS),
        Error,
        "_dnt.future.js",
      );
    } finally {
      await Deno.remove(new URL("..", `file://${esmRoot}/`).pathname, {
        recursive: true,
      });
    }
  });

  it("rejects missing imported helpers", async () => {
    const esmRoot = await createEmittedPackage([
      "../../_dnt.shims.js",
      "../../_dnt.polyfills.js",
      "../../deno.js",
    ]);
    await Deno.remove(`${esmRoot}/deno.js`);

    try {
      await assertRejects(
        () =>
          assertNpmRuntimeHelperContract(esmRoot, PUBLISHED_RUNTIME_HELPERS),
        Error,
        "Missing imported helper: deno.js",
      );
    } finally {
      await Deno.remove(new URL("..", `file://${esmRoot}/`).pathname, {
        recursive: true,
      });
    }
  });

  it("rejects stale expected helpers", async () => {
    const esmRoot = await createEmittedPackage([
      "../../_dnt.shims.js",
      "../../_dnt.polyfills.js",
    ]);

    try {
      await assertRejects(
        () =>
          assertNpmRuntimeHelperContract(esmRoot, PUBLISHED_RUNTIME_HELPERS),
        Error,
        "Expected helper is no longer imported: deno.js",
      );
    } finally {
      await Deno.remove(new URL("..", `file://${esmRoot}/`).pathname, {
        recursive: true,
      });
    }
  });

  it("rejects relative imports outside the ESM package", async () => {
    const esmRoot = await createEmittedPackage([
      "../../../outside.js",
    ]);

    try {
      await assertRejects(
        () =>
          assertNpmRuntimeHelperContract(esmRoot, PUBLISHED_RUNTIME_HELPERS),
        Error,
        "outside.js",
      );
    } finally {
      await Deno.remove(new URL("..", `file://${esmRoot}/`).pathname, {
        recursive: true,
      });
    }
  });
});
