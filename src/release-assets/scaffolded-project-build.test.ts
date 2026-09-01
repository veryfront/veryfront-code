/**
 * Regression: a freshly scaffolded project must complete a release asset build
 * with the extension set it actually ships with.
 *
 * `npm create veryfront@latest` scaffolds a project that composes no
 * `CSSOptimizationEngine`. That contract lives only in
 * `@veryfront/ext-css-lightning`, which `first-party-defaults.ts` marks
 * `selection: "explicit"`. CSS *optimisation* is optional; CSS *generation*
 * (`ext-css-tailwind`) and bundling (`ext-bundler-esbuild`) are builtin. A
 * release that ships unminified CSS is valid: the asset is content-hashed and
 * its `cssPipelineIdentity` records `unminified`, so no cache can serve a
 * stale minified entry in its place.
 *
 * This suite therefore composes only builtins a real install has, and asserts
 * before every build that no `CSSOptimizationEngine` is registered, so it
 * cannot quietly start testing a configuration no user runs. That is exactly
 * how the bug escaped: `css-processor-setup.ts` used to register a stub
 * optimiser for every importing suite, so `css-compile.test.ts` and
 * `build-executor.test.ts` stayed green across 100+ steps while every deploy
 * failed with:
 *
 *   Missing extension for contract "CSSOptimizationEngine"
 *
 * Verified by mutation: re-arming the strict `resolve()` in
 * `acquireCSSGenerationSession` fails all seven scaffolds here and leaves
 * those two suites green.
 *
 * @module release-assets/scaffolded-project-build.test
 */

import "#veryfront/schemas/_test-setup.ts";
import "../transforms/plugins/__tests__/code-parser-setup.ts";

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  register as registerContract,
  tryResolve as tryResolveContract,
  unregister as unregisterContract,
} from "#veryfront/extensions/contracts.ts";
import { CSSOptimizationEngineName } from "#veryfront/extensions/css/index.ts";
import { FIRST_PARTY_EXTENSION_POLICIES } from "#veryfront/extensions/first-party-defaults.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { hasUseClientDirective } from "#veryfront/rendering/rsc/page-island.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { readTextFile } from "#veryfront/testing/deno-compat.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { transformToESM } from "#veryfront/transforms/pipeline/index.ts";
import type { ExtensionFactory } from "#veryfront/extensions/types.ts";
import extTailwindFactory from "../../extensions/ext-css-tailwind/src/index.ts";
import extContentMdxFactory from "../../extensions/ext-content-mdx/src/index.ts";
import { getTemplate } from "../../templates/index.ts";
import { STARTER_TEMPLATE_NAMES } from "../../templates/types.ts";
import { createCompileProjectCss } from "./css-compile.ts";
import { type ReleaseAssetBuildClient, runReleaseAssetBuild } from "./build-executor.ts";
import { parseReleaseAssetManifest } from "./manifest-schema.ts";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Builtin-deferred providers the standard npm distribution ships, so a
 * scaffolded project has them without composing anything. Both are
 * `selection: "builtin-deferred", rootNpm: true` in `first-party-defaults.ts`;
 * the guard test below pins that, so this list cannot drift into fiction.
 */
const BUILTIN_SCAFFOLD_EXTENSIONS: ReadonlyArray<[string, ExtensionFactory]> = [
  ["ext-css-tailwind", extTailwindFactory as ExtensionFactory],
  ["ext-content-mdx", extContentMdxFactory as ExtensionFactory],
];

/**
 * Compose exactly what a default `npm create veryfront` project composes:
 * the builtin providers above, and no optimiser.
 */
async function composeProductionExtensions(): Promise<void> {
  for (const [, factory] of BUILTIN_SCAFFOLD_EXTENSIONS) {
    const ext = factory();
    await ext.setup?.(
      {
        config: {},
        logger: noopLogger,
        provide: (name: string, impl: unknown) => registerContract(name, impl),
        get: () => undefined,
        resolve: () => {
          throw new Error("resolve not used in setup");
        },
      } as never,
    );
  }
  // Defeat any optimiser a previously-loaded module registered globally.
  unregisterContract(CSSOptimizationEngineName);
}

