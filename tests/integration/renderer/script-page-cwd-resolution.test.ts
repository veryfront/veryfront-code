/**
 * A relative script page path with no projectDir resolves against the process
 * working directory, so asserting the exact resolved path requires reading
 * shared host state. The hermetic path cases stay in
 * src/rendering/script-page-handling.test.ts.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { cwd } from "#veryfront/platform/compat/process.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { handleScriptPage } from "#veryfront/rendering/script-page-handling.ts";

function createMissingFileAdapter(): RuntimeAdapter {
  return {
    fs: {
      exists: () => Promise.resolve(false),
      readFile: () => Promise.reject(new Error("missing")),
    },
  } as unknown as RuntimeAdapter;
}

/** Render a page that cannot be read so the resolved module path surfaces in the error. */
async function scriptPageLoadFailure(pagePath: string, projectDir: string): Promise<string> {
  const error = await assertRejects(
    () =>
      handleScriptPage(
        {
          entity: { path: pagePath, frontmatter: {} },
        } as never,
        "script-page",
        {
          mode: "production",
          config: {} as never,
          projectDir,
          adapter: createMissingFileAdapter(),
        },
      ),
    Error,
  );

  return String(error);
}

describe("rendering/script-page-handling working-directory resolution", () => {
  it("should resolve against cwd when projectDir is empty", async () => {
    const message = await scriptPageLoadFailure("file.ts", "");
    assertStringIncludes(
      message,
      `(tried: ${join(cwd(), "file.ts")})`,
      "a relative path with no projectDir must resolve against the current working directory",
    );
  });
});
