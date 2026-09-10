import {
  buildServerTimingHeader,
  finalizeRequestProfiling,
  profilePhase,
  runWithRequestProfiling,
} from "#veryfront/observability/request-profiler.ts";

export const scenarios = ["request-timing", "ssr"] as const;
export type Scenario = typeof scenarios[number];

const phases = [
  "runtime.ready",
  "runtime.config_load",
  "runtime.resolve_adapter",
  "render.page",
  "render.layout",
  "render.data",
  "render.ssr",
  "html.project_css",
  "html.import_map",
  "handler.execute",
];

export async function createWorkload(
  scenario: Scenario,
): Promise<() => Promise<number>> {
  if (scenario === "request-timing") {
    return () =>
      runWithRequestProfiling({
        category: "html",
        method: "GET",
        pathname: "/bench/page",
      }, async () => {
        for (const name of phases) {
          await profilePhase(name, () => Promise.resolve(1));
        }
        return buildServerTimingHeader(finalizeRequestProfiling(200)!).length;
      });
  }
  const [React, server, { SSRRenderer }] = await Promise.all([
    import("react"),
    import("react-dom/server"),
    import("#veryfront/rendering/ssr-renderer.ts"),
  ]);
  const renderer = new SSRRenderer(
    "production",
    undefined,
    undefined,
    undefined,
    {
      react: { version: React.version },
    } as import("#veryfront/config").VeryfrontConfig,
  );
  // Explicit runtime is the production API for an already prepared dependency graph.
  // No test injection, filesystem project, provider, or external service is needed.
  const options = {
    mode: "production",
    wantsStream: false,
    reactRuntime: { react: React, server },
  };
  return () =>
    runWithRequestProfiling({
      category: "html",
      method: "GET",
      pathname: "/bench/ssr",
    }, async () => {
      const element = React.createElement(
        "main",
        null,
        React.createElement("h1", null, "Performance fixture"),
        ...Array.from({ length: 100 }, (_, i) =>
          React.createElement(
            "article",
            { key: i },
            React.createElement("h2", null, `Item ${i}`),
            React.createElement(
              "p",
              null,
              "Synthetic content for repeatable framework profiling.",
            ),
          )),
      );
      const result = await profilePhase(
        "render.ssr",
        () => renderer.renderToHTML(element, options),
      );
      if (!result.html.includes("Item 99")) {
        throw new Error("SSR workload produced incomplete HTML");
      }
      return result.html.length +
        buildServerTimingHeader(finalizeRequestProfiling(200)!).length;
    });
}