/** Reads the files the executor materialized into its own temp dir. */
const fsAdapter = {
  fs: { readFile: (path: string): Promise<string> => readTextFile(path) },
} as unknown as RuntimeAdapter;

/**
 * Utility class names this scaffold's own markup asks for.
 *
 * The compiled stylesheet must contain a rule the scaffold actually requested,
 * not merely something a framework dependency contributed. A hard-coded list
 * cannot express that: `ai-agent`, for instance, styles its shell with only
 * `h-screen`, so a fixed set of utilities would silently pass on CSS that came
 * from somewhere else. Reading the markup keeps the assertion tied to the
 * template and lets templates change without weakening it.
 *
 * Deliberately narrow: only tokens matching `/^[a-z][a-z0-9-]*$/`. That leaves
 * out variants (`hover:`), arbitrary values (`w-[3px]`), slashes
 * (`bg-black/50`), negative utilities (`-mt-4`) and anything leading with a
 * digit, all of which compile to escaped or prefixed selectors. Matching those
 * is a CSS-escaping exercise this check does not need to take on, and every
 * starter declares plain utilities without them.
 */
function scaffoldUtilityClasses(
  files: ReadonlyArray<{ path: string; content: string }>,
): string[] {
  const found = new Set<string>();
  for (const file of files) {
    if (!/\.(tsx|jsx)$/.test(file.path)) continue;
    for (const match of file.content.matchAll(/className="([^"]+)"/g)) {
      for (const token of match[1]!.split(/\s+/)) {
        if (/^[a-z][a-z0-9-]*$/.test(token)) found.add(token);
      }
    }
  }
  return [...found];
}

interface Recorded {
  uploads: Array<{ hash: string; contentType: string; bytes: Uint8Array }>;
  manifest: unknown;
  states: Array<{ state: string; error?: string }>;
}

function makeClient(
  files: Array<{ path: string; content: string }>,
  rec: Recorded,
  projectScope: string,
): ReleaseAssetBuildClient {
  return {
    beginReleaseAssetManifestBuild: () =>
      Promise.resolve({ id: "b1", manifest_version: 1, state: "building" }),
    listAllReleaseFiles: () => Promise.resolve(files),
    uploadReleaseAsset: (_v, hash, contentType, bytes) => {
      rec.uploads.push({ hash, contentType, bytes });
      return Promise.resolve({ stored: true, existed: false });
    },
    putReleaseAssetManifest: (_v, manifest) => {
      rec.manifest = manifest;
      return Promise.resolve({ state: "ready", manifest_version: 1 });
    },
    reportReleaseAssetManifestState: (_v, state, error) => {
      rec.states.push({ state, error });
      return Promise.resolve(undefined);
    },
    // The real production compiler, not a stub. This is the seam that failed.
    compileProjectCss: createCompileProjectCss({ projectScope }),
  };
}

