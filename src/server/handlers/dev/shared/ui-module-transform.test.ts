import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  setGlobalTracerProvider,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "npm:@opentelemetry/sdk-trace-base@2.8.0";
import { transformUiModule } from "./ui-module-transform.ts";

describe("server/handlers/dev/shared/ui-module-transform", () => {
  it("does not attach module paths to transform spans", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    setGlobalTracerProvider(
      provider as unknown as Parameters<typeof setGlobalTracerProvider>[0],
    );

    try {
      const code = await transformUiModule(
        "PRIVATE_TRANSFORM_FILE_PATH.tsx",
        "export default function Component() { return null; }",
        "components/PRIVATE_TRANSFORM_RELATIVE_PATH.tsx",
        {
          spanName: "server.dev.test.transformModule",
          importBasePath: "/_dev/ui",
        },
      );
      assertEquals(code.length > 0, true);
      await provider.forceFlush();

      const spans = JSON.stringify(
        exporter.getFinishedSpans().map((span) => ({
          name: span.name,
          attributes: span.attributes,
        })),
      );
      assertEquals(spans.includes("PRIVATE_TRANSFORM_FILE_PATH"), false);
      assertEquals(spans.includes("PRIVATE_TRANSFORM_RELATIVE_PATH"), false);
    } finally {
      _resetShimForTests();
      await provider.shutdown();
      const esbuild = await import("veryfront/extensions/bundler");
      await esbuild.stop();
    }
  });
});
