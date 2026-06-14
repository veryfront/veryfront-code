import "#veryfront/schemas/_test-setup.ts";

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeHttpUrl } from "#veryfront/transforms/esm/http-cache.ts";
import { RELEASE_ASSET_MAX_SIZE_BYTES } from "./constants.ts";
import {
  type ReleaseAssetBuildClient,
  type ReleaseAssetBuildInput,
  type ReleaseAssetHttpDependencyVendor,
  type ReleaseAssetVendorResult,
  routeForPage,
  runReleaseAssetBuild,
} from "./build-executor.ts";
import { parseReleaseAssetManifest } from "./manifest-schema.ts";

interface Recorded {
  began: boolean;
  uploads: Array<{ hash: string; contentType: string; text: string }>;
  manifest: unknown;
  states: Array<{ state: string; error?: string }>;
}

function makeClient(
  files: Array<{ path: string; content?: string }>,
  rec: Recorded,
  overrides: Partial<ReleaseAssetBuildClient> = {},
): ReleaseAssetBuildClient {
  return {
    beginReleaseAssetManifestBuild: () => {
      rec.began = true;
      return Promise.resolve({ id: "b1", manifest_version: 7, state: "building" });
    },
    listAllReleaseFiles: () => Promise.resolve(files),
    uploadReleaseAsset: (_v, hash, contentType, bytes) => {
      rec.uploads.push({ hash, contentType, text: new TextDecoder().decode(bytes) });
      return Promise.resolve({ stored: true, existed: false });
    },
    putReleaseAssetManifest: (_v, manifest) => {
      rec.manifest = manifest;
      return Promise.resolve({ state: "ready", manifest_version: 7 });
    },
    reportReleaseAssetManifestState: (_v, state, error) => {
      rec.states.push({ state, error });
      return Promise.resolve(undefined);
    },
    ...overrides,
  };
}

function baseInput(
  client: ReleaseAssetBuildClient,
  transform: ReleaseAssetBuildInput["transform"],
): ReleaseAssetBuildInput {
  return {
    projectReference: "demo",
    projectId: "proj-uuid",
    releaseId: "rel-uuid",
    releaseVersion: 5,
    releaseVersionRef: "rel-uuid",
    adapter: {},
    client,
    transform,
    vendorHttpImports: fakeVendorHttpImports,
  };
}

function fakeHttpCachePath(url: string): string {
  const hash = Array.from(new TextEncoder().encode(url))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  return `/tmp/veryfront-http-bundle/http-${hash}.mjs`;
}

function fakeVendorHttpImports(code: string): Promise<ReleaseAssetVendorResult> {
  const urls = [
    ...new Set(
      [...code.matchAll(/["'](https?:\/\/[^"']+)["']/g)]
        .map((match) => match[1])
        .filter((url): url is string => typeof url === "string"),
    ),
  ];
  let rewritten = code;
  const dependencies = urls.map((url) => {
    const sourcePath = fakeHttpCachePath(url);
    rewritten = rewritten.replaceAll(url, `file://${sourcePath}`);
    return {
      specifier: `file://${sourcePath}`,
      manifestKey: url,
      sourcePath,
      code: `export const sourceUrl = ${JSON.stringify(url)};`,
    };
  });

  return Promise.resolve({ code: rewritten, dependencies });
}

async function fakeNormalizedVendorHttpImports(code: string): Promise<ReleaseAssetVendorResult> {
  const result = await fakeVendorHttpImports(code);
  return {
    code: result.code,
    dependencies: result.dependencies.map((dependency) => ({
      ...dependency,
      manifestKey: normalizeHttpUrl(dependency.manifestKey),
    })),
  };
}

function withFakeReactVendor(
  vendor: ReleaseAssetHttpDependencyVendor,
): ReleaseAssetHttpDependencyVendor {
  return (code, options) => {
    if (code.includes("https://esm.sh/react@") || code.includes("https://esm.sh/react-dom@")) {
      return fakeVendorHttpImports(code);
    }
    return vendor(code, options);
  };
}