describe("release assets: scaffolded project build", () => {
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await composeProductionExtensions();
  });

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await Deno.remove(dir, { recursive: true }).catch(() => undefined);
    }
  });

  afterAll(async () => {
    await stopEsbuild();
  });

  async function tmp(): Promise<string> {
    const dir = await Deno.makeTempDir({ prefix: "vf-scaffold-release-" });
    tempDirs.push(dir);
    return dir;
  }

  it("keeps CSS optimisation an opt-in extension, so the default project has none", () => {
    // Guard: if ext-css-lightning ever becomes builtin, the suite below stops
    // reproducing the shipped configuration and must be revisited rather than
    // silently passing for the wrong reason.
    const lightning = FIRST_PARTY_EXTENSION_POLICIES.find(
      (policy) => policy.name === "ext-css-lightning",
    );
    assertExists(lightning);
    assertEquals(lightning.selection, "explicit");
    assertEquals(lightning.rootNpm, false);

    // The converse: everything this suite composes really is a builtin a
    // scaffolded project gets for free. If one of these ever becomes
    // "explicit", composing it here would fake a capability production lacks.
    for (const [name] of BUILTIN_SCAFFOLD_EXTENSIONS) {
      const policy = FIRST_PARTY_EXTENSION_POLICIES.find((entry) => entry.name === name);
      assertExists(policy, `${name} is not a known first-party extension`);
      assertEquals(policy.selection, "builtin-deferred", `${name} must be builtin`);
      assertEquals(policy.rootNpm, true, `${name} must ship in the root npm package`);
    }

    assertEquals(
      tryResolveContract(CSSOptimizationEngineName),
      undefined,
      "a scaffolded project composes no CSSOptimizationEngine",
    );
  });

  for (const templateName of STARTER_TEMPLATE_NAMES) {
    it(`builds release assets for the ${templateName} scaffold without an optimiser`, async () => {
      assertEquals(
        tryResolveContract(CSSOptimizationEngineName),
        undefined,
        "test must run with no CSSOptimizationEngine composed",
      );

      const files = await getTemplate(templateName);
      assertExists(files, `template ${templateName} was not found`);
      const sources = files.filter((file) => !file.path.endsWith(".svg"));

      const rec: Recorded = { uploads: [], manifest: null, states: [] };
      const result = await runReleaseAssetBuild({
        projectReference: `scaffold-${templateName}`,
        projectId: "proj-uuid",
        releaseId: "rel-uuid",
        releaseVersion: 1,
        releaseVersionRef: "rel-uuid",
        adapter: fsAdapter,
        dependencyMode: "source",
        // Exercise App Router's server/client release boundary independently
        // of the host process's experimental feature environment.
        loadConfig: () => Promise.resolve({ experimental: { rsc: true } } as VeryfrontConfig),
        client: makeClient(sources, rec, `scaffold-${templateName}`),
        // The real browser transform the hosted runtime injects. A passthrough
        // stub would leave TSX unparseable and turn every module into an
        // import-parse gap, which is precisely the kind of unrealistic fixture
        // that let this bug reach production.
        transform: (source, sourceFile, projectDir, adapter, options) =>
          transformToESM(source, sourceFile, projectDir, adapter, {
            projectId: options.projectId,
            dev: options.dev,
            ssr: options.ssr,
            reactVersion: options.reactVersion,
          }),
      }, await tmp());

      assertEquals(
        result.error,
        undefined,
        `${templateName} release asset build reported: ${result.error}`,
      );
      assertEquals(result.success, true);
      assertEquals(result.state, "ready");
      assertEquals(rec.states.map(({ state }) => state), []);

      // Project pages are served with `script-src 'self' 'nonce-...'
      // https://esm.sh` — no 'unsafe-eval'. A published JS asset containing
      // `new Function` throws EvalError in the browser and kills hydration
      // before first paint, leaving the page on its skeleton loaders.
      //
      // This asserts the shipped bytes, not the import graph, because the
      // build succeeds either way: before the fix these scaffolds published
      // platform/compat/dynamic-import.ts as its own chunk and every test here
      // still passed.
      //
      // Browser JS only exists where the scaffold crosses the client boundary.
      // A fully server-rendered template (`minimal`) must publish zero JS
      // assets now that App Router server modules stay out of release assets;
      // publishing any would regress that confidentiality boundary.
      const declaresClientBoundary = sources.some(({ path, content }) =>
        hasUseClientDirective(content, path)
      );
      const jsUploads = rec.uploads.filter((upload) => upload.contentType.includes("javascript"));
      if (declaresClientBoundary) {
        assert(
          jsUploads.length > 0,
          `${templateName} published no JS assets, so the new Function guard would pass vacuously`,
        );
      } else {
        assertEquals(
          jsUploads.map((upload) => upload.hash),
          [],
          `${templateName} is fully server-rendered and must not publish JS release assets`,
        );
      }
      const evalOffenders = jsUploads
        .filter((upload) => /\bnew Function\s*\(/.test(new TextDecoder().decode(upload.bytes)));
      assertEquals(
        evalOffenders.map((upload) => upload.hash),
        [],
        `${templateName} published JS assets containing new Function, which the page CSP ` +
          `blocks at runtime: ${
            evalOffenders
              .map((upload) => new TextDecoder().decode(upload.bytes).slice(0, 120))
              .join(" | ")
          }`,
      );

      const manifest = parseReleaseAssetManifest(rec.manifest);
      assertExists(manifest);
      if (declaresClientBoundary) {
        assert(
          Object.keys(manifest.modules).length > 0,
          `${templateName} manifest must list browser modules`,
        );
      } else {
        assertEquals(
          Object.keys(manifest.modules),
          [],
          `${templateName} has no client modules, so its manifest must list none`,
        );
      }
      assertEquals(
        manifest.css.length,
        1,
        `${templateName} must publish exactly one CSS asset`,
      );

      // The published CSS must be real compiled output for this scaffold's own
      // markup, not an empty or placeholder stylesheet. Every starter template
      // styles its shell with Tailwind utilities, so a utility rule must
      // survive to the uploaded asset.
      const cssUpload = rec.uploads.find((upload) => upload.contentType === "text/css");
      assertExists(cssUpload, "expected a text/css asset upload");
      const css = new TextDecoder().decode(cssUpload.bytes);
      assert(css.length > 0, "published CSS must not be empty");
      const utilities = scaffoldUtilityClasses(sources);
      assert(
        utilities.length > 0,
        `${templateName} markup declares no plain utility classes to check`,
      );
      assert(
        utilities.some((utility) => new RegExp(`\\.${utility}(?![\\w-])`).test(css)),
        `expected a utility from ${templateName}'s own markup in the compiled CSS; ` +
          `looked for ${utilities.slice(0, 12).join(", ")}`,
      );
      assertEquals(
        manifest.css[0]?.size,
        cssUpload.bytes.byteLength,
        "manifest CSS size must match the uploaded asset",
      );
    });
  }

  it("resolves project imports from the materialized release instead of the remote adapter", async () => {
    const sources = [
      {
        path: "pages/index.mdx",
        content: 'import { Card } from "@/components/Card"\n\n<Card />',
      },
      {
        path: "components/Card.tsx",
        content: 'export function Card() { return <div className="p-4">ready</div>; }',
      },
      {
        path: "package.json",
        content: JSON.stringify({ dependencies: { react: "19.2.4", "react-dom": "19.2.4" } }),
      },
    ];
    const remoteReads: string[] = [];
    const remoteAdapter = {
      ...fsAdapter,
      fs: {
        ...fsAdapter.fs,
        readFile(path: string): Promise<string> {
          remoteReads.push(path);
          return Promise.reject(new Error(`Unexpected remote release read: ${path}`));
        },
      },
    } as RuntimeAdapter;
    const rec: Recorded = { uploads: [], manifest: null, states: [] };

    const result = await runReleaseAssetBuild({
      projectReference: "remote-project",
      projectId: "proj-uuid",
      releaseId: "rel-uuid",
      releaseVersion: 1,
      releaseVersionRef: "rel-uuid",
      adapter: remoteAdapter,
      dependencyMode: "source",
      loadConfig: () => Promise.resolve({ experimental: { rsc: true } } as VeryfrontConfig),
      client: makeClient(sources, rec, "remote-project"),
      transform: (source, sourceFile, projectDir, adapter, options) =>
        transformToESM(source, sourceFile, projectDir, adapter, {
          projectId: options.projectId,
          dev: options.dev,
          ssr: options.ssr,
          reactVersion: options.reactVersion,
        }),
    }, await tmp());

    assertEquals(result.error, undefined);
    assertEquals(result.success, true);
    assertEquals(result.state, "ready");
    assertEquals(remoteReads, []);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(
      Object.keys(manifest.modules).sort(),
      ["components/Card.tsx", "pages/index.mdx"],
    );
  });
});
