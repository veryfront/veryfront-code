import { readProjectDependencyVersions } from "#veryfront/transforms/esm/package-registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureLocalReactPeers,
  clearReactPathsCache,
  getLocalReactPaths,
} from "#veryfront/platform/compat/react-paths.ts";
import { isBun, isNode } from "#veryfront/platform/compat/runtime.ts";
import { createRequire } from "node:module";
import Module from "node:module";
import fs, { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveInstalledReactRange } from "#veryfront/platform/compat/react-paths.ts";
import {
  resolveProjectPackageVersions,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
import { getLocalReactPath } from "#veryfront/platform/compat/react-paths.ts";

function overrideInstalledVersion(
  packageName: string,
  version: string,
  identity?: string,
): () => void {
  const syncBuiltinESMExports = Reflect.get(Module, "syncBuiltinESMExports") as () => void;
  const original = fs.readFileSync;
  fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
    const content = Reflect.apply(original, fs, args);
    if (String(args[0]).endsWith(`/${packageName}/package.json`)) {
      const manifest = JSON.parse(String(content));
      manifest.version = version;
      if (identity !== undefined) manifest.name = identity;
      return JSON.stringify(manifest);
    }
    return content;
  }) as typeof fs.readFileSync;
  syncBuiltinESMExports();
  return () => {
    fs.readFileSync = original;
    syncBuiltinESMExports();
  };
}

