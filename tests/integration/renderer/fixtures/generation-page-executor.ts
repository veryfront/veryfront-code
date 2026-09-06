// Run the unchanged HTTP and page orchestration layers inside one generation process.
import "#veryfront/schemas/_test-setup.ts";
import process from "node:process";
import { relative } from "#veryfront/compat/path";
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import type { RuntimeModuleReference } from "#veryfront/platform/adapters/base.ts";
import { SSRHandler } from "#veryfront/server/handlers/request/ssr/ssr.handler.ts";
import { validateVeryfrontConfig } from "#veryfront/config";
import { MdxContentProcessor } from "@veryfront/ext-content-mdx";
import { EsbuildBundler, EsModuleLexer } from "@veryfront/ext-bundler-esbuild";
import { TailwindCSSProcessor } from "@veryfront/ext-css-tailwind";
import { register } from "#veryfront/extensions/contracts.ts";
import { installMockFetch } from "#veryfront/testing/mock-fetch.ts";

const [moduleUrl, coordinator, projectDir] = process.argv.slice(2);
if (!moduleUrl || !coordinator || !projectDir) throw new Error("Missing fixture arguments");
const modules = await import(moduleUrl);
const adapter = await runtime.get();
const imports: string[] = [];
Object.defineProperty(adapter, "moduleLoader", {
  value: Object.freeze({
    importModule: async (reference: RuntimeModuleReference) => {
      const key = reference.kind === "package"
        ? reference.specifier
        : relative(projectDir, reference.path).replaceAll("\\", "/");
      const table = reference.kind === "package" ? modules.packages : modules.sources;
      const load = Object.getOwnPropertyDescriptor(table, key)?.value;
      if (typeof load !== "function") {
        throw new Error("Module was not prepared for this generation");
      }
      imports.push(key);
      return await load();
    },
  }),
});
register("ContentProcessor", new MdxContentProcessor());
register("Bundler", new EsbuildBundler());
register("ModuleLexer", new EsModuleLexer());
register("CSSProcessor", new TailwindCSSProcessor());
const config = validateVeryfrontConfig({ react: { version: modules.react.version } });
const handler = new SSRHandler();
const coordinateFetch = globalThis.fetch.bind(globalThis);
installMockFetch(() => {
  throw new Error("The page executor must not fetch dependency sources");
});

const server = await adapter.serve(async (request) => {
  const admitted = await coordinateFetch(`${coordinator}/admitted`, { method: "POST" });
  await admitted.arrayBuffer();
  const gate = await coordinateFetch(`${coordinator}/continue`);
  await gate.arrayBuffer();
  const marker = request.headers.get("x-fixture-nonce")!;
  const req = new Request(`http://localhost/page?marker=${encodeURIComponent(marker)}`, {
    headers: { accept: "text/html", "cache-control": "no-cache" },
  });
  const result = await handler.handle(req, {
    projectDir,
    adapter,
    config,
    securityConfig: null,
    projectId: "generation-test",
    projectSlug: "generation-test",
    releaseId: "release-test",
    resolvedEnvironment: "production",
    requestContext: { token: "", slug: "generation-test", branch: null, mode: "production" },
    isLocalProject: false,
    // This fixture is a dedicated project process, never the shared host.
    allowHostProjectCodeExecution: true,
  });
  if (!result.response || result.response.status !== 200) {
    throw new Error(`Page pipeline returned ${result.response?.status ?? "no response"}`);
  }
  for (
    const required of [
      "app/page/page.mdx",
      "app/layout.tsx",
      "app/page/layout.mdx",
      "react",
      "react-dom/server",
      "veryfront/context",
      "veryfront/router",
    ]
  ) {
    if (!imports.includes(required)) throw new Error(`Prepared import was not used: ${required}`);
  }
  return result.response;
}, { hostname: "127.0.0.1", port: 0 });
const ready = await coordinateFetch(`${coordinator}/ready`, {
  method: "POST",
  body: String(server.addr.port),
});
await ready.arrayBuffer();
