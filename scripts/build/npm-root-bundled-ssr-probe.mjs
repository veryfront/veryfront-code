import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Exercise the emitted npm SDK graph rather than source-checkout aliases. */
export async function runRootBundledSsrProbe(packageDirectory) {
  const root = await realpath(packageDirectory);
  const load = (path) => import(pathToFileURL(resolve(root, path)).href);
  const { createBuiltinExtensions } = await load(
    "src/extensions/builtin-extensions.js",
  );
  const { getDeferredExtensionState } = await load(
    "src/extensions/deferred-extension.js",
  );
  const { register, tryResolve } = await load("src/extensions/contracts.js");
  const candidate = createBuiltinExtensions().find((entry) =>
    entry.extension.name === "ext-bundler-esbuild"
  );
  if (!candidate) throw new Error("Bundler builtin missing");
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const bundler = await getDeferredExtensionState(candidate)?.load(logger);
  if (!bundler) throw new Error("Bundler builtin unavailable");
  await bundler.setup({
    get: tryResolve,
    provide: register,
    config: {},
    logger,
  });
  const projectDir = await mkdtemp(resolve(tmpdir(), "vf-npm-ssr-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Unexpected remote package fetch");
  };
  try {
    const { __runWithOutboundFetchTransportForTests } = await load(
      "src/security/http/outbound-fetch.js",
    );
    const refuse = () => {
      throw new Error("Unexpected outbound dependency request");
    };
    await __runWithOutboundFetchTransportForTests({
      fetch: refuse,
      pinnedFetch: refuse,
      resolveHost: refuse,
    }, async () => {
      const { transformFrameworkCode } = await load(
        "src/transforms/pipeline/stages/ssr-vf-modules/transform.js",
      );
      const { createFileSystem } = await load("src/platform/compat/fs.js");
      const transformed = await transformFrameworkCode(
        'import factory from "../../extensions/ext-eval-report-mlflow/src/index.js"; export default factory;',
        resolve(root, "src/extensions/builtin-extensions.js"),
        { reactVersion: "19.2.4", projectDir, fs: createFileSystem() },
        true,
      );
      const moduleUrl = transformed.match(/from "(file:[^"]+)"/)?.[1];
      if (!moduleUrl) throw new Error("Bundled SSR factory module missing");
      const { default: factory } = await import(moduleUrl);
      const extension = factory({ trackingUri: "https://mlflow.example.test" });
      let registered = false;
      let removed = false;
      extension.setup({
        require(name) {
          if (name !== "EvalReportExporterRegistry") {
            throw new Error("Wrong registry contract");
          }
          return {
            register(value) {
              registered = value.id === "mlflow";
            },
            unregister(id) {
              removed = id === "mlflow";
            },
          };
        },
        logger,
      });
      if (!registered) throw new Error("Bundled SSR exporter did not register");
      extension.teardown();
      if (!removed) throw new Error("Bundled SSR exporter did not unregister");
    });
  } finally {
    globalThis.fetch = originalFetch;
    await bundler.teardown?.();
    await rm(projectDir, { recursive: true });
  }
}
