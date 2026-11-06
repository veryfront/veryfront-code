// SPIKE inbox#4177 option A (throwaway): bundle `module.exports = require(id)`
// for a project and print the IIFE, so a synchronous test helper can measure
// what esbuild's resolution and interop do with the old shim test scenarios.
import { spikeBundleRouteResult } from "./spike-4177-option-a.ts";

const [projectDir, id] = Deno.args as [string, string];
const esbuild = await import("npm:esbuild@0.28.1");
try {
  const { code } = await spikeBundleRouteResult({
    build: esbuild.build,
    projectDir,
    routePath: `${projectDir}/__vf_spike_entry.js`,
    routeSource: `module.exports = require(${JSON.stringify(id)});`,
    runtimeShim: "",
    cjsEntry: true,
  });
  console.log(JSON.stringify({ code }));
} catch (error) {
  const errors = (error as { errors?: { text: string }[] }).errors;
  console.log(JSON.stringify({ error: errors?.map((e) => e.text).join("; ") ?? String(error) }));
} finally {
  await esbuild.stop();
}
