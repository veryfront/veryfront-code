import { assertEquals } from "#std/assert";
import { join, normalize } from "#std/path.ts";

import {
  resolveRscImportMapSpecifier,
  RSC_BROWSER_ERROR_REGISTRY_PATH,
} from "./prebundle-rsc-import-map.ts";

Deno.test("RSC prebundle resolves client error imports through the browser registry", () => {
  const projectRoot = "/workspace/veryfront";
  const importMap = {
    "#veryfront/errors": "./src/errors/index.ts",
    "#veryfront/": "./src/",
  };
  const expected = normalize(
    join(projectRoot, RSC_BROWSER_ERROR_REGISTRY_PATH),
  );

  assertEquals(
    resolveRscImportMapSpecifier(
      "#veryfront/errors",
      projectRoot,
      importMap,
    ),
    expected,
  );
  assertEquals(
    resolveRscImportMapSpecifier(
      "#veryfront/errors/error-registry.ts",
      projectRoot,
      importMap,
    ),
    expected,
  );
  assertEquals(
    resolveRscImportMapSpecifier(
      "#veryfront/errors/error-registry/general.ts",
      projectRoot,
      importMap,
    ),
    expected,
  );
});

Deno.test("RSC prebundle preserves ordinary exact and longest-prefix imports", () => {
  const projectRoot = "/workspace/veryfront";
  const importMap = {
    "#veryfront/exact": "./src/exact.ts",
    "#veryfront/": "./src/",
    "#veryfront/rendering/": "./src/rendering/",
  };

  assertEquals(
    resolveRscImportMapSpecifier(
      "#veryfront/exact",
      projectRoot,
      importMap,
    ),
    normalize(join(projectRoot, "src/exact.ts")),
  );
  assertEquals(
    resolveRscImportMapSpecifier(
      "#veryfront/rendering/rsc/client.ts",
      projectRoot,
      importMap,
    ),
    normalize(join(projectRoot, "src/rendering/rsc/client.ts")),
  );
});