describe("release asset build executor", () => {
  const tempDirs: string[] = [];

  async function tmp(): Promise<string> {
    const dir = await Deno.makeTempDir({ prefix: "vf-rab-test-" });
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await Deno.remove(dir, { recursive: true }).catch(() => undefined);
    }
  });

  it("assembles a ready manifest from the module closure", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "pages/index.tsx", content: "export default () => null;" },
      { path: "components/Button.tsx", content: "export const Button = () => null;" },
      { path: "README.md", content: "# docs" },
    ];
    const client = makeClient(files, rec);
    const transform = (source: string) => Promise.resolve(`/*t*/${source}`);

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assert(rec.began);
    assertEquals(result.success, true);
    assertEquals(result.state, "ready");
    assertEquals(result.moduleCount, 2);

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.releaseVersion, 5);
    assertEquals(manifest.projectId, "proj-uuid");
    // H2: manifestVersion must come from begin's response (7), not hardcoded 1.
    assertEquals(manifest.manifestVersion, 7);
    assertExists(manifest.modules["pages/index.tsx"]);
    assertExists(manifest.modules["components/Button.tsx"]);
    // README is not a browser module — excluded.
    assertEquals(manifest.modules["README.md"], undefined);
    // Page route maps to its module (single module, no imports).
    assertEquals(manifest.routes["/"]?.modules, ["pages/index.tsx"]);
    // No CSS pipeline injected → css empty + gap recorded.
    assertEquals(manifest.css.length, 0);
    assert(manifest.fallback.gaps.includes("css:no-pipeline"));
    // Project modules plus framework import-map dependencies are uploaded.
    assert(rec.uploads.length >= 2);
    assert(rec.uploads.every((u) => u.contentType === "text/javascript"));
  });

  it("records framework import-map modules as manifest dependencies", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec);
    const transform = (source: string, sourceFile: string) =>
      Promise.resolve(`/*${sourceFile}*/\n${source}`);

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertExists(manifest.dependencies.react);
    assertExists(manifest.dependencies["react-dom"]);
    assertExists(manifest.dependencies["react-dom/client"]);
    assertExists(manifest.dependencies["react/jsx-runtime"]);
    assertExists(manifest.dependencies["react/jsx-dev-runtime"]);
    assertExists(manifest.dependencies["veryfront/chat"]);
    assertExists(manifest.dependencies["veryfront/workflow"]);
    assertEquals(
      manifest.dependencies["veryfront/head"]?.contentHash,
      manifest.dependencies["veryfront/react/head"]?.contentHash,
    );
  });

  it("matches React import-map dependencies by normalized HTTP manifest key", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec);
    const transform = (source: string) => Promise.resolve(source);

    const result = await runReleaseAssetBuild(
      {
        ...baseInput(client, transform),
        vendorHttpImports: fakeNormalizedVendorHttpImports,
      },
      await tmp(),
    );

    assertEquals(result.success, true);

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertExists(manifest.dependencies.react);
    assertExists(manifest.dependencies["react-dom/client"]);
    assertExists(manifest.dependencies["react/jsx-runtime"]);
  });

  it("fails when React import-map dependencies cannot be vendored", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec);
    const transform = (source: string) => Promise.resolve(source);
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: (code: string) => Promise.resolve({ code, dependencies: [] }),
    };

    const result = await runReleaseAssetBuild(input, await tmp());

    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assertEquals(rec.manifest, null);
    assertEquals(rec.states.at(-1)?.state, "failed");
    assert(rec.states.at(-1)?.error?.includes("React import-map dependency missing"));
  });

  it("rewrites covered project module imports to immutable asset URLs", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import Header from "../components/Header.tsx"; export default Header;',
      },
      {
        path: "components/Header.tsx",
        content: "export default function Header() { return null; }",
      },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve(
          'import Header from "/_vf_modules/components/Header.js"; export default Header;',
        );
      }
      return Promise.resolve("export default function Header() { return null; }");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const headerHash = manifest.modules["components/Header.tsx"]?.contentHash;
    assertExists(headerHash);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(pageUpload.text.includes(`"/_vf/assets/${headerHash}.js"`));
    assert(!pageUpload.text.includes("/_vf_modules/components/Header.js"));
  });

  it("vendors transformed HTTP imports into immutable dependency assets", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import motion from "framer-motion"; export default motion;',
      },
    ];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import motion from "https://esm.sh/framer-motion@11"; export default motion;',
      );
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code.replace(
            "https://esm.sh/framer-motion@11",
            "file:///tmp/veryfront-http-bundle/http-123.mjs",
          ),
          dependencies: [{
            specifier: "file:///tmp/veryfront-http-bundle/http-123.mjs",
            manifestKey: "https://esm.sh/framer-motion@11",
            code: "export default function motion() {}",
          }],
        })
      ),
    };

    await runReleaseAssetBuild(input, await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const dependencyHash = manifest.dependencies["https://esm.sh/framer-motion@11"]?.contentHash;
    assertExists(dependencyHash);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);

    const dependencyUpload = rec.uploads.find((u) => u.hash === dependencyHash);
    assertExists(dependencyUpload);
    assertEquals(dependencyUpload.text, "export default function motion() {}");

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(pageUpload.text.includes(`"/_vf/assets/${dependencyHash}.js"`));
    assert(!pageUpload.text.includes("https://esm.sh/framer-motion"));
    assert(!pageUpload.text.includes("file:///tmp/veryfront-http-bundle"));
  });

  it("rewrites nested vendored HTTP dependency imports to immutable assets", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import parent from "remote-parent"; export default parent;',
      },
    ];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import parent from "https://esm.sh/parent@1"; export default parent;',
      );
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code.replace(
            "https://esm.sh/parent@1",
            "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
          ),
          dependencies: [
            {
              specifier: "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
              manifestKey: "https://esm.sh/parent@1",
              sourcePath: "/tmp/veryfront-http-bundle/http-aaa.mjs",
              code: 'import child from "./http-bbb.mjs"; export default child;',
            },
            {
              specifier: "file:///tmp/veryfront-http-bundle/http-bbb.mjs",
              manifestKey: "https://esm.sh/child@1",
              sourcePath: "/tmp/veryfront-http-bundle/http-bbb.mjs",
              code: "export default function child() {}",
            },
          ],
        })
      ),
    };

    await runReleaseAssetBuild(input, await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const parentHash = manifest.dependencies["https://esm.sh/parent@1"]?.contentHash;
    const childHash = manifest.dependencies["https://esm.sh/child@1"]?.contentHash;
    assertExists(parentHash);
    assertExists(childHash);

    const parentUpload = rec.uploads.find((u) => u.hash === parentHash);
    assertExists(parentUpload);
    assert(parentUpload.text.includes(`"/_vf/assets/${childHash}.js"`));
    assert(!parentUpload.text.includes("./http-bbb.mjs"));
  });

  it("resolves vendored dependency relatives from their source file path", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import a from "remote-a"; import b from "remote-b"; export default [a, b];',
      },
    ];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import a from "https://esm.sh/a@1"; import b from "https://esm.sh/b@1"; export default [a, b];',
      );
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code
            .replace("https://esm.sh/a@1", "file:///tmp/vf-http/a/parent.mjs")
            .replace("https://esm.sh/b@1", "file:///tmp/vf-http/b/parent.mjs"),
          dependencies: [
            {
              specifier: "file:///tmp/vf-http/a/parent.mjs",
              manifestKey: "https://esm.sh/a@1",
              sourcePath: "/tmp/vf-http/a/parent.mjs",
              code: 'import shared from "./shared.mjs"; export default shared;',
            },
            {
              specifier: "file:///tmp/vf-http/a/shared.mjs",
              manifestKey: "https://esm.sh/a-shared@1",
              sourcePath: "/tmp/vf-http/a/shared.mjs",
              code: 'export default "a";',
            },
            {
              specifier: "file:///tmp/vf-http/b/parent.mjs",
              manifestKey: "https://esm.sh/b@1",
              sourcePath: "/tmp/vf-http/b/parent.mjs",
              code: 'import shared from "./shared.mjs"; export default shared;',
            },
            {
              specifier: "file:///tmp/vf-http/b/shared.mjs",
              manifestKey: "https://esm.sh/b-shared@1",
              sourcePath: "/tmp/vf-http/b/shared.mjs",
              code: 'export default "b";',
            },
          ],
        })
      ),
    };

    await runReleaseAssetBuild(input, await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const aParentHash = manifest.dependencies["https://esm.sh/a@1"]?.contentHash;
    const aSharedHash = manifest.dependencies["https://esm.sh/a-shared@1"]?.contentHash;
    const bParentHash = manifest.dependencies["https://esm.sh/b@1"]?.contentHash;
    const bSharedHash = manifest.dependencies["https://esm.sh/b-shared@1"]?.contentHash;
    assertExists(aParentHash);
    assertExists(aSharedHash);
    assertExists(bParentHash);
    assertExists(bSharedHash);

    const aParentUpload = rec.uploads.find((u) => u.hash === aParentHash);
    const bParentUpload = rec.uploads.find((u) => u.hash === bParentHash);
    assertExists(aParentUpload);
    assertExists(bParentUpload);
    assert(aParentUpload.text.includes(`"/_vf/assets/${aSharedHash}.js"`));
    assert(!aParentUpload.text.includes(`"/_vf/assets/${bSharedHash}.js"`));
    assert(bParentUpload.text.includes(`"/_vf/assets/${bSharedHash}.js"`));
    assert(!bParentUpload.text.includes(`"/_vf/assets/${aSharedHash}.js"`));
  });

  it("falls back to source URLs when vendored dependency assets contain a cycle", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import parent from "remote-parent"; export default parent;',
      },
    ];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import parent from "https://esm.sh/parent@1"; export default parent;',
      );
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code.replace(
            "https://esm.sh/parent@1",
            "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
          ),
          dependencies: [
            {
              specifier: "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
              manifestKey: "https://esm.sh/parent@1",
              sourcePath: "/tmp/veryfront-http-bundle/http-aaa.mjs",
              code: 'import child from "./http-bbb.mjs"; export default child;',
            },
            {
              specifier: "file:///tmp/veryfront-http-bundle/http-bbb.mjs",
              manifestKey: "https://esm.sh/child@1",
              sourcePath: "/tmp/veryfront-http-bundle/http-bbb.mjs",
              code: 'import parent from "./http-aaa.mjs"; export default parent;',
            },
          ],
        })
      ),
    };

    const result = await runReleaseAssetBuild(input, await tmp());

    assertEquals(result.success, true);
    assertEquals(result.state, "ready");
    assert(result.gaps.some((gap) => gap.startsWith("dependency-cycle:")));

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.dependencies["https://esm.sh/parent@1"], undefined);
    assertEquals(manifest.dependencies["https://esm.sh/child@1"], undefined);

    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);
    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(pageUpload.text.includes('"https://esm.sh/parent@1"'));
    assert(!pageUpload.text.includes("file:///tmp/veryfront-http-bundle"));
    assertEquals(rec.states.find((state) => state.state === "failed"), undefined);
  });

  it("fails the manifest when a vendored dependency keeps an unresolved file import", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import parent from "remote-parent"; export default parent;',
      },
    ];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import parent from "https://esm.sh/parent@1"; export default parent;',
      );
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code.replace(
            "https://esm.sh/parent@1",
            "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
          ),
          dependencies: [{
            specifier: "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
            manifestKey: "https://esm.sh/parent@1",
            sourcePath: "/tmp/veryfront-http-bundle/http-aaa.mjs",
            code: 'import secret from "file:///tmp/outside-secret.mjs"; export default secret;',
          }],
        })
      ),
    };

    const result = await runReleaseAssetBuild(input, await tmp());

    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assert(result.error?.includes("Unresolved vendored file dependency"));
    assertEquals(rec.states.at(-1)?.state, "failed");
    assertEquals(rec.manifest, null);
  });

  it("fails the manifest when a vendored dependency asset exceeds the size limit", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import parent from "remote-parent"; export default parent;',
      },
    ];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import parent from "https://esm.sh/parent@1"; export default parent;',
      );
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code.replace(
            "https://esm.sh/parent@1",
            "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
          ),
          dependencies: [{
            specifier: "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
            manifestKey: "https://esm.sh/parent@1",
            sourcePath: "/tmp/veryfront-http-bundle/http-aaa.mjs",
            code: "x".repeat(RELEASE_ASSET_MAX_SIZE_BYTES + 1),
          }],
        })
      ),
    };

    const result = await runReleaseAssetBuild(input, await tmp());

    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assert(result.error?.includes("exceeds release asset size limit"));
    assertEquals(rec.states.at(-1)?.state, "failed");
    assertEquals(rec.manifest, null);
    assertEquals(rec.uploads.length, 0);
  });

  it("rewrites transformed relative project imports to immutable asset URLs", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import Hero from "../components/sections/HeroSection.tsx"; export default Hero;',
      },
      {
        path: "components/sections/HeroSection.tsx",
        content: 'import Button from "../elements/Button.tsx"; export default Button;',
      },
      {
        path: "components/elements/Button.tsx",
        content: "export default function Button() { return null; }",
      },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve(
          'import Hero from "/_vf_modules/components/sections/HeroSection.js"; export default Hero;',
        );
      }
      if (sourceFile.endsWith("components/sections/HeroSection.tsx")) {
        return Promise.resolve(
          'import Button from "../../components/elements/Button.js"; export default Button;',
        );
      }
      return Promise.resolve("export default function Button() { return null; }");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const buttonHash = manifest.modules["components/elements/Button.tsx"]?.contentHash;
    assertExists(buttonHash);
    const heroHash = manifest.modules["components/sections/HeroSection.tsx"]?.contentHash;
    assertExists(heroHash);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);

    const heroUpload = rec.uploads.find((u) => u.hash === heroHash);
    assertExists(heroUpload);
    assert(heroUpload.text.includes(`"/_vf/assets/${buttonHash}.js"`));
    assert(!heroUpload.text.includes("../../components/elements/Button.js"));

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(pageUpload.text.includes(`"/_vf/assets/${heroHash}.js"`));
    assert(!pageUpload.text.includes("/_vf_modules/components/sections/HeroSection.js"));
  });

  it("rewrites transformed root project imports to immutable asset URLs", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "pages/index.tsx", content: 'import Button from "../components/Button.tsx";' },
      { path: "components/Button.tsx", content: "export const Button = () => null;" },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve('import { Button } from "/components/Button.js"; Button();');
      }
      return Promise.resolve("export const Button = () => null;");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const buttonHash = manifest.modules["components/Button.tsx"]?.contentHash;
    assertExists(buttonHash);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(pageUpload.text.includes(`"/_vf/assets/${buttonHash}.js"`));
    assert(!pageUpload.text.includes("/components/Button.js"));
  });

  it("does not rewrite import-like strings or comments in transformed modules", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "pages/index.tsx", content: "export default function Page() { return null; }" },
      { path: "components/Button.tsx", content: "export const Button = () => null;" },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve([
          "const sample = 'import { Button } from \"/components/Button.js\"';",
          '// import { Button } from "/components/Button.js"',
          "export default function Page() { return sample; }",
        ].join("\n"));
      }
      return Promise.resolve("export const Button = () => null;");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const buttonHash = manifest.modules["components/Button.tsx"]?.contentHash;
    assertExists(buttonHash);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(
      pageUpload.text.includes(
        "const sample = 'import { Button } from \"/components/Button.js\"';",
      ),
    );
    assert(pageUpload.text.includes('// import { Button } from "/components/Button.js"'));
    assert(!pageUpload.text.includes(`/_vf/assets/${buttonHash}.js`));
  });

  it("keeps framework module imports on the module-server path", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import { useWorkflow } from "veryfront/workflow"; export default useWorkflow;',
      },
    ];
    const client = makeClient(files, rec);
    const frameworkUrl = "/_vf_modules/_veryfront/workflow/react/index.js";
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve(
          `import { useWorkflow } from "${frameworkUrl}"; export default useWorkflow;`,
        );
      }
      return Promise.resolve("export const useWorkflow = () => null;");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertExists(manifest.dependencies["veryfront/workflow"]);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(pageUpload.text.includes(`"${frameworkUrl}"`));
    assert(
      !pageUpload.text.includes(
        `"/_vf/assets/${manifest.dependencies["veryfront/workflow"]?.contentHash}.js"`,
      ),
    );
  });

  it("keeps cyclic project imports on the JIT fallback path", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "pages/a.tsx", content: 'import B from "../components/B.tsx"; export default B;' },
      { path: "components/B.tsx", content: 'import A from "../pages/a.tsx"; export default A;' },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/a.tsx")) {
        return Promise.resolve('import B from "/_vf_modules/components/B.js"; export default B;');
      }
      return Promise.resolve('import A from "/_vf_modules/pages/a.js"; export default A;');
    };

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assert(result.gaps.includes("cycle:pages/a.tsx->components/B.tsx->pages/a.tsx"));
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.modules["pages/a.tsx"], undefined);
    assertEquals(manifest.modules["components/B.tsx"], undefined);
    assertEquals(manifest.routes["/a"], undefined);
  });

  it("reports failed and does not PUT on a transform error", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "boom" }];
    const client = makeClient(files, rec);
    const transform = () => Promise.reject(new Error("bad syntax in /secret/path.tsx"));

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assertEquals(rec.manifest, null);
    assertEquals(rec.states.length, 1);
    assertEquals(rec.states[0]?.state, "failed");
    // Error is sanitized — no raw filesystem path leaks.
    assert(!(rec.states[0]?.error ?? "").includes("/secret/path.tsx"));
  });

  it("dedupes identical transformed bytes into a single upload", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "pages/a.tsx", content: "same" },
      { path: "pages/b.tsx", content: "same" },
    ];
    const client = makeClient(files, rec);
    const transform = () => Promise.resolve("IDENTICAL");

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.moduleCount, 2);
    // Same bytes → same hash → one upload.
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const moduleHashes = new Set(Object.values(manifest.modules).map((entry) => entry.contentHash));
    assertEquals(rec.uploads.filter((upload) => moduleHashes.has(upload.hash)).length, 1);
  });

  it("includes compiled CSS when a css pipeline is provided", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{
      path: "pages/index.tsx",
      content: 'export default () => "<div class=\\"p-4\\"/>";',
    }];
    const client = makeClient(files, rec, {
      compileProjectCss: () =>
        Promise.resolve({ css: ".p-4{padding:1rem}", styleProfileHash: "sp-1" }),
    });
    const transform = (s: string) => Promise.resolve(s);

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.cssCount, 1);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.css[0]?.styleProfileHash, "sp-1");
    assertEquals(manifest.css[0]?.contentType, "text/css");
    // The route entry must carry the compiled CSS hash (project-level CSS is
    // applied to every route per the executor contract).
    const cssHash = manifest.css[0]?.contentHash;
    assertExists(cssHash);
    assertEquals(manifest.routes["/"]?.css, [cssHash]);
  });

  it("records css:compile-failed when the compiler returns null", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{
      path: "pages/index.tsx",
      content: 'export default () => "<div class=\\"p-4\\"/>";',
    }];
    const client = makeClient(files, rec, {
      compileProjectCss: () => Promise.resolve(null),
    });
    const transform = (s: string) => Promise.resolve(s);

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.cssCount, 0);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.css.length, 0);
    assert(manifest.fallback.gaps.includes("css:compile-failed"), "null compile records gap");
  });

  it("passes the resolved stylesheet to compileProjectCss", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "globals.css", content: '@import "tailwindcss"; /* custom */' },
      {
        path: "pages/index.tsx",
        content: 'export default () => "<div class=\\"p-4\\"/>";',
      },
    ];
    let seenStylesheet: string | undefined = "UNSET";
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve({ css: ".p-4{padding:1rem}", styleProfileHash: "sp-1" });
      },
    });
    const transform = (s: string) => Promise.resolve(s);

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(seenStylesheet, '@import "tailwindcss"; /* custom */');
  });

  it("passes helper-composed Tailwind candidates to compileProjectCss", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "components/Header.tsx",
        content: `
          const navClass = "h-16 md:h-[4.5rem] lg:h-[5rem]";
          export function Header() {
            return <header className={navClass} />;
          }
        `,
      },
      {
        path: "pages/index.tsx",
        content: 'import { Header } from "../components/Header.tsx"; export default Header;',
      },
    ];
    let seenCandidates: Set<string> | null = null;
    const client = makeClient(files, rec, {
      compileProjectCss: (candidates) => {
        seenCandidates = new Set(candidates);
        return Promise.resolve({ css: ".h-16{height:4rem}", styleProfileHash: "sp-1" });
      },
    });
    const transform = (s: string) => Promise.resolve(s);

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertExists(seenCandidates);
    const candidates = seenCandidates as Set<string>;
    assert(candidates.has("h-16"));
    assert(candidates.has("md:h-[4.5rem]"));
    assert(candidates.has("lg:h-[5rem]"));
  });

  // B2: route closure includes transitive imports, not just page entrypoint.
  it("includes transitive imports in route closure (B2)", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    // Relative imports are resolved from the importing module's directory, so
    // pages/index.tsx uses "../components/Button.tsx" to reach components/.
    const files2 = [
      {
        path: "pages/index.tsx",
        content: 'import Button from "../components/Button.tsx"; export default () => null;',
      },
      {
        path: "components/Button.tsx",
        content: 'import Icon from "./Icon.tsx"; export default () => null;',
      },
      { path: "components/Icon.tsx", content: "export default () => null;" },
    ];
    const client = makeClient(files2, rec);
    const transform = (s: string) => Promise.resolve(s);

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);

    const routeModules = manifest.routes["/"]?.modules ?? [];
    // Must include all three modules, not just the page entrypoint.
    assert(routeModules.includes("pages/index.tsx"), "page entrypoint in route modules");
    assert(routeModules.includes("components/Button.tsx"), "Button.tsx in route closure");
    assert(routeModules.includes("components/Icon.tsx"), "Icon.tsx in route closure");
  });

  // Project-root alias (@/) and extensionless imports must join the closure
  // (mirrors transforms/esm/path-resolver.ts alias semantics).
  it("resolves @/ alias and extensionless imports into route closure", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files2 = [
      {
        path: "pages/index.tsx",
        content: 'import App from "@/components/app"; export default () => null;',
      },
      {
        path: "components/app.tsx",
        content: 'import { util } from "../lib/utils"; export default () => null;',
      },
      { path: "lib/utils.ts", content: "export const util = 1;" },
    ];
    const client = makeClient(files2, rec);
    const transform = (s: string) => Promise.resolve(s);

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);

    const routeModules = manifest.routes["/"]?.modules ?? [];
    assert(routeModules.includes("pages/index.tsx"), "page entrypoint in route modules");
    assert(routeModules.includes("components/app.tsx"), "@/ alias import in route closure");
    assert(routeModules.includes("lib/utils.ts"), "extensionless transitive import in closure");
  });

  // H1: non-transform failures (e.g., listAllReleaseFiles throws) report failed.
  it("reports failed on non-transform build failure (H1)", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient([], rec, {
      listAllReleaseFiles: () => Promise.reject(new Error("network error in /internal/path")),
    });
    const transform = (s: string) => Promise.resolve(s);

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assertEquals(rec.manifest, null);
    assertEquals(rec.states.length, 1);
    assertEquals(rec.states[0]?.state, "failed");
    // Error is sanitized.
    assert(!(rec.states[0]?.error ?? "").includes("/internal/path"));
  });

  // H1: PUT failure also reports failed.
  it("reports failed when putReleaseAssetManifest throws (H1)", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec, {
      putReleaseAssetManifest: () => Promise.reject(new Error("PUT failed /secret")),
    });
    const transform = (s: string) => Promise.resolve(s);

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assertEquals(rec.states.length, 1);
    assertEquals(rec.states[0]?.state, "failed");
    assert(!(rec.states[0]?.error ?? "").includes("/secret"));
  });

  // H2: manifestVersion from begin is used in the manifest body.
  it("uses manifest_version from beginReleaseAssetManifestBuild (H2)", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec, {
      beginReleaseAssetManifestBuild: () => {
        rec.began = true;
        return Promise.resolve({ id: "b2", manifest_version: 42, state: "building" });
      },
      putReleaseAssetManifest: (_v, manifest) => {
        rec.manifest = manifest;
        return Promise.resolve({ state: "ready", manifest_version: 42 });
      },
    });
    const transform = (s: string) => Promise.resolve(s);

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.manifestVersion, 42);
  });

  // M2: modules exceeding the 10 MB limit are skipped with a gap.
  it("skips oversized modules with a gap instead of uploading (M2)", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec);
    // Return a string > 10 MB (10 * 1024 * 1024 + 1 bytes).
    const bigCode = "x".repeat(10 * 1024 * 1024 + 1);
    const transform = () => Promise.resolve(bigCode);

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    // Module is skipped — not uploaded as a page asset, not in manifest modules.
    assertEquals(Object.keys(manifest.modules).length, 0);
    // Gap is recorded.
    assert(result.gaps.some((g) => g.startsWith("oversized:")));
  });

  // L3: nested index route derivation.
  it("routeForPage derives nested index routes correctly (L3)", () => {
    assertEquals(routeForPage("pages/index.tsx"), "/");
    assertEquals(routeForPage("pages/about.tsx"), "/about");
    assertEquals(routeForPage("pages/blog/index.tsx"), "/blog");
    assertEquals(routeForPage("pages/blog/post.tsx"), "/blog/post");
    assertEquals(routeForPage("pages/a/b/index.tsx"), "/a/b");
    assertEquals(routeForPage("components/Button.tsx"), null);
  });
});