describe("react-paths", () => {
  it("renders an adapter-backed script without a supplied cache identity", async () => {
    if (!isNode && !isBun) return;
    const { handleScriptPage } = await import("#veryfront/rendering/script-page-handling.ts");
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const adapter = createMockAdapter();
    adapter.fs.files.set(
      "/virtual-script/page.js",
      'export default () => "<main>virtual script</main>";',
    );
    const rendered = await handleScriptPage(
      { entity: { path: "/virtual-script/page.js", frontmatter: {} } } as never,
      "page",
      {
        mode: "production",
        projectDir: "/virtual-script",
        adapter,
        config: {},
        dependencyPinningCacheKey: "off",
      },
    );
    assertEquals(rendered.html.includes("virtual script"), true);
  });

  it("preserves native addons and configured native module identity in script pages", async () => {
    if (!isNode) return;
    const { handleScriptPage } = await import("#veryfront/rendering/script-page-handling.ts");
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const { pathToFileURL } = await import("node:url");
    const directory = mkdtempSync(join(tmpdir(), "script-native-deps-"));
    const adapter = createMockAdapter();
    const addon = join(directory, "node_modules", "native-addon");
    const external = join(directory, "node_modules", "keep-native");
    fs.mkdirSync(addon, { recursive: true });
    fs.mkdirSync(external, { recursive: true });
    fs.writeFileSync(join(directory, "package.json"), '{"type":"module"}');
    fs.writeFileSync(join(addon, "package.json"), '{"name":"native-addon","main":"index.cjs"}');
    fs.writeFileSync(join(addon, "index.cjs"), 'module.exports = require("./binding.node");');
    fs.writeFileSync(join(addon, "binding.node"), "test native boundary");
    fs.writeFileSync(
      join(external, "package.json"),
      '{"name":"keep-native","type":"module","exports":"./index.js"}',
    );
    fs.writeFileSync(join(external, "index.js"), "export const marker = {};");
    const source =
      'import addon from "native-addon"; import { marker } from "keep-native"; export default () => "<main>" + addon.value + "|" + (marker === globalThis.__scriptNativeMarker) + "</main>";';
    const pagePath = join(directory, "page.js");
    fs.writeFileSync(pagePath, source);
    const original = process.dlopen;
    const globalState = globalThis as Record<string, unknown>;
    try {
      globalState.__scriptNativeMarker =
        (await import(pathToFileURL(join(external, "index.js")).href)).marker;
      process.dlopen = ((module: { exports: unknown }, filename: string) => {
        assertEquals(filename.endsWith("binding.node"), true);
        module.exports = { value: "native-addon" };
      }) as typeof process.dlopen;
      const render = () =>
        handleScriptPage(
          { entity: { path: pagePath, frontmatter: {} } } as never,
          "page",
          {
            mode: "production",
            projectDir: directory,
            adapter,
            reactPeers: captureLocalReactPeers(),
            config: { build: { serverExternalPackages: ["keep-native"] } },
            dependencyPinningCacheKey: "off",
          },
        );
      const rendered = await render();
      assertEquals(rendered.html.includes("<main>native-addon|true</main>"), true);
      fs.writeFileSync(join(external, "replacement.js"), "export const marker = {};");
      globalState.__scriptNativeMarker =
        (await import(pathToFileURL(join(external, "replacement.js")).href)).marker;
      fs.writeFileSync(
        join(external, "package.json"),
        '{"name":"keep-native","type":"module","exports":"./replacement.js"}',
      );
      assertEquals(
        (await render()).html.includes("<main>native-addon|true</main>"),
        true,
        "changed external exports resolve the new native module",
      );
    } finally {
      process.dlopen = original;
      delete globalState.__scriptNativeMarker;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  for (const nested of [false, true]) {
    it(`coalesces production script compilation with nested resolution ${nested}`, async () => {
      if (!isNode && !isBun) return;
      const { handleScriptPage } = await import("#veryfront/rendering/script-page-handling.ts");
      const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
      const { getBundler } = await import("veryfront/extensions/bundler");
      const bundler = getBundler();
      const original = bundler.bundle;
      let builds = 0;
      bundler.bundle = (options) => {
        builds++;
        return original.call(bundler, options);
      };
      const directory = mkdtempSync(join(tmpdir(), "script-compilation-"));
      const page = join(directory, "page.js");
      const child = nested
        ? join(directory, "components", "button", "index.js")
        : join(directory, "child");
      const source = `import { value } from "${
        nested ? "./components/button" : "./child"
      }"; export default () => "<main>" + value + "</main>";`;
      fs.writeFileSync(join(directory, "package.json"), '{"type":"module"}');
      fs.writeFileSync(page, source);
      fs.mkdirSync(dirname(child), { recursive: true });
      fs.writeFileSync(child, 'export const value = "first";');
      const options = {
        mode: "production",
        projectDir: directory,
        adapter: createMockAdapter(),
        config: {},
        reactPeers: captureLocalReactPeers(),
      };
      const render = () =>
        handleScriptPage({ entity: { path: page, frontmatter: {} } } as never, "page", options);
      try {
        const initial = await Promise.all([render(), render(), render()]);
        assertEquals(initial.every((result) => result.html.includes("<main>first</main>")), true);
        assertEquals(builds, 1, "concurrent requests share compilation");
        await render();
        assertEquals(builds, 1, "unchanged graph skips compilation");
        fs.writeFileSync(child, 'export const value = "second";');
        const changed = await Promise.all([render(), render()]);
        assertEquals(changed.every((result) => result.html.includes("<main>second</main>")), true);
        assertEquals(builds, 2, "changed dependency rebuilds once");
        fs.writeFileSync(child, "export const value = ;");
        await assertRejects(render);
        fs.writeFileSync(child, 'export const value = "recovered";');
        assertEquals((await render()).html.includes("<main>recovered</main>"), true);
        assertEquals(builds, 4, "failed compilation does not poison its retry");
        if (nested) {
          fs.writeFileSync(
            join(directory, "components", "button.ts"),
            'export const value = "preferred";',
          );
          assertEquals((await render()).html.includes("<main>preferred</main>"), true);
          assertEquals(builds, 5, "new higher-priority siblings invalidate directory resolution");
        }
      } finally {
        bundler.bundle = original;
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  for (const nested of [false, true]) {
    it(`refreshes script dependencies with a nested symlink ${nested}`, async () => {
      if (!isNode && !isBun) return;
      const { handleScriptPage } = await import("#veryfront/rendering/script-page-handling.ts");
      const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
      const directory = mkdtempSync(join(tmpdir(), "script-project-link-"));
      const project = join(directory, "project");
      const current = nested ? join(project, "components", "current") : join(directory, "current");
      if (nested) {
        fs.mkdirSync(dirname(current), { recursive: true });
        fs.writeFileSync(join(project, "package.json"), '{"type":"module"}');
        fs.writeFileSync(
          join(project, "page.js"),
          'import { value } from "./components/current/child.js"; export default () => "<main>" + value + "</main>";',
        );
      }
      for (const release of ["first", "second"]) {
        const folder = join(directory, release);
        fs.mkdirSync(folder);
        fs.writeFileSync(join(folder, "package.json"), '{"type":"module"}');
        fs.writeFileSync(
          join(folder, "page.js"),
          'import { value } from "./child.js"; export default () => "<main>" + value + "</main>";',
        );
        fs.writeFileSync(join(folder, "child.js"), `export const value = "${release}";`);
      }
      const options = {
        mode: "production",
        projectDir: nested ? project : current,
        adapter: createMockAdapter(),
        config: {},
        reactPeers: captureLocalReactPeers(),
      };
      const render = () =>
        handleScriptPage(
          {
            entity: { path: join(nested ? project : current, "page.js"), frontmatter: {} },
          } as never,
          "page",
          options,
        );
      try {
        fs.symlinkSync(join(directory, "first"), current, "dir");
        assertEquals((await render()).html.includes("<main>first</main>"), true);
        fs.unlinkSync(current);
        fs.symlinkSync(join(directory, "second"), current, "dir");
        assertEquals((await render()).html.includes("<main>second</main>"), true);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  it("refreshes script compiler configuration and scoped package resolution", async () => {
    if (!isNode && !isBun) return;
    const { handleScriptPage } = await import("#veryfront/rendering/script-page-handling.ts");
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const directory = mkdtempSync(join(tmpdir(), "script-resolution-"));
    const put = (path: string, contents: string) => {
      const target = join(directory, path);
      fs.mkdirSync(dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    };
    const options = {
      mode: "production",
      projectDir: directory,
      adapter: createMockAdapter(),
      config: {},
      reactPeers: captureLocalReactPeers(),
    };
    const render = (path: string) =>
      handleScriptPage(
        { entity: { path: join(directory, path), frontmatter: {} } } as never,
        "page",
        options,
      );
    try {
      put("package.json", '{"type":"module"}');
      put(
        "page.js",
        'import { value } from "alias"; export default () => "<main>" + value + "</main>";',
      );
      put("first.js", 'export const value = "first";');
      put("second.js", 'export const value = "second";');
      put("tsconfig.json", '{"compilerOptions":{"baseUrl":".","paths":{"alias":["./first.js"]}}}');
      assertEquals((await render("page.js")).html.includes("<main>first</main>"), true);
      put("tsconfig.json", '{"compilerOptions":{"baseUrl":".","paths":{"alias":["./second.js"]}}}');
      assertEquals((await render("page.js")).html.includes("<main>second</main>"), true);
      fs.unlinkSync(join(directory, "tsconfig.json"));
      options.projectDir = join(directory, "sub", "project");
      put(
        "sub/project/page.js",
        'import { value } from "@scope/pkg"; export default () => "<main>" + value + "</main>";',
      );
      put("node_modules/@scope/pkg/package.json", '{"main":"index.js"}');
      put("node_modules/@scope/pkg/tsconfig.json", '{"extends":"./development-only-missing.json"}');
      put("node_modules/@scope/pkg/index.js", 'exports.value = "parent";');
      put("sub/node_modules/@scope/other/package.json", "{}");
      assertEquals(
        (await render("sub/project/page.js")).html.includes("<main>parent</main>"),
        true,
      );
      fs.unlinkSync(join(directory, "node_modules/@scope/pkg/tsconfig.json"));
      assertEquals(
        (await render("sub/project/page.js")).html.includes("<main>parent</main>"),
        true,
      );
      put("sub/node_modules/@scope/pkg/package.json", '{"main":"index.js"}');
      put("sub/node_modules/@scope/pkg/index.js", 'exports.value = "closer";');
      assertEquals(
        (await render("sub/project/page.js")).html.includes("<main>closer</main>"),
        true,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  for (
    const kind of [
      "require.resolve",
      "dynamic import",
      "CommonJS dynamic import",
      "glob dynamic import",
    ]
  ) {
    it(`preserves dependency issuers for ${kind}`, async () => {
      if (!isNode && !isBun) return;
      const { handleScriptPage } = await import("#veryfront/rendering/script-page-handling.ts");
      const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
      const directory = mkdtempSync(join(tmpdir(), "script-issuer-"));
      const adapter = createMockAdapter();
      const page = join(directory, "page.js");
      const child = join(
        directory,
        "lib",
        kind.includes("CommonJS") || kind === "require.resolve" ? "helper.cjs" : "helper.js",
      );
      fs.mkdirSync(join(directory, "lib"));
      fs.writeFileSync(join(directory, "package.json"), '{"type":"module"}');
      fs.writeFileSync(join(directory, "lib", "asset.txt"), "child asset");
      fs.writeFileSync(join(directory, "lib", "value.js"), 'export default "child import";');
      fs.mkdirSync(join(directory, "lib", "views"));
      fs.writeFileSync(
        join(directory, "lib", "views", "value.tsx"),
        "export default <span>child import</span>;",
      );
      fs.writeFileSync(
        child,
        kind === "require.resolve"
          ? 'module.exports = () => require("node:fs").readFileSync(require.resolve("./asset.txt"), "utf8");'
          : kind === "glob dynamic import"
          ? 'export default async () => { const name = "value"; return (await import(`./views/${name}.tsx`)).default.props.children; };'
          : `${
            kind === "dynamic import" ? "export default" : "module.exports ="
          } async () => { let path = "./value.js"; const target = { toString: () => path }; const pending = import(target); path = "./missing.js"; const invalid = Symbol(); await import(invalid).then(() => { throw new Error("expected rejection"); }, () => {}); return (await pending).default; };`,
      );
      const source = `import child from "./lib/${
        kind.includes("CommonJS") || kind === "require.resolve" ? "helper.cjs" : "helper.js"
      }"; export default async () => "<main>" + await child() + "</main>";`;
      fs.writeFileSync(page, source);
      adapter.fs.files.set(page, source);
      try {
        const rendered = await handleScriptPage(
          { entity: { path: page, frontmatter: {} } } as never,
          "page",
          {
            mode: "production",
            projectDir: directory,
            adapter,
            config: {},
            reactPeers: captureLocalReactPeers(),
          },
        );
        assertEquals(
          rendered.html.includes(
            kind === "require.resolve" ? "<main>child asset</main>" : "<main>child import</main>",
          ),
          true,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  it("preserves source-relative assets in local scripts and their dependencies", async () => {
    if (!isNode && !isBun) return;
    const { handleScriptPage } = await import("#veryfront/rendering/script-page-handling.ts");
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const directory = mkdtempSync(join(tmpdir(), "script-assets-"));
    const adapter = createMockAdapter();
    const peers = captureLocalReactPeers();
    const { loadModuleFromSource } = await import(
      "#veryfront/modules/react-loader/component-loader.ts"
    );
    const pagePath = join(directory, "page.js");
    const helperPath = join(directory, "helper.js");
    const source =
      'import { readFileSync } from "node:fs"; import { readTemplate } from "./helper.js"; export default () => "<main>" + readFileSync(new URL(import.meta.resolve("./template.html")), "utf8") + "|" + readTemplate() + "</main>";';
    const helper =
      'import { readFileSync } from "node:fs"; export const readTemplate = () => readFileSync(new URL("./template.html", import.meta.url), "utf8");';
    fs.writeFileSync(join(directory, "package.json"), '{"type":"module"}');
    fs.writeFileSync(join(directory, "template.html"), "source asset");
    fs.writeFileSync(pagePath, source);
    fs.writeFileSync(helperPath, helper);
    adapter.fs.files.set(pagePath, source);
    adapter.fs.files.set(helperPath, helper);
    try {
      // Seed ordinary component transforms first: source-location mode must not
      // reuse their cache entries, including entries for imported helpers.
      await loadModuleFromSource(source, pagePath, directory, adapter, {
        dev: false,
        ssr: true,
        mode: "production",
        contentSourceId: "local-assets",
        dependencyPinningCacheKey: "off",
        reactPeers: peers,
        reactVersion: peers.versions.react,
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        const rendered = await handleScriptPage(
          { entity: { path: pagePath, frontmatter: {} } } as never,
          "page",
          {
            mode: "production",
            projectDir: directory,
            adapter,
            config: {},
            reactPeers: peers,
            dependencyPinningCacheKey: "off",
          },
        );
        assertEquals(rendered.html.includes("<main>source asset|source asset</main>"), true);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  for (const fullDocument of [false, true]) {
    it(`keeps script-page imports on admitted peers with full document ${fullDocument}`, async () => {
      if (!isNode && !isBun) return;
      const { PageRenderer } = await import("#veryfront/rendering/page-renderer.ts");
      const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
      const { hashDependencyPins } = await import(
        "#veryfront/transforms/esm/dependency-snapshot.ts"
      );
      const peers = captureLocalReactPeers();
      const directory = mkdtempSync(join(tmpdir(), "script-peer-snapshot-"));
      const adapter = createMockAdapter();
      const pagePath = join(directory, "page.js");
      const html = fullDocument
        ? "<html><head></head><body>script</body></html>"
        : "<main>script</main>";
      const source = `import React from "react"; export default () => ${
        JSON.stringify(html)
      } + React.version;`;
      fs.mkdirSync(join(directory, "node_modules"), { recursive: true });
      assertExists(peers.roots.react);
      fs.symlinkSync(peers.roots.react, join(directory, "node_modules", "react"), "dir");
      fs.writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({ type: "module", dependencies: { react: "^19.2.0" } }),
      );
      fs.writeFileSync(pagePath, source);
      adapter.fs.files.set(pagePath, source);
      adapter.fs.files.set(
        join(directory, "package.json"),
        JSON.stringify({ dependencies: { react: "^19.2.0" } }),
      );
      const renderer = new PageRenderer({
        projectDir: directory,
        mode: "production",
        environment: "production",
        adapter,
        config: { react: { version: "^19.2.0" } },
        componentRegistry: {} as never,
        compileMDX: () => Promise.reject(new Error("not a markdown page")),
      });
      const restoreReact = isNode ? overrideInstalledVersion("react", "19.2.5") : () => {};
      const restoreDom = isNode ? overrideInstalledVersion("react-dom", "19.2.5") : () => {};
      try {
        const result = await renderer.preparePageBundles(
          { entity: { path: pagePath, frontmatter: {} } } as never,
          "script-page",
          undefined,
          {
            reactPeers: peers,
            dependencyPinningCacheKey: fullDocument
              ? `on:${hashDependencyPins({ react: "^19.2.0" })}`
              : "off",
            dependencyPinningDependencies: fullDocument ? { react: "^19.2.0" } : undefined,
          },
        );
        const rendered = result.scriptResult?.html ?? "";
        const match = rendered.match(/<script type="importmap"[^>]*>\s*([\s\S]*?)\s*<\/script>/i);
        assertExists(match?.[1], rendered);
        const imports = JSON.parse(match[1]).imports;
        assertEquals(imports.react.includes(`react@${peers.versions.react}`), true, imports.react);
      } finally {
        restoreDom();
        restoreReact();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  it("keeps script module imports and wrapped/full browser maps on captured peers", async () => {
    if (!isNode && !isBun) return;
    const { handleScriptPage } = await import("#veryfront/rendering/script-page-handling.ts");
    const { nodeAdapter } = await import("#veryfront/platform/adapters/node.ts");
    const directory = mkdtempSync(join(tmpdir(), "vf-script-peers-"));
    const oldReact = join(directory, "old-react.cjs");
    fs.writeFileSync(
      oldReact,
      'exports.version = "19.2.4"; exports.peerMarker = "captured-old";',
    );
    const captured = captureLocalReactPeers();
    const peers = {
      ...captured,
      paths: { ...captured.paths, react: new URL(`file://${oldReact}`).href },
    };
    fs.mkdirSync(join(directory, "node_modules", "react"), { recursive: true });
    fs.writeFileSync(
      join(directory, "node_modules", "react", "package.json"),
      JSON.stringify({ name: "react", version: "19.2.5", type: "module", exports: "./index.js" }),
    );
    fs.writeFileSync(
      join(directory, "node_modules", "react", "index.js"),
      'export const version = "19.2.5";',
    );
    fs.mkdirSync(join(directory, "node_modules", "zod"));
    fs.writeFileSync(
      join(directory, "node_modules", "zod", "package.json"),
      JSON.stringify({
        name: "zod",
        type: "module",
        exports: { import: "./import.js", require: "./require.cjs", default: "./fallback.js" },
      }),
    );
    fs.writeFileSync(
      join(directory, "node_modules", "zod", "import.js"),
      'export const issuer = "project-import";',
    );
    fs.writeFileSync(
      join(directory, "node_modules", "zod", "require.cjs"),
      'exports.issuer = "wrong-require";',
    );
    fs.writeFileSync(
      join(directory, "node_modules", "zod", "fallback.js"),
      'export const issuer = "wrong-default";',
    );
    fs.writeFileSync(join(directory, "entry.txt"), "entry-asset");
    fs.mkdirSync(join(directory, "lib"));
    fs.writeFileSync(join(directory, "lib", "helper.txt"), "child-asset");
    fs.writeFileSync(
      join(directory, "lib", "helper.js"),
      'import { readFileSync } from "fs"; export const childAsset = readFileSync(new URL("./helper.txt", import.meta.url), "utf8");',
    );
    fs.mkdirSync(join(directory, "node_modules", "cjs-lib"));
    fs.writeFileSync(
      join(directory, "node_modules", "cjs-lib", "package.json"),
      JSON.stringify({ name: "cjs-lib", main: "index.cjs" }),
    );
    fs.writeFileSync(
      join(directory, "node_modules", "cjs-lib", "index.cjs"),
      'module.exports = require("node:fs").readFileSync && __filename.endsWith("index.cjs") && __dirname.endsWith("cjs-lib") ? "native-require-" + require("react").peerMarker : "missing";',
    );
    fs.writeFileSync(join(directory, "lib", "value.json"), '{"value":"dependency-issuer"}');
    fs.writeFileSync(
      join(directory, "lib", "dynamic.cjs"),
      'const asset = "./value.json"; const peer = "react"; function local(require) { return require(asset); } module.exports = require(asset).value + "-" + require(peer).peerMarker + "-" + local(() => "shadowed");',
    );
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      for (const full of [false, true]) {
        const path = join(directory, full ? "full.js" : "wrapped.js");
        fs.writeFileSync(
          path,
          `let count = 0; import dynamicValue from "./lib/dynamic.cjs"; import legacy from "cjs-lib"; import { readFileSync } from "fs"; import { childAsset } from "./lib/helper.js"; import { issuer } from "zod"; import * as React from "react"; const entryAsset = readFileSync(new URL("./entry.txt", import.meta.url), "utf8"); const identity = React.peerMarker ?? React.version; export function render() { count++; return ${
            full
              ? "`<!DOCTYPE html><html><head></head><body><p>${identity}</p><i>${count}</i><aside>${issuer}</aside><section>${entryAsset}-${childAsset}-${legacy}-${dynamicValue}</section></body></html>`"
              : "`<p>${identity}</p><i>${count}</i><aside>${issuer}</aside><section>${entryAsset}-${childAsset}-${legacy}-${dynamicValue}</section>`"
          }; }`,
        );
        const result = await handleScriptPage(
          { entity: { path, frontmatter: {} } } as never,
          "/script",
          {
            mode: "production",
            config: {},
            projectDir: directory,
            adapter: nodeAdapter,
            reactPeers: peers,
          },
        );
        const repeated = await handleScriptPage(
          { entity: { path, frontmatter: {} } } as never,
          "/script",
          {
            mode: "production",
            config: {},
            projectDir: directory,
            adapter: nodeAdapter,
            reactPeers: peers,
          },
        );
        assertEquals(
          repeated.html.includes("<i>2</i>"),
          true,
          "unchanged production modules reuse one instance",
        );
        assertEquals(
          result.html.includes("<p>captured-old</p>"),
          true,
          "script imports use the captured physical React path",
        );
        assertEquals(
          result.html.includes("<aside>project-import</aside>"),
          true,
          "externals retain project issuer and ESM import conditions",
        );
        assertEquals(
          result.html.includes(
            "<section>entry-asset-child-asset-native-require-captured-old-dependency-issuer-captured-old-shadowed</section>",
          ),
          true,
          "entry and bundled child retain their source-relative assets",
        );
        assertEquals(
          result.html.includes("react@19.2.4"),
          true,
          "browser map uses the captured React version",
        );
        assertEquals(
          result.html.includes("react@19.2.5"),
          false,
          "replacement version never enters the cached document",
        );
        const changedSource = fs.readFileSync(path, "utf8").replace(
          "<p>${identity}</p>",
          "<p>${identity}</p><u>changed</u>",
        );
        fs.writeFileSync(path, changedSource);
        const changed = await handleScriptPage(
          { entity: { path, frontmatter: {} } } as never,
          "/script",
          {
            mode: "production",
            config: {},
            projectDir: directory,
            adapter: nodeAdapter,
            reactPeers: peers,
          },
        );
        assertEquals(
          changed.html.includes("<u>changed</u>"),
          true,
          "source changes select a new executable",
        );
        assertEquals(
          changed.html.includes("<i>1</i>"),
          true,
          "source changes do not reuse old module state",
        );
      }
    } finally {
      restoreDom();
      restoreReact();
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  for (const transport of ["single", "batch"] as const) {
    it(`keeps ${transport} module SSR on captured peers after dependency replacement`, async () => {
      if (!isNode) return;
      const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
      const { serveModule } = await import("#veryfront/modules/server/module-server.ts");
      const { handleModuleBatch, clearBatchCache } = await import(
        "#veryfront/modules/server/module-batch-handler.ts"
      );
      const { getHostEnv, setEnv, deleteEnv } = await import(
        "#veryfront/platform/compat/process.ts"
      );
      const { DEPENDENCY_PINNING_ENV_FLAG } = await import(
        "#veryfront/release-assets/constants.ts"
      );
      const previous = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const restores: Array<() => void> = [];
      const adapter = createMockAdapter();
      const projectDir = `/peer-snapshot-${transport}`;
      adapter.fs.files.set(
        `${projectDir}/page.tsx`,
        'import React from "react"; export const value = React.version;',
      );
      const config = {
        react: { version: "^19.2.0" },
        get build() {
          // Replace dependencies between version selection and transformation.
          if (restores.length === 0) {
            restores.push(overrideInstalledVersion("react", "19.2.5"));
            restores.push(overrideInstalledVersion("react-dom", "19.2.5"));
          }
          return {};
        },
      };
      const peers = captureLocalReactPeers();
      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "false");
        clearBatchCache();
        const response = transport === "single"
          ? await serveModule(new Request("http://localhost/_vf_modules/page.js?ssr=true"), {
            projectDir,
            adapter,
            projectId: projectDir,
            dev: true,
            config,
            isLocalProject: true,
            allowSSRModuleMode: true,
          })
          : await handleModuleBatch(
            new Request("http://localhost/_vf_modules/_batch?paths=page.js&ssr=true"),
            {
              projectDir,
              adapter,
              projectId: projectDir,
              dev: true,
              config,
              isLocalProject: true,
            },
          );
        const body = await response.text();
        assertEquals(response.status, 200, body);
        assertExists(peers.paths.react);
        assertEquals(body.includes(peers.paths.react), true, body);
        assertEquals(restores.length, 2, "the dependency replacement must have occurred");
      } finally {
        for (const restore of restores.reverse()) restore();
        if (previous === undefined) deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
        else setEnv(DEPENDENCY_PINNING_ENV_FLAG, previous);
        clearBatchCache();
      }
    });
  }

  it("keeps the default HTTP version on the peers captured before dependency replacement", async () => {
    if (!isNode) return;
    const { prepareHttpCacheRequestOptions } = await import(
      "#veryfront/transforms/esm/http-cache-helpers.ts"
    );
    const restores: Array<() => void> = [];
    try {
      const prepared: import("#veryfront/transforms/esm/http-cache-helpers.ts").CacheOptions =
        prepareHttpCacheRequestOptions({
          cacheDir: "/unused",
          localReact: true,
          get importMap() {
            if (restores.length === 0) {
              restores.push(overrideInstalledVersion("react", "19.2.5"));
              restores.push(overrideInstalledVersion("react-dom", "19.2.5"));
            }
            return { imports: {} };
          },
        });
      const peers = prepared.reactPeers;
      assertEquals(prepared.reactVersion, peers?.versions.react);
      assertEquals(getLocalReactPath("react", prepared.reactVersion, peers), peers?.paths.react);
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  });

  it("uses captured peers for default synchronous SSR rewriting after dependency replacement", async () => {
    if (!isNode) return;
    const { rewriteSSRImportsCompat } = await import(
      "#veryfront/transforms/import-rewriter/ssr-adapter.ts"
    );
    const peers = captureLocalReactPeers();
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      const rewritten = rewriteSSRImportsCompat(
        'import React from "react";',
        { reactPeers: peers },
      );
      const reactPath = peers.paths.react;
      assertExists(reactPath);
      assertEquals(rewritten.includes(reactPath), true);
    } finally {
      restoreDom();
      restoreReact();
    }
  });

  it("resolves Bun peers from the SDK when the working directory has no dependencies", () => {
    if (!isBun) return;
    const originalDirectory = process.cwd();
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "sdk-react-anchor-"));
    try {
      process.chdir(temporaryDirectory);
      clearReactPathsCache();
      assertEquals(getLocalReactPath("react", "19.2.4")?.startsWith("file:"), true);
      assertEquals(getLocalReactPath("react-dom/static", "19.2.4")?.startsWith("file:"), true);
    } finally {
      process.chdir(originalDirectory);
      clearReactPathsCache();
      rmSync(temporaryDirectory, { recursive: true });
    }
  });

  it("resolves installed React subpaths outside the eager peer map and rejects missing exports", () => {
    if (!isNode && !isBun) return;
    for (const specifier of ["react-dom/static", "react/compiler-runtime"]) {
      assertEquals(getLocalReactPaths()[specifier], undefined);
      assertEquals(getLocalReactPath(specifier, "19.2.4")?.startsWith("file:"), true);
    }
    assertThrows(() => getLocalReactPath("react/not-an-export", "19.2.4"));
  });

  it("does not require an optional client export to resolve React and its server", () => {
    if (!isNode) return;
    const original = Reflect.get(Module, "_resolveFilename");
    clearReactPathsCache();
    try {
      Reflect.set(Module, "_resolveFilename", function (request: string, ...args: unknown[]) {
        if (request === "react-dom/client") {
          throw Object.assign(new Error("optional export unavailable"), {
            code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
          });
        }
        return Reflect.apply(original, Module, [request, ...args]);
      });
      assertEquals(getLocalReactPath("react", "19.2.4")?.startsWith("file:"), true);
      assertEquals(getLocalReactPath("react-dom/server", "19.2.4")?.startsWith("file:"), true);
      assertEquals(getLocalReactPaths()["react-dom/client"], undefined);
      assertThrows(() => getLocalReactPath("react-dom/client", "19.2.4"));
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
    }
  });
  it("rejects a selected version absent from Bun's resolved React peers", () => {
    if (!isBun) return;
    assertThrows(() => getLocalReactPath("react", "18.3.1"), TypeError, "does not match");
    assertThrows(
      () => getLocalReactPath("react-dom/server", "18.3.1"),
      TypeError,
      "does not match",
    );
  });
  it("accepts authored ranges satisfied by the installed React singleton", () => {
    if (!isNode) return;
    for (const range of ["^19.2.0", "~19.2.0", "19"]) {
      assertEquals(getLocalReactPath("react", range), getLocalReactPath("react", "19.2.4"));
    }
  });
  it("refreshes peer URLs in the runtime fingerprint when package paths change at fixed versions", async () => {
    if (!isNode) return;
    const { captureSSRReactRuntimeIdentity } = await import(
      "#veryfront/transforms/esm/http-cache-helpers.ts"
    );
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `peer-path-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      const before = captureSSRReactRuntimeIdentity();
      const beforeScope = await before.scope;
      generation = "new";
      const after = captureSSRReactRuntimeIdentity();
      assertEquals(before.reactVersion, after.reactVersion);
      assertEquals(await after.scope === beforeScope, false);
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      getLocalReactPaths({ fresh: true });
      clearReactPathsCache();
    }
  });

  it("uses one captured peer path for all rewrites after a same-version relocation", async () => {
    if (!isNode) return;
    const { captureSSRReactRuntimeIdentity } = await import(
      "#veryfront/transforms/esm/http-cache-helpers.ts"
    );
    const { rewriteSSRImportsCompat } = await import(
      "#veryfront/transforms/import-rewriter/ssr-adapter.ts"
    );
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `graph-peer-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      const captured = captureSSRReactRuntimeIdentity();
      const options = { reactVersion: captured.reactVersion, reactPeers: captured.peers };
      const source = 'import React from "react"; import { jsx } from "react/jsx-runtime";';
      const first = rewriteSSRImportsCompat(source, options);
      generation = "new";
      assertEquals(rewriteSSRImportsCompat(source, options), first);
      const next = captureSSRReactRuntimeIdentity();
      assertEquals(
        rewriteSSRImportsCompat(source, {
          reactVersion: next.reactVersion,
          reactPeers: next.peers,
        }) === first,
        false,
      );
      assertEquals(await captured.scope === await next.scope, false);
      assertThrows(
        () => rewriteSSRImportsCompat('import x from "react/unavailable";', options),
        TypeError,
      );
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
    }
  });

  it("keeps recursive fetched modules on one peer generation during dependency replacement", async () => {
    if (!isNode) return;
    const { createModuleFetcherContext, fetchAndCacheModule } = await import(
      "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts"
    );
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const directory = mkdtempSync(join(tmpdir(), "recursive-peer-"));
    const adapter = createMockAdapter();
    const sources = new Map([
      [
        "/virtual/parent.ts",
        'import React from "react"; import { child } from "./child.js"; export const value = React.version + child;',
      ],
      ["/virtual/child.ts", 'import React from "react"; export const child = React.version;'],
    ]);
    adapter.fs.resolveFile = (path: string) =>
      Promise.resolve(sources.has(`/virtual/${path}.ts`) ? `/virtual/${path}.ts` : null);
    let generation = "old";
    adapter.fs.readFile = (path: string) => {
      if (path === "/virtual/child.ts") generation = "new";
      const source = sources.get(path);
      if (source === undefined) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
      return Promise.resolve(source);
    };
    const original = Reflect.get(Module, "_resolveFilename");
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `recursive-peer-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      const context = createModuleFetcherContext(directory, adapter, "/virtual", "recursive-peer");
      const result = await fetchAndCacheModule("/_vf_modules/parent.js", context);
      assertEquals(typeof result, "string");
      const emitted: string[] = [];
      const inspect = (folder: string) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
          const path = join(folder, entry.name);
          if (entry.isDirectory()) inspect(path);
          else if (path.endsWith(".mjs") || path.endsWith(".js")) {
            emitted.push(fs.readFileSync(path, "utf8"));
          }
        }
      };
      inspect(directory);
      assertEquals(generation, "new");
      assertEquals(emitted.filter((code) => code.includes("recursive-peer-old")).length >= 2, true);
      assertEquals(emitted.some((code) => code.includes("recursive-peer-new")), false);
      const fresh = createModuleFetcherContext(
        join(directory, "fresh"),
        adapter,
        "/virtual",
        "recursive-peer-new",
      );
      const next = await fetchAndCacheModule("/_vf_modules/child.js", fresh);
      assertEquals(typeof next, "string");
      assertEquals(
        fs.readFileSync(String(next).replace(/^file:\/\//, ""), "utf8").includes(
          "recursive-peer-new",
        ),
        true,
      );
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("scopes MDX JSX artifacts and React imports to their captured peers", async () => {
    if (!isNode) return;
    const { transformJsxImports } = await import(
      "#veryfront/transforms/mdx/esm-module-loader/import-transformer.ts"
    );
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const adapter = createMockAdapter();
    const directory = mkdtempSync(join(tmpdir(), "jsx-peer-snapshot-"));
    const source = join(directory, "component.tsx");
    fs.writeFileSync(
      source,
      "export default function Component() { return <h1>same-source</h1>; }",
    );
    adapter.fs.files.set(source, fs.readFileSync(source, "utf8"));
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `jsx-peer-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    const code = `import Component from "file://${source}";`;
    const artifact = (result: string) => {
      const match = result.match(/file:\/\/([^"']+)/);
      const captured = match?.[1];
      if (!captured) throw new Error("JSX artifact missing");
      return captured;
    };
    try {
      const old = captureLocalReactPeers();
      const first = await transformJsxImports(code, adapter, directory, directory, old);
      assertEquals(fs.readFileSync(artifact(first), "utf8").includes("jsx-peer-old"), true);
      generation = "new";
      assertEquals(await transformJsxImports(code, adapter, directory, directory, old), first);
      const next = await transformJsxImports(
        code,
        adapter,
        directory,
        directory,
        captureLocalReactPeers(),
      );
      assertEquals(next === first, false);
      assertEquals(fs.readFileSync(artifact(next), "utf8").includes("jsx-peer-new"), true);
      assertEquals(fs.readFileSync(artifact(first), "utf8").includes("jsx-peer-old"), true);
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resolves supported exported subpaths from captured peer roots", () => {
    if (!isNode) return;
    const peers = captureLocalReactPeers();
    for (const specifier of ["react/compiler-runtime", "react-dom/static"]) {
      assertEquals(
        getLocalReactPath(specifier, "19.2.4", peers),
        getLocalReactPath(specifier, "19.2.4"),
      );
    }
    assertThrows(() => getLocalReactPath("react/unavailable", "19.2.4", peers), TypeError);
  });

  it("keeps logical reference cache identity independent of host peer availability", async () => {
    if (!isNode) return;
    const { computePipelineConfigIdentity } = await import(
      "#veryfront/transforms/pipeline/cache-identity.ts"
    );
    const original = fs.readFileSync;
    fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      if (/\/(?:react|react-dom)\/package.json$/.test(String(args[0]))) {
        throw new Error("Host peers unavailable");
      }
      return Reflect.apply(original, fs, args);
    }) as typeof fs.readFileSync;
    const sync = Reflect.get(Module, "syncBuiltinESMExports") as () => void;
    sync();
    try {
      const input = {
        ssrImports: "references" as const,
        reactVersion: "19.2.4",
        jsxImportSource: "react",
        studioEmbed: false,
        dev: false,
        ssr: true,
        projectDir: "/project",
        customPlugins: [],
      };
      assertEquals(
        (await computePipelineConfigIdentity(input)).length === 64,
        true,
      );
      await assertRejects(
        () => computePipelineConfigIdentity({ ...input, ssrImports: "files" }),
        Error,
        "Host peers unavailable",
      );
    } finally {
      fs.readFileSync = original;
      sync();
    }
  });

  it("keeps framework HTTP dependencies on the parent captured peers", async () => {
    if (!isNode) return;
    const { transformFrameworkCode } = await import(
      "#veryfront/transforms/pipeline/stages/ssr-vf-modules/transform.ts"
    );
    const { runWithCacheDir } = await import("#veryfront/utils/cache-dir.ts");
    const { withMockFetch } = await import("#veryfront/testing/mock-fetch.ts");
    const { createFileSystem } = await import("#veryfront/platform/compat/fs.ts");
    const directory = mkdtempSync(join(tmpdir(), "http-graph-peer-"));
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `http-graph-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      const peers = captureLocalReactPeers();
      generation = "new";
      await runWithCacheDir(directory, () =>
        withMockFetch(
          () =>
            Promise.resolve(
              new Response(
                'import React from "https://esm.sh/react@19.2.4"; export default React;',
                { headers: { "content-type": "application/javascript" } },
              ),
            ),
          async () => {
            const code = await transformFrameworkCode(
              'import React from "react"; import dep from "https://example.invalid/dependency.mjs"; export { React, dep };',
              join(directory, "framework.ts"),
              {
                reactVersion: "19.2.4",
                reactPeers: peers,
                projectDir: directory,
                fs: createFileSystem(),
              },
            );
            assertEquals(code.includes("http-graph-old"), true);
            const all: string[] = [];
            const scan = (folder: string) => {
              for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
                const path = join(folder, entry.name);
                if (entry.isDirectory()) scan(path);
                else if (/\.(?:js|mjs)$/.test(path)) all.push(fs.readFileSync(path, "utf8"));
              }
            };
            scan(directory);
            assertEquals(all.some((value) => value.includes("http-graph-old")), true);
            assertEquals(all.some((value) => value.includes("http-graph-new")), false);
          },
        ));
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("builds default-version logical references without host peer manifests", async () => {
    if (!isNode) return;
    const { runPipeline } = await import("#veryfront/transforms/pipeline/index.ts");
    const original = fs.readFileSync;
    const sync = Reflect.get(Module, "syncBuiltinESMExports") as () => void;
    fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      if (/\/(?:react|react-dom)\/package.json$/.test(String(args[0]))) {
        throw new Error("Host peers unavailable");
      }
      return Reflect.apply(original, fs, args);
    }) as typeof fs.readFileSync;
    sync();
    try {
      const result = await runPipeline("export const value = 1;", "/project/page.ts", "/project", {
        projectId: "logical-reference-host-free",
        ssr: true,
        dependencyPinningCacheKey: "off",
        preloadedImportMap: { imports: {} },
      }, { ssrImports: "references" });
      assertEquals(result.code.includes("value"), true);
    } finally {
      fs.readFileSync = original;
      sync();
    }
  });

  it("keeps SSR loader parent and dependency transforms on the graph peers", async () => {
    if (!isNode) return;
    const { SSRModuleLoader } = await import(
      "#veryfront/modules/react-loader/ssr-module-loader/loader.ts"
    );
    const { createDependencyHashCache } = await import("#veryfront/cache/dependency-graph.ts");
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const { runWithCacheDir } = await import("#veryfront/utils/cache-dir.ts");
    const directory = mkdtempSync(join(tmpdir(), "ssr-loader-peer-"));
    const parent = join(directory, "parent.ts");
    const child = join(directory, "child.ts");
    const source =
      'import React from "react"; import { child } from "./child.ts"; export const value = React.version + child;';
    fs.writeFileSync(parent, source);
    fs.writeFileSync(child, 'import React from "react"; export const child = React.version;');
    const adapter = createMockAdapter();
    adapter.fs.files.set(parent, source);
    adapter.fs.files.set(child, fs.readFileSync(child, "utf8"));
    let generation = "old";
    const read = adapter.fs.readFile.bind(adapter.fs);
    adapter.fs.readFile = (path: string) => {
      if (path === child) generation = "new";
      return read(path);
    };
    const original = Reflect.get(Module, "_resolveFilename");
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `ssr-loader-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      await runWithCacheDir(directory, async () => {
        const loader = new SSRModuleLoader({
          projectId: "ssr-loader-peer",
          contentSourceId: "release",
          projectDir: directory,
          adapter,
          dev: false,
          reactVersion: "19.2.4",
        });
        const transform = Reflect.get(loader, "transformWithDependencies");
        await Reflect.apply(transform, loader, [parent, source, 0, createDependencyHashCache()]);
        assertEquals(generation, "new");
        const emitted: string[] = [];
        const scan = (folder: string) => {
          for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const path = join(folder, entry.name);
            if (entry.isDirectory()) scan(path);
            else if (/\.(?:mjs|js)$/.test(path)) emitted.push(fs.readFileSync(path, "utf8"));
          }
        };
        scan(directory);
        assertEquals(emitted.filter((code) => code.includes("ssr-loader-old")).length >= 2, true);
        assertEquals(emitted.some((code) => code.includes("ssr-loader-new")), false);
      });
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps rendering orchestrator dependency transforms on one captured peer graph", async () => {
    if (!isNode) return;
    const { transformModuleWithDeps } = await import(
      "#veryfront/rendering/orchestrator/module-loader/index.ts"
    );
    const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
    const { runWithCacheDir } = await import("#veryfront/utils/cache-dir.ts");
    const directory = mkdtempSync(join(tmpdir(), "orchestrator-peer-"));
    const output = join(directory, "output");
    fs.mkdirSync(output);
    const parent = join(directory, "parent.ts");
    const child = join(directory, "child.ts");
    fs.writeFileSync(
      parent,
      'import React from "react"; import { child } from "./child.ts"; export const value = React.version + child;',
    );
    fs.writeFileSync(child, 'import React from "react"; export const child = React.version;');
    const actual = await runtime.get();
    let generation = "old";
    const scopedFs = Object.create(actual.fs);
    scopedFs.readFile = (path: string) => {
      if (path === child) generation = "new";
      return actual.fs.readFile(path);
    };
    const adapter = { ...actual, fs: scopedFs };
    const original = Reflect.get(Module, "_resolveFilename");
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `orchestrator-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      await runWithCacheDir(directory, async () => {
        await transformModuleWithDeps(parent, output, actual, {
          projectId: "orchestrator-peer",
          projectDir: directory,
          contentSourceId: "release",
          adapter,
          mode: "production",
          moduleCache: new Map(),
          esmCache: new Map(),
          reactVersion: "19.2.4",
        });
        assertEquals(generation, "new");
        const emitted: string[] = [];
        const scan = (folder: string) => {
          for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const path = join(folder, entry.name);
            if (entry.isDirectory()) scan(path);
            else if (/\.(?:js|mjs)$/.test(path)) emitted.push(fs.readFileSync(path, "utf8"));
          }
        };
        scan(output);
        assertEquals(emitted.filter((code) => code.includes("orchestrator-old")).length >= 2, true);
        assertEquals(emitted.some((code) => code.includes("orchestrator-new")), false);
      });
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("prepares an empty registry without host React when the adapter owns a prepared graph", async () => {
    if (!isNode) return;
    const { ComponentRegistry } = await import("#veryfront/rendering/ssr/component-registry.ts");
    const { VirtualModuleSystem } = await import("#veryfront/rendering/virtual-module-system.ts");
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const adapter = createMockAdapter();
    Reflect.set(adapter, "moduleLoader", {
      importModule: () => Promise.resolve({ default: { version: "19.2.0" } }),
    });
    const registry = new ComponentRegistry(
      new VirtualModuleSystem(undefined, adapter),
      3001,
      adapter,
    );
    const original = Reflect.get(Module, "_resolveFilename");
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      if (request === "react" || request.startsWith("react/") || request.startsWith("react-dom")) {
        throw new Error("Host React is unavailable");
      }
      return Reflect.apply(original, Module, [request, ...args]);
    });
    try {
      const key = await registry.prepareDependencySnapshot("off");
      assertEquals(registry.getAllAsComponents(key), {});
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
    }
  });
  it("refreshes installed-peer selection in reused page, layout and SSR renderers", async () => {
    if (!isNode) return;
    const { PageRenderer } = await import("#veryfront/rendering/page-renderer.ts");
    const { LayoutOrchestrator } = await import("#veryfront/rendering/orchestrator/layout.ts");
    const { SSRRenderer } = await import("#veryfront/rendering/ssr-renderer.ts");
    const { RSCDevServerHandler } = await import(
      "#veryfront/server/services/rsc/orchestrators/handler.ts"
    );
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const adapter = createMockAdapter();
    const config = { react: { version: "^19.2.0" } };
    const page = Reflect.construct(PageRenderer, [{
      projectDir: "/memo-peer-project",
      mode: "development",
      environment: "production",
      adapter,
      config,
      componentRegistry: {},
      compileMDX: () => Promise.reject(new Error("Unused compiler")),
    }]);
    const layout = Reflect.construct(LayoutOrchestrator, [{
      projectDir: "/memo-peer-project",
      adapter,
      config,
      layoutCache: { clear: () => {} },
    }]);
    const ssr = new SSRRenderer("development", adapter, "/memo-peer-project", undefined, config);
    const rsc = new RSCDevServerHandler("/memo-peer-project", {
      adapter,
      config,
      isLocalProject: true,
    });
    const select = (renderer: object) =>
      Reflect.apply(Reflect.get(renderer, "getReactVersion"), renderer, []);
    for (const renderer of [page, layout, ssr, rsc]) assertEquals(await select(renderer), "19.2.4");
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      rsc.invalidate();
      for (const renderer of [page, layout, ssr, rsc]) {
        assertEquals(await select(renderer), "19.2.5");
      }
    } finally {
      restoreDom();
      restoreReact();
    }
  });

  it("keeps captured peer selection and browser imports aligned after installed versions change", async () => {
    if (!isNode) return;
    const { resolveProjectReactVersion } = await import(
      "#veryfront/transforms/esm/package-registry.ts"
    );
    const { buildImportMap } = await import("#veryfront/html/utils.ts");
    const peers = captureLocalReactPeers();
    const options = { reactPeers: peers, config: { react: { version: "^19.2.0" } } };
    const { RenderPipeline } = await import("#veryfront/rendering/orchestrator/pipeline.ts");
    const { ComponentRegistry } = await import("#veryfront/rendering/ssr/component-registry.ts");
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const adapter = createMockAdapter();
    const pipeline = Reflect.construct(RenderPipeline, [{
      adapter,
      projectDir: "/request-peer-project",
      config: options.config,
      mode: "development",
      environment: "preview",
    }]);
    const selectLoader = (reactPeers: typeof peers): Promise<
      import("#veryfront/rendering/orchestrator/module-loader/index.ts").ModuleLoaderConfig
    > =>
      Reflect.apply(
        Reflect.get(pipeline, "resolveModuleLoaderConfig"),
        pipeline,
        [{ reactPeers }],
      );
    adapter.fs.files.set(
      "/request-peer-project/components/Button.tsx",
      "export default () => null;",
    );
    const loadedPeers: Array<typeof peers | undefined> = [];
    const { VirtualModuleSystem } = await import("#veryfront/rendering/virtual-module-system.ts");
    const registry = new ComponentRegistry(
      new VirtualModuleSystem(undefined, adapter),
      3001,
      adapter,
      undefined,
      undefined,
      undefined,
      undefined,
      (_source, _path, _root, _adapter, selected) => {
        loadedPeers.push(selected.reactPeers);
        return Promise.resolve(() => null);
      },
    );
    await registry.loadFromDirectory("/request-peer-project/components", true);
    const prepare = (selected: typeof peers) =>
      registry.prepareDependencySnapshot(
        "off",
        undefined,
        undefined,
        undefined,
        undefined,
        "preview",
        undefined,
        selected,
      );
    const oldKey = await prepare(peers);

    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      assertEquals(await resolveProjectReactVersion(options), "19.2.4");
      const oldLoader = await selectLoader(peers);
      assertEquals(oldLoader.reactVersion, "19.2.4");
      assertEquals(oldLoader.reactPeers, peers);
      const freshPeers = captureLocalReactPeers();
      const freshLoader = await selectLoader(freshPeers);
      assertEquals(freshLoader.reactVersion, "19.2.5");
      const freshKey = await prepare(freshPeers);
      assertEquals(freshKey === oldKey, false);
      assertEquals(await prepare(peers), oldKey);
      assertEquals(loadedPeers, [peers, freshPeers]);

      const imports = JSON.parse((await buildImportMap(options)).json).imports;
      assertEquals(imports.react.includes("react@19.2.4"), true);
      assertEquals(imports["react-dom"].includes("react-dom@19.2.4"), true);
      const { createHTMLContext, createHTMLGenerator } = await import(
        "#veryfront/rendering/orchestrator/html.test-helpers.ts"
      );
      const html = await createHTMLGenerator({ mode: "development", isLocalProject: true })
        .generateFullHTML(createHTMLContext({
          html: "<main>Captured peers</main>",
          options: { reactPeers: peers, environment: "preview" },
        }));
      assertEquals(html.includes("react@19.2.4"), true);
      assertEquals(html.includes("react-dom@19.2.4"), true);
      assertEquals(html.includes("react@19.2.5"), false);

      assertEquals(
        await resolveProjectReactVersion({ ...options, reactPeers: captureLocalReactPeers() }),
        "19.2.5",
      );
      await assertRejects(
        () => resolveProjectReactVersion({ ...options, config: { react: { version: "19.2.5" } } }),
        Error,
        "does not match",
      );
    } finally {
      restoreDom();
      restoreReact();
    }
  });

  it("renders page hooks with the same captured physical peers after relocation", async () => {
    if (!isNode) return;
    const { SSRRenderer } = await import("#veryfront/rendering/ssr-renderer.ts");
    const { resetReactCache } = await import(
      "#veryfront/react/compat/ssr-adapter/server-loader.ts"
    );
    const { pathToFileURL } = await import("node:url");
    const { loadComponentFromSource } = await import(
      "#veryfront/modules/react-loader/component-loader.ts"
    );
    const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
    const { runWithCacheDir } = await import("#veryfront/utils/cache-dir.ts");
    const base = captureLocalReactPeers();
    const directory = mkdtempSync(join(tmpdir(), "request-render-peers-"));
    const snapshots = new Map<string, typeof base>();
    for (const generation of ["old", "new"]) {
      const roots: Record<string, string> = {};
      for (const name of ["react", "react-dom"]) {
        const root = base.roots[name];
        if (!root) throw new Error("Installed peers missing");
        roots[name] = join(directory, generation, "node_modules", name);
        fs.cpSync(root, roots[name], { recursive: true });
      }
      const paths: Record<string, string> = {};
      for (const [specifier, uri] of Object.entries(base.paths)) {
        const name = specifier.startsWith("react-dom") ? "react-dom" : "react";
        paths[specifier] = uri.replace(
          pathToFileURL(base.roots[name]!).href,
          pathToFileURL(roots[name]!).href,
        );
      }
      snapshots.set(generation, { roots, paths, versions: base.versions });
    }
    const old = snapshots.get("old")!;
    const next = snapshots.get("new")!;
    const module = await import(old.paths.react!);
    const React = module.default ?? module;
    const adapter = await runtime.get();
    const pageSource =
      'import React from "react"; export default function Page() { const [value] = React.useState(7); return React.createElement("strong", null, value); }';
    const pagePath = join(directory, "page.tsx");
    fs.writeFileSync(pagePath, pageSource);
    const Component = await runWithCacheDir(
      directory,
      () =>
        loadComponentFromSource(pageSource, pagePath, directory, adapter, {
          projectId: "request-render-peers",
          contentSourceId: "release",
          dev: false,
          ssr: true,
          reactVersion: "19.2.4",
          reactPeers: old,
        }),
    );
    if (!Component) throw new Error("Loaded page component missing");
    const physicalDirectory = fs.realpathSync(directory);
    const original = Reflect.get(Module, "_resolveFilename");
    let selected = next;
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      const parent = args[0] as { filename?: string } | undefined;
      if (
        parent?.filename?.startsWith(directory) || parent?.filename?.startsWith(physicalDirectory)
      ) return resolved;
      if (request === "react/package.json" || request === "react-dom/package.json") {
        return join(
          selected.roots[request === "react/package.json" ? "react" : "react-dom"]!,
          "package.json",
        );
      }
      const replacement = selected.paths[request];
      return replacement ? new URL(replacement).pathname : resolved;
    });
    const originalFindPnpApi = Reflect.get(Module, "findPnpApi");
    Reflect.set(Module, "findPnpApi", () => ({
      resolveToUnqualified: (name: string) => selected.roots[name],
    }));
    resetReactCache();
    try {
      const renderer = new SSRRenderer("development");
      const result = await renderer.renderToHTML(React.createElement(Component), {
        mode: "development",
        wantsStream: false,
        reactPeers: old,
      });
      assertEquals(result.html, "<strong>7</strong>");
      const { ResponseBuilder } = await import("#veryfront/security/http/response/builder.ts");
      const { tryNotFoundFallback, __setReservedComponentLoaderForTests } = await import(
        "#veryfront/server/handlers/request/ssr/not-found-fallback.ts"
      );
      const { tryErrorPageFallback, __setComponentSourceLoaderForTests } = await import(
        "#veryfront/server/handlers/request/ssr/error-page-fallback.ts"
      );
      const { tryLoadReservedInDirs } = await import("#veryfront/rendering/app-reserved.ts");
      fs.mkdirSync(join(directory, "app"));
      fs.mkdirSync(join(directory, "pages"));
      fs.writeFileSync(join(directory, "app", "not-found.tsx"), pageSource);
      fs.writeFileSync(join(directory, "pages", "500.tsx"), pageSource);
      const context = {
        projectDir: directory,
        adapter,
        config: { react: { version: "^19.2.0" } },
        isLocalProject: true,
        resolvedEnvironment: "preview",
        securityConfig: null,
      } as import("#veryfront/server/handlers/types.ts").HandlerContext;
      const request = new Request("http://localhost/missing");
      try {
        selected = old;
        __setReservedComponentLoaderForTests(async (...args) => {
          const component = await tryLoadReservedInDirs(...args);
          selected = next;
          return component;
        });
        const notFound = await runWithCacheDir(
          directory,
          () => tryNotFoundFallback(request, "", context, new ResponseBuilder()),
        );
        assertEquals(notFound?.status, 404);
        assertEquals((await notFound?.text())?.includes("<strong>7</strong>"), true);
        selected = old;
        __setComponentSourceLoaderForTests(async (...args) => {
          const component = await loadComponentFromSource(...args);
          selected = next;
          return component;
        });
        const errorPage = await runWithCacheDir(
          directory,
          () => tryErrorPageFallback(request, context, new ResponseBuilder(), { statusCode: 500 }),
        );
        assertEquals(errorPage?.status, 500);
        assertEquals((await errorPage?.text())?.includes("<strong>7</strong>"), true);
        const { _renderAppRouteToHTMLForTest } = await import(
          "#veryfront/server/build-app-route-renderer.ts"
        );
        const buildPage = join(directory, "app", "page.tsx");
        fs.writeFileSync(buildPage, pageSource);
        selected = old;
        const buildHtml = await runWithCacheDir(directory, () =>
          _renderAppRouteToHTMLForTest({
            adapter,
            projectDir: directory,
            pageFile: buildPage,
            routePath: "/",
            contentSourceId: "peer-build",
            config: { react: { version: "^19.2.0" } },
          }, {
            componentLoader: async (...args) => {
              const component = await loadComponentFromSource(...args);
              selected = next;
              return component;
            },
          }));
        assertEquals(buildHtml.includes("<strong>7</strong>"), true);
        const { handleActionRequestWithAuthorizationProvider } = await import(
          "#veryfront/server/services/rsc/endpoints/action-handler.ts"
        );
        const { loadModuleFromSource } = await import("#veryfront/modules/react-loader/index.ts");
        fs.mkdirSync(join(directory, "app", "actions"));
        fs.writeFileSync(
          join(directory, "app", "actions", "peer.ts"),
          'import React from "react"; export default function action() { return React.version; }',
        );
        selected = old;
        const action = await runWithCacheDir(
          directory,
          () =>
            handleActionRequestWithAuthorizationProvider(
              {
                req: new Request("http://localhost/_veryfront/rsc/action", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ id: "peer", args: [] }),
                }),
                projectDir: directory,
                adapter,
                config: { react: { version: "^19.2.0" } },
              },
              { authorize: () => true },
              async (...args) => {
                assertEquals(args[4]?.reactPeers?.roots.react, old.roots.react);
                selected = next;
                return loadModuleFromSource(...args);
              },
            ),
        );
        assertEquals(action.status, 200);
        assertEquals(await action.json(), { ok: true, result: old.versions.react });
      } finally {
        __setReservedComponentLoaderForTests(null);
        __setComponentSourceLoaderForTests(null);
      }
    } finally {
      if (originalFindPnpApi === undefined) Reflect.deleteProperty(Module, "findPnpApi");
      else Reflect.set(Module, "findPnpApi", originalFindPnpApi);
      Reflect.set(Module, "_resolveFilename", original);
      resetReactCache();
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains original peer paths when stale-cache import retries after relocation", async () => {
    if (!isNode) return;
    const { SSRModuleLoader } = await import(
      "#veryfront/modules/react-loader/ssr-module-loader/loader.ts"
    );
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const { runWithCacheDir } = await import("#veryfront/utils/cache-dir.ts");
    const directory = mkdtempSync(join(tmpdir(), "retry-request-peers-"));
    const path = join(directory, "page.ts");
    const source = 'import React from "react"; export const value = React.version;';
    const adapter = createMockAdapter();
    adapter.fs.files.set(path, source);
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `retry-request-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      await runWithCacheDir(directory, async () => {
        const peers = captureLocalReactPeers();
        const loader = new SSRModuleLoader({
          projectDir: directory,
          projectId: "retry-request-peers",
          contentSourceId: "release",
          adapter,
          dev: false,
          reactVersion: "19.2.4",
          reactPeers: peers,
        });
        const imports: string[] = [];
        Reflect.set(
          loader,
          "importModuleFromCacheEntry",
          (_file: string, _name: string, entry: { tempPath: string }) => {
            imports.push(fs.readFileSync(entry.tempPath, "utf8"));
            if (imports.length === 1) {
              generation = "new";
              throw Object.assign(new Error("Cannot find module '/owned-missing-cache.mjs'"), {
                code: "ERR_MODULE_NOT_FOUND",
              });
            }
            return Promise.resolve({ value: "retry-success" });
          },
        );
        const result = await loader.loadRawModule(path, source);
        assertEquals(result.value, "retry-success");
        assertEquals(imports.length, 2);
        assertEquals(imports.every((code) => code.includes("retry-request-old")), true);
        assertEquals(imports.some((code) => code.includes("retry-request-new")), false);
      });
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reloads React and renderer caches when resolved paths change at fixed versions", async () => {
    if (!isNode) return;
    const { getProjectReact, getReactDOMServer, resetReactCache, __setServerModuleLoaderForTests } =
      await import("#veryfront/react/compat/ssr-adapter/server-loader.ts");
    const actual = await getProjectReact("19.2.4");
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `renderer-path-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    __setServerModuleLoaderForTests((_url, label) =>
      Promise.resolve(
        label === "React" ? { default: { ...actual, marker: generation } } : {
          version: "19.2.4",
          marker: generation,
          renderToString: () => generation,
          renderToStaticMarkup: () => generation,
        },
      )
    );
    resetReactCache();
    try {
      const beforeReact = await getProjectReact("19.2.4");
      const beforeDom = await getReactDOMServer("19.2.4");
      generation = "new";
      assertEquals(await getProjectReact("19.2.4") === beforeReact, false);
      assertEquals(await getReactDOMServer("19.2.4") === beforeDom, false);
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      getLocalReactPaths({ fresh: true });
      resetReactCache();
      __setServerModuleLoaderForTests(null);
    }
  });

  it("accepts version prefixes on an installed renderer without accepting another release", async () => {
    if (!isNode) return;
    const { getReactDOMServer, resetReactCache } = await import(
      "#veryfront/react/compat/ssr-adapter/server-loader.ts"
    );
    resetReactCache();
    try {
      const bare = await getReactDOMServer("19.2.4");
      for (const prefix of ["v", "^v", "~v"]) {
        assertEquals(await getReactDOMServer(`${prefix}19.2.4`), bare);
      }
      await assertRejects(() => getReactDOMServer("v19.2.4-canary"), Error, "does not match");
    } finally {
      resetReactCache();
    }
  });

  it("refuses a cached Node renderer after an in-place peer version replacement", async () => {
    if (!isNode) return;
    const { getReactDOMServer, resetReactCache, resolveSSRRuntime } = await import(
      "#veryfront/react/compat/ssr-adapter/server-loader.ts"
    );
    resetReactCache();
    await getReactDOMServer("19.2.4");
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      await assertRejects(
        () => resolveSSRRuntime({ reactVersion: "19.2.5" }),
        Error,
        "does not match",
      );
    } finally {
      restoreDom();
      restoreReact();
      resetReactCache();
    }
  });

  it("separates cached and concurrent layouts after same-version peer relocation", async () => {
    if (!isNode) return;
    const { createLayoutComponentCache, loadTSXComponent } = await import(
      "#veryfront/rendering/layouts/utils/component-loader.ts"
    );
    const adapter = {
      fs: { readFile: () => Promise.resolve("export default function Layout() { return null; }") },
    } as unknown as import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;
    const cache = createLayoutComponentCache();
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `layout-peer-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    let loads = 0;
    let enteredOld: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredOld = resolve;
    });
    let releaseOld: (() => void) | undefined;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const load = () =>
      loadTSXComponent(
        "/project/app/layout.tsx",
        "/project",
        cache,
        adapter,
        "project",
        "slug",
        "release",
        { compileMode: "production", environment: "production" },
        "19.2.4",
        {
          loadComponentFromSource: async () => {
            loads++;
            const captured = generation;
            if (captured === "old") {
              enteredOld!();
              await oldGate;
            }
            return function Layout() {
              return captured;
            };
          },
        },
      );
    try {
      const old = load();
      await entered;
      generation = "new";
      const current = load();
      // Release the old flight so a broken shared key fails rather than hangs.
      releaseOld!();
      const [oldLayout, newLayout] = await Promise.all([old, current]);
      assertEquals(oldLayout === newLayout, false);
      assertEquals(loads, 2);
      assertEquals(await load(), newLayout);
      assertEquals(loads, 2);
    } finally {
      releaseOld!();
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
    }
  });

  it("does not accept an inner framework cache after installed peers change", async () => {
    if (!isNode) return;
    const { transformFrameworkCode } = await import(
      "#veryfront/transforms/pipeline/stages/ssr-vf-modules/transform.ts"
    );
    const { frameworkFileCache } = await import(
      "#veryfront/transforms/pipeline/stages/ssr-vf-modules/constants.ts"
    );
    const { createFileSystem } = await import("#veryfront/platform/compat/fs.ts");
    frameworkFileCache.clear();
    const context = {
      reactVersion: "19.2.4",
      projectDir: "/framework-runtime-test",
      fs: createFileSystem(),
      importMap: { imports: {} },
      importMapFingerprint: "framework-runtime-test",
    };
    const source = 'import React from "react"; export const value = React.version;';
    await transformFrameworkCode(source, "/framework-runtime-test/source.ts", context);
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      await assertRejects(
        () => transformFrameworkCode(source, "/framework-runtime-test/source.ts", context),
        Error,
        "does not match",
      );
    } finally {
      restoreDom();
      restoreReact();
      frameworkFileCache.clear();
    }
  });

  it("does not accept a specifier framework cache from an older peer scope", async () => {
    if (!isNode) return;
    const { resolveAndTransformVeryfrontImport } = await import(
      "#veryfront/transforms/pipeline/stages/ssr-vf-modules/transform.ts"
    );
    const { resolveVeryfrontSourcePath } = await import(
      "#veryfront/transforms/pipeline/stages/ssr-vf-modules/path-resolver.ts"
    );
    const { buildFrameworkTransformCacheKey, veryfrontTransformCache } = await import(
      "#veryfront/transforms/pipeline/stages/ssr-vf-modules/constants.ts"
    );
    const { getSSRReactRuntimeCacheScope } = await import(
      "#veryfront/transforms/esm/http-cache-helpers.ts"
    );
    const { createFileSystem } = await import("#veryfront/platform/compat/fs.ts");
    const { pathToFileURL } = await import("node:url");
    const directory = mkdtempSync(join(tmpdir(), "framework-specifier-peer-"));
    const specifier = "#veryfront/utils";
    const sourcePath = await resolveVeryfrontSourcePath(specifier);
    assertEquals(typeof sourcePath, "string");
    const source = 'import React from "react"; export const value = React.version;';
    const adapterFs = createFileSystem();
    const originalRead = adapterFs.readTextFile.bind(adapterFs);
    adapterFs.readTextFile = (path: string) =>
      path === sourcePath ? Promise.resolve(source) : originalRead(path);
    const context = {
      reactVersion: "19.2.4",
      projectDir: directory,
      fs: adapterFs,
      importMap: { imports: {} },
      importMapFingerprint: "specifier-peer-test",
    };
    const key = buildFrameworkTransformCacheKey(
      `${specifier}:${sourcePath}`,
      "19.2.4",
      directory,
      source,
      context.importMapFingerprint,
      await getSSRReactRuntimeCacheScope(),
    );
    const cachedPath = join(directory, "cached.mjs");
    fs.writeFileSync(cachedPath, "export const cached = 1;");
    veryfrontTransformCache.set(key, pathToFileURL(cachedPath).href);
    assertEquals(
      await resolveAndTransformVeryfrontImport(specifier, context),
      pathToFileURL(cachedPath).href,
    );
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      assertEquals(await resolveAndTransformVeryfrontImport(specifier, context), null);
    } finally {
      restoreDom();
      restoreReact();
      veryfrontTransformCache.delete(key);
      rmSync(directory, { recursive: true });
    }
  });

  it("keeps one effective peer version and scope in a recursive fetch graph", async () => {
    if (!isNode) return;
    const { getSharedModuleFetchKey } = await import(
      "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/shared-module-fetches.ts"
    );
    const { getModuleFetcherReactRuntimeIdentity } = await import(
      "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/react-runtime-identity.ts"
    );
    const context = {
      projectId: "fetch-peer-pair",
      projectDir: "/project",
      esmCacheDir: "/tmp/fetch-peer-pair",
    } as import("#veryfront/transforms/mdx/esm-module-loader/types.ts").ModuleFetcherContext;
    const key = await getSharedModuleFetchKey(context, "entry");
    const first = getModuleFetcherReactRuntimeIdentity(context);
    const firstScope = await first.scope;
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      for (let index = 0; index < 20; index++) {
        assertEquals(await getSharedModuleFetchKey(context, "entry"), key);
        const identity = getModuleFetcherReactRuntimeIdentity(context);
        assertEquals(identity.reactVersion, "19.2.4");
        assertEquals(await identity.scope, firstScope);
      }
      const next = getModuleFetcherReactRuntimeIdentity({
        ...context,
        reactVersion: undefined,
        reactRuntimeScope: undefined,
        reactRuntimeIdentity: undefined,
      });
      assertEquals(next.reactVersion, "19.2.5");
      assertEquals(await next.scope === firstScope, false);
      const fixedNext = {
        ...context,
        reactVersion: "19.2.4",
        reactRuntimeScope: undefined,
        reactRuntimeIdentity: undefined,
      };
      assertEquals(await getSharedModuleFetchKey(fixedNext, "entry") === key, false);
    } finally {
      restoreDom();
      restoreReact();
    }
  });

  it("revalidates a fixed React version after peers change behind the outer transform cache", async () => {
    if (!isNode) return;
    const { transformModuleCodeWithCache } = await import(
      "#veryfront/rendering/orchestrator/module-loader/module-transform-cache.ts"
    );
    const cache = new Map<string, string>();
    const deps:
      import("#veryfront/rendering/orchestrator/module-loader/module-transform-cache.ts").ModuleTransformCacheDeps =
        {
          initializeTransformCache: () => Promise.resolve(false),
          getOrComputeTransform: async (key, compute) => {
            const cached = cache.get(key);
            if (cached !== undefined) return { code: cached, cacheHit: true };
            const code = await compute();
            cache.set(key, code);
            return { code, cacheHit: false };
          },
          transformToESM: (_code, _path, _directory, _adapter, options) => {
            getLocalReactPath("react", options.reactVersion);
            return Promise.resolve("export const page = 1;");
          },
          validateCachedBundlesByManifestOrCode: () =>
            Promise.resolve({ valid: true, failedHashes: [], source: "code" }),
          findMissingFrameworkBundlePaths: () => Promise.resolve([]),
          getHttpBundleCacheDir: () => "/tmp/runtime-cache-test",
          setCachedTransformAsync: () => Promise.resolve(),
          runPipeline: () => Promise.reject(new Error("Unexpected retry")),
        };
    const input = {
      fileContent: "export const page = 1;",
      filePath: "/project/page.tsx",
      projectDir: "/project",
      effectiveProjectId: "runtime-cache-test",
      mode: "production" as const,
      adapter: {} as import("#veryfront/platform/adapters/base.ts").RuntimeAdapter,
      reactVersion: "19.2.4",
      deps,
    };
    await transformModuleCodeWithCache(input);
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      await assertRejects(() => transformModuleCodeWithCache(input), TypeError, "does not match");
      const selected = await transformModuleCodeWithCache({ ...input, reactVersion: undefined });
      assertEquals(selected.code, "export const page = 1;");
      const { transformResolvedModuleSource } = await import(
        "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/source-transform.ts"
      );
      let recursiveVersion: string | undefined;
      await transformResolvedModuleSource({
        sourceCode: "export const page = 1;",
        actualFilePath: "/node_modules/veryfront/esm/src/react/runtime/core.js",
        projectDir: "/project",
        projectId: "runtime-cache-test",
        normalizedPath: "_veryfront/react/runtime/core.js",
        projectSlug: "runtime-cache-test",
        dev: false,
        adapter: input.adapter,
        log: { debug: () => {}, error: () => {} },
        loadImportMap: () => Promise.resolve({ imports: {} }),
        transformFrameworkSource: (_source, _path, version) => {
          recursiveVersion = version;
          getLocalReactPath("react", version);
          return Promise.resolve("export const page = 1;");
        },
      });
      assertEquals(recursiveVersion, "19.2.5");
    } finally {
      restoreDom();
      restoreReact();
    }
  });

  it("rejects an aliased installed peer package identity", () => {
    if (!isNode) return;
    const restore = overrideInstalledVersion("react", "19.2.4", "preact");
    try {
      assertThrows(() => resolveInstalledReactRange("latest"), TypeError, "identity");
      assertThrows(() => getLocalReactPath("react", "19.2.4"), TypeError, "identity");
    } finally {
      restore();
    }
  });

  it("rejects an authored package alias without swallowing it as unreadable metadata", async () => {
    const directory = mkdtempSync(join(tmpdir(), "react-alias-source-"));
    try {
      fs.writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({ dependencies: { react: "npm:preact@^10.0.0" } }),
      );
      await assertRejects(
        () => resolveProjectReactVersion({ projectDir: directory }),
        TypeError,
        "aliases",
      );
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("rejects npm aliases before choosing React CDN versions", () => {
    assertThrows(() => resolveInstalledReactRange("npm:preact@^10.0.0"), TypeError);
  });

  it("rejects alternate-source React declarations before using official CDN versions", async () => {
    const { buildImportMap } = await import("#veryfront/html/utils.ts");
    for (
      const declaration of [
        "workspace:*",
        "file:../react",
        "link:../react",
        "../react",
        "git+https://example.invalid/react.git",
        "https://example.invalid/react.tgz",
        "owner/react",
        "github:owner/react",
        "react-fork.tgz",
        "react-fork.tar.gz",
      ]
    ) {
      assertThrows(() => resolveInstalledReactRange(declaration), TypeError);
      await assertRejects(
        () => buildImportMap({ config: { react: { version: declaration } } }),
        TypeError,
      );
      const directory = mkdtempSync(join(tmpdir(), "react-source-declaration-"));
      try {
        fs.writeFileSync(
          join(directory, "package.json"),
          JSON.stringify({ dependencies: { react: declaration } }),
        );
        await assertRejects(() => resolveProjectReactVersion({ projectDir: directory }), TypeError);
        const adapter = {
          moduleLoader: { importModule: () => Promise.resolve({ default: { version: "19.2.4" } }) },
        } as unknown as import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;
        await assertRejects(
          () =>
            resolveProjectReactVersion({ adapter, config: { react: { version: declaration } } }),
          TypeError,
        );
      } finally {
        rmSync(directory, { recursive: true });
      }
    }
  });

  it("rejects alternate React DOM sources in project and snapshot peer maps", async () => {
    for (
      const declaration of [
        "file:../react-dom",
        "link:../react-dom",
        "git+https://example.invalid/react-dom.git",
      ]
    ) {
      const directory = mkdtempSync(join(tmpdir(), "dom-source-declaration-"));
      try {
        fs.writeFileSync(
          join(directory, "package.json"),
          JSON.stringify({ dependencies: { react: "19.2.4", "react-dom": declaration } }),
        );
        await assertRejects(() => resolveProjectReactVersion({ projectDir: directory }), TypeError);
        await assertRejects(
          () =>
            resolveProjectReactVersion({
              dependencyPinningCacheKey: "on:fixture",
              dependencyPinningDependencies: { react: "19.2.4", "react-dom": declaration },
            }),
          TypeError,
        );
      } finally {
        rmSync(directory, { recursive: true });
      }
    }
  });

  it("selects the installed peer for non-semver declarations without accepting mismatching ranges", async () => {
    if (!isNode) return;
    const restore = overrideInstalledVersion("react", "19.2.5");
    try {
      for (const declaration of ["latest", "next", "canary"]) {
        assertEquals(resolveInstalledReactRange(declaration), "19.2.5");
        assertEquals(
          await resolveProjectReactVersion({ config: { react: { version: declaration } } }),
          "19.2.5",
        );
        assertEquals(
          await resolveProjectReactVersion({
            dependencyPinningCacheKey: "on:tag",
            dependencyPinningDependencies: { react: declaration },
          }),
          "19.2.5",
        );
        assertEquals(getLocalReactPath("react", declaration)?.startsWith("file:"), true);
      }
      assertEquals(resolveInstalledReactRange("^18.3.1"), undefined);
      assertThrows(() => getLocalReactPath("react", "18.3.1"), TypeError, "does not match");
    } finally {
      restore();
    }
  });

  it("keeps captured effective React pins after installed peers change", async () => {
    if (!isNode) return;
    const { createDependencyPinningSource, getDependencyPinningSnapshot } = await import(
      "#veryfront/transforms/esm/package-registry.ts"
    );
    const { getHostEnv, setEnv } = await import("#veryfront/platform/compat/process.ts");
    const { buildImportMap } = await import("#veryfront/html/utils.ts");
    const flag = "VERYFRONT_DEPENDENCY_PINNING";
    const previous = getHostEnv(flag);
    const directory = mkdtempSync(join(tmpdir(), "captured-effective-peer-"));
    let restoreReact: (() => void) | undefined;
    let restoreDom: (() => void) | undefined;
    try {
      setEnv(flag, "1");
      fs.writeFileSync(join(directory, "package.json"), "{}");
      const config = { react: { version: "^19.2.0" } };
      const snapshot = await getDependencyPinningSnapshot(
        createDependencyPinningSource({ projectDir: directory, isLocalProject: true, config }),
      );
      const options = {
        projectDir: directory,
        config,
        dependencyPinningCacheKey: snapshot.cacheKey,
        dependencyPinningDependencies: snapshot.dependencies,
        dependencyPinningConfiguredVersions: snapshot.configuredVersions,
      };
      restoreReact = overrideInstalledVersion("react", "19.2.5");
      restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
      assertEquals(await resolveProjectReactVersion(options), "19.2.4");
      assertEquals((await resolveProjectPackageVersions(options)).react, "19.2.4");
      assertEquals(
        JSON.parse((await buildImportMap(options)).json).imports.react.includes("react@19.2.4"),
        true,
      );
      assertThrows(() => getLocalReactPath("react", "19.2.4"), TypeError);
    } finally {
      restoreDom?.();
      restoreReact?.();
      setEnv(flag, previous ?? "");
      rmSync(directory, { recursive: true });
    }
  });

  it("refreshes a cached project range when only the installed peer changes", async () => {
    if (!isNode) return;
    const dir = mkdtempSync(join(tmpdir(), "sdk-cached-range-"));
    let restore: (() => void) | undefined;
    try {
      fs.writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { react: "^19.2.0" } }),
      );
      assertEquals((await readProjectDependencyVersions(dir)).react, "19.2.4");
      restore = overrideInstalledVersion("react", "19.2.5");
      assertEquals((await readProjectDependencyVersions(dir)).react, "19.2.5");
      assertEquals(await resolveProjectReactVersion({ projectDir: dir }), "19.2.5");
    } finally {
      restore?.();
      rmSync(dir, { recursive: true });
    }
  });

  it("selects a compatible installed patch for both config and captured React ranges", async () => {
    if (!isNode) return;
    createRequire(import.meta.url)("react/package.json"); // Warm Node's JSON cache.
    assertEquals(resolveInstalledReactRange("^19.2.4"), "19.2.4");
    const restore = overrideInstalledVersion("react", "19.2.5");
    try {
      assertEquals(await resolveProjectReactVersion({}), "19.2.5");
      assertEquals((await resolveProjectPackageVersions({})).react, "19.2.5");
      assertEquals(
        (await resolveProjectPackageVersions({
          dependencyPinningCacheKey: "on:empty",
          dependencyPinningDependencies: {},
        })).react,
        await resolveProjectReactVersion({
          dependencyPinningCacheKey: "on:empty",
          dependencyPinningDependencies: {},
        }),
      );
      assertEquals(
        await resolveProjectReactVersion({
          dependencyPinningCacheKey: "on:range",
          dependencyPinningDependencies: { react: "^19.2.4" },
        }),
        "19.2.5",
      );
      assertEquals(
        await resolveProjectReactVersion({ config: { react: { version: "^19.2.4" } } }),
        "19.2.5",
      );
      assertEquals(
        await resolveProjectReactVersion({ config: { react: { version: "19.2.4" } } }),
        "19.2.4",
      );
    } finally {
      restore();
    }
  });

  it("rejects a separately mismatched installed React DOM renderer", () => {
    if (!isNode) return;
    createRequire(import.meta.url)("react-dom/package.json"); // Warm Node's JSON cache.
    getLocalReactPath("react-dom/server", "19.2.4");
    const restore = overrideInstalledVersion("react-dom", "18.3.1");
    try {
      let rejected = false;
      try {
        getLocalReactPath("react-dom/server", "19.2.4");
      } catch (error) {
        rejected = error instanceof TypeError;
      }
      assertEquals(rejected, true);
    } finally {
      restore();
    }
  });

  describe("getLocalReactPaths", () => {
    it("should return runtime-appropriate local React path mappings", () => {
      const paths = getLocalReactPaths();
      assertEquals(typeof paths, "object");
      if (isBun || isNode) {
        assertEquals(Object.keys(paths).length > 0, true);
      } else {
        assertEquals(Object.keys(paths).length, 0);
      }
    });

    it("should return empty object outside Node and Bun", () => {
      if (isBun || isNode) return;
      const paths = getLocalReactPaths();
      assertEquals(paths, {});
    });

    it("renders Node JSX from a cache outside node_modules with the framework React singleton", async () => {
      if (!isNode) return;
      const paths = getLocalReactPaths();
      assertEquals(paths["react/jsx-runtime"]?.startsWith("file:"), true);
      const code = `import React from ${JSON.stringify(paths.react)};
        import { jsx } from ${JSON.stringify(paths["react/jsx-runtime"])};
        import { renderToStaticMarkup } from ${JSON.stringify(paths["react-dom/server"])};
        function Page() { const [value] = React.useState("offline-render"); return jsx("main", {children: value}); }
        export const html = renderToStaticMarkup(jsx(Page, {}));
        export { React };`;
      const rendered = await import(`data:text/javascript,${encodeURIComponent(code)}`);
      const frameworkReact = createRequire(import.meta.url)("react");
      assertEquals(rendered.React === frameworkReact, true);
      assertEquals(rendered.html, "<main>offline-render</main>");
    });

    it("should return same result on repeated calls (cache)", () => {
      const paths1 = getLocalReactPaths();
      const paths2 = getLocalReactPaths();
      assertEquals(paths1, paths2);
      assertEquals(Object.isFrozen(paths1), true);
    });
  });

  describe("clearReactPathsCache", () => {
    it("should not throw when clearing cache", () => {
      clearReactPathsCache();
      const paths = getLocalReactPaths();
      assertEquals(typeof paths, "object");
    });

    it("should allow fresh resolution after clearing", () => {
      getLocalReactPaths();
      clearReactPathsCache();
      const paths = getLocalReactPaths();
      assertEquals(typeof paths, "object");
    });
  });
});
