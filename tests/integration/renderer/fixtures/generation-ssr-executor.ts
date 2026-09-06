// Exercise the existing renderer inside a native generation process.
import "#veryfront/schemas/_test-setup.ts";
import { createServer } from "node:http";
import process from "node:process";
import { SSRRenderer } from "#veryfront/rendering/ssr-renderer.ts";
import { runWithHeadCollector } from "#veryfront/react/head-collector.ts";
import { resolveCommittedHeadFromHTML } from "#veryfront/rendering/orchestrator/html-head.ts";
import { installMockFetch } from "#veryfront/testing/mock-fetch.ts";

const [moduleUrl, coordinator] = process.argv.slice(2);
const page = await import(moduleUrl!);
const reactRuntime = { react: page.react, server: page.server };
const renderer = new SSRRenderer("production", undefined, undefined, undefined, {
  react: { version: page.react.version },
});
const coordinateFetch = globalThis.fetch.bind(globalThis);
installMockFetch(() => {
  throw new Error("Rendering must not reload prepared dependency sources");
});

const server = createServer(async (request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.write("<main>");
  try {
    const gate = await coordinateFetch(`${coordinator}/continue`);
    await gate.arrayBuffer();
    const nonce = String(request.headers["x-fixture-nonce"]);
    const release = Promise.withResolvers<void>();
    const DeferredPage = async () => {
      await release.promise;
      return await page.createPage();
    };
    const element = page.react.createElement(
      "section",
      null,
      page.react.createElement(
        page.react.Suspense,
        { fallback: "pending" },
        page.react.createElement(DeferredPage),
      ),
    );
    const rendered = await runWithHeadCollector(
      async (renderContext) =>
        renderer.renderToHTML(element, {
          mode: "production",
          wantsStream: true,
          nonce,
          renderContext,
          reactRuntime,
        }),
      { nonce },
    );
    // Release each request only after its shell is consumed. A cached lazy
    // module must not remove the suspended-retry behavior from the second request.
    const html = await new Response(rendered.result.stream!.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
          release.resolve();
        },
      }),
    )).text();
    if (resolveCommittedHeadFromHTML(html, rendered.head)?.title !== "Captured head") {
      throw new Error("The existing renderer did not retain the captured Head registration");
    }
    response.end(`${html}</main>`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "SSR fixture failed");
    response.destroy();
  }
});
server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture requires a TCP address");
  const ready = await coordinateFetch(`${coordinator}/ready`, {
    method: "POST",
    body: String(address.port),
  });
  await ready.arrayBuffer();
});
