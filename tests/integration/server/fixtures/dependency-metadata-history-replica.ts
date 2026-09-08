import "#veryfront/schemas/_test-setup.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import {
  createDependencyPinningSource,
  getDependencyPinningSnapshot,
  isCurrentDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { resolveDependencyPinForImport } from "#veryfront/transforms/import-rewriter/dependency-resolution.ts";
import {
  _pendingResolutions,
  _setDependencyResolutionPosterForTest,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import { serveModule } from "#veryfront/modules/server/module-server.ts";
import { ensureCliBundlerContracts } from "../../../../cli/shared/default-contracts.ts";

await ensureCliBundlerContracts();
const origin = Deno.args[0]!;
const projectDir = `/replica-${Deno.pid}`;
const adapter = createMockAdapter();
adapter.fs.stat = async () => {
  const { content, version } = await (await fetch(`${origin}/metadata`)).json();
  return {
    isFile: true,
    isDirectory: false,
    isSymlink: false,
    size: content.length,
    mtime: new Date(version),
  };
};
adapter.fs.readFile = async () => (await (await fetch(`${origin}/metadata`)).json()).content;
adapter.fs.readDependencyMetadataHistory = async () => {
  const response = await fetch(`${origin}/metadata-history`);
  if (!response.ok) throw new Error("Metadata history read failed");
  return await response.json();
};
const source = createDependencyPinningSource({
  projectDir,
  projectId: "synthetic-project",
  adapter,
  isLocalProject: false,
  dependencyWritebackTarget: { kind: "main" },
});
_setDependencyResolutionPosterForTest(async (_id, specifiers) => {
  const response = await fetch(`${origin}/metadata`, {
    method: "POST",
    body: JSON.stringify(specifiers),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error("Synthetic writeback failed");
});
let document: Awaited<ReturnType<typeof getDependencyPinningSnapshot>>;
Deno.serve({
  hostname: "127.0.0.1",
  port: 0,
  onListen: ({ port }) => console.log(JSON.stringify({ port })),
}, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/document") {
    document = await getDependencyPinningSnapshot(source);
    return Response.json({ key: document.cacheKey });
  }
  if (url.pathname === "/writeback") {
    resolveDependencyPinForImport("react", {
      projectId: "synthetic-project",
      projectDir,
      dependencyPinningSource: source,
      dependencyPinningCacheKey: document.cacheKey,
      dependencyPinningDependencies: document.dependencies,
    });
    await _pendingResolutions();
    return Response.json({ complete: true });
  }
  if (url.pathname === "/authority") {
    return Response.json({
      current: isCurrentDependencyPinningSnapshot(
        source,
        url.searchParams.get("key")!,
      ),
    });
  }
  if (url.pathname === "/module") {
    const moduleUrl = `http://localhost/_vf_modules/_pins/${
      encodeURIComponent(url.searchParams.get("key")!)
    }/_veryfront/react/server-render-context.js`;
    return await serveModule(new Request(moduleUrl), {
      projectId: "synthetic-project",
      projectDir,
      adapter,
      isLocalProject: false,
      isProxyMode: true,
      dev: false,
      mode: "preview",
      dependencyPinningSource: source,
    });
  }
  return new Response(null, { status: 404 });
});