// B1: Two adapters with different releaseIds must each use the right fetcher.
describe("manifest fetcher registry (B1 multi-project isolation)", () => {
  it("each releaseId fetcher is registered and invoked independently", async () => {
    const { registerManifestFetcherForRelease, clearReleaseAssetManifestCache } = await import(
      "./manifest-cache.ts"
    );

    const calls: string[] = [];
    registerManifestFetcherForRelease("rel-A", async () => {
      calls.push("fetcher-A");
      return null;
    });
    registerManifestFetcherForRelease("rel-B", async () => {
      calls.push("fetcher-B");
      return null;
    });

    // Simulate enabling the flag and triggering fetches.
    const origEnv = Deno.env.get("VERYFRONT_RELEASE_ASSET_MANIFEST");
    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");

    const { getReadyManifestForRender } = await import("./manifest-cache.ts");
    getReadyManifestForRender("rel-A");
    getReadyManifestForRender("rel-B");

    // Allow the background fetches to fire.
    await new Promise((r) => setTimeout(r, 10));

    // Each releaseId must have triggered its own fetcher (not the other's).
    assert(calls.includes("fetcher-A"), "fetcher-A was called for rel-A");
    assert(calls.includes("fetcher-B"), "fetcher-B was called for rel-B");
    // fetcher-A must not have been called for rel-B and vice versa.
    assertEquals(calls.filter((c) => c === "fetcher-A").length, 1);
    assertEquals(calls.filter((c) => c === "fetcher-B").length, 1);

    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", origEnv ?? "");
    clearReleaseAssetManifestCache();
  });
});
