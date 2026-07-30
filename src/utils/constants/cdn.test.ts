import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DEFAULT_ALLOWED_CDN_HOSTS,
  DENO_STD_BASE,
  getDenoStdNodeBase,
  MERMAID_ESM_URL,
  MERMAID_VERSION,
  REACT_DEFAULT_VERSION,
} from "./cdn.ts";
import { DEFAULT_REACT_VERSION } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import {
  ESM_SH_BUILD_PIN,
  FRAMEWORK_BROWSER_DEPENDENCY_VERSIONS,
  getFrameworkWorkspaceDependencyUrl,
} from "#veryfront/transforms/import-rewriter/framework-dependencies.ts";

interface ReactWorkspaceImports {
  imports?: Record<string, string>;
}

async function readReactWorkspaceImports(): Promise<Record<string, string>> {
  const url = new URL("../../../react/deno.json", import.meta.url);
  const config = JSON.parse(
    await Deno.readTextFile(url),
  ) as ReactWorkspaceImports;
  return config.imports ?? {};
}

/**
 * Read the React version veryfront's build bundles from `react/deno.json`.
 * The build generates the framework React re-export (`esm/react/react.js`)
 * and its esm.sh shim against this exact version, so the runtime defaults
 * must match it — otherwise the re-export references named exports (e.g.
 * `Activity`, a React 19.2 API) that an older esm.sh bundle does not provide,
 * producing a hard SSR module-link error.
 */
async function buildReactVersion(): Promise<string> {
  const reactImport = (await readReactWorkspaceImports()).react ?? "";
  const match = reactImport.match(/react@(\d+\.\d+\.\d+)/);
  if (!match) throw new Error(`Could not parse react version from "${reactImport}"`);
  return match[1]!;
}

async function buildMermaidUrl(): Promise<string> {
  const mermaidImport = (await readReactWorkspaceImports())["@veryfront/mermaid-upstream"] ?? "";
  if (!mermaidImport) {
    throw new Error("react/deno.json does not define the Mermaid upstream");
  }
  return mermaidImport;
}

describe("constants/cdn — React default version drift guard", () => {
  it("REACT_DEFAULT_VERSION matches the version the build bundles (react/deno.json)", async () => {
    assertEquals(REACT_DEFAULT_VERSION, await buildReactVersion());
  });

  it("DEFAULT_REACT_VERSION (url-builder) matches the build's React version", async () => {
    assertEquals(DEFAULT_REACT_VERSION, await buildReactVersion());
  });

  it("the two React default constants agree with each other", () => {
    assertEquals(REACT_DEFAULT_VERSION, DEFAULT_REACT_VERSION);
  });
});

describe("constants/cdn — Mermaid dependency drift guard", () => {
  it("standalone previews use the exact package-audited Mermaid URL", async () => {
    assertEquals(MERMAID_ESM_URL, await buildMermaidUrl());
  });

  it("all browser-owned versions and esm.sh pins match react/deno.json", async () => {
    const imports = await readReactWorkspaceImports();
    for (
      const [packageName, version] of Object.entries(
        FRAMEWORK_BROWSER_DEPENDENCY_VERSIONS,
      )
    ) {
      const target = imports[`@veryfront/${packageName}-upstream`];
      if (!target) {
        throw new Error(
          `react/deno.json does not define ${packageName} upstream`,
        );
      }
      const url = new URL(target);
      assertEquals(url.pathname, `/${packageName}@${version}`, packageName);
      assertEquals(
        url.searchParams.get("pin"),
        ESM_SH_BUILD_PIN,
        packageName,
      );
      assertEquals(
        target,
        getFrameworkWorkspaceDependencyUrl(packageName),
        packageName,
      );
    }
  });

  it("the shared URL contains the declared exact version", () => {
    assertEquals(
      new URL(MERMAID_ESM_URL).pathname,
      `/mermaid@${MERMAID_VERSION}`,
    );
  });
});

describe("constants/cdn", () => {
  it("preserves the mutable public default-host array contract", () => {
    const mutableHosts: string[] = DEFAULT_ALLOWED_CDN_HOSTS;
    assertEquals(Object.isFrozen(mutableHosts), false);
  });

  describe("getDenoStdNodeBase", () => {
    it("should return a URL starting with DENO_STD_BASE", () => {
      const url = getDenoStdNodeBase();
      assertEquals(url.startsWith(DENO_STD_BASE), true);
    });

    it("should include /node path", () => {
      const url = getDenoStdNodeBase();
      assertEquals(url.endsWith("/node"), true);
    });

    it("should include std@ version", () => {
      const url = getDenoStdNodeBase();
      assertEquals(url.includes("/std@"), true);
    });
  });
});
