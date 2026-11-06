// SPIKE inbox#4177 option A (throwaway): bundle real packages from a route,
// record size and build time, then evaluate the handler and call it.
import { spikeBundleRouteResult } from "./spike-4177-option-a.ts";

const projectDir = Deno.args[0]!;
const esbuild = await import("npm:esbuild@0.28.1");
const cases: Record<string, string> = {
  "pg (Pool, no connect)":
    'import pg from "pg";\nexport const GET = () => new Response(typeof new pg.Pool({ max: 1 }).query);',
  "jsonwebtoken sign/verify":
    'import jwt from "jsonwebtoken";\nexport const GET = () => new Response(String(jwt.verify(jwt.sign({ a: 1 }, "k"), "k").a));',
  "lodash (whole package)":
    'import _ from "lodash";\nexport const GET = () => new Response(_.kebabCase("Hello World"));',
  "mime-types (reads mime-db JSON)":
    'import mime from "mime-types";\nexport const GET = () => new Response(String(mime.lookup("a.json")));',
  "pdf-parse (pdf.js, __dirname)":
    'import pdf from "pdf-parse";\nexport const GET = () => new Response(typeof pdf);',
  "bcrypt (native addon)":
    'import bcrypt from "bcrypt";\nexport const GET = () => new Response(typeof bcrypt.hashSync);',
  "pg twice: single instance across two routes": "",
};
const rows: string[] = [];
for (const [label, source] of Object.entries(cases)) {
  if (!source) continue;
  const started = performance.now();
  try {
    const { code } = await spikeBundleRouteResult({
      build: esbuild.build,
      projectDir,
      routePath: `${projectDir}/app/api/route.ts`,
      routeSource: source,
      runtimeShim: "export {};",
    });
    const ms = Math.round(performance.now() - started);
    const file = `${projectDir}/app/api/handler-${rows.length}.mjs`;
    await Deno.writeTextFile(file, code);
    let outcome: string;
    try {
      const mod = await import(`file://${file}`);
      outcome = await (await mod.GET()).text();
    } catch (error) {
      outcome = `RUNTIME ERROR ${String((error as Error).message).split("\n")[0].slice(0, 160)}`;
    }
    rows.push(`| ${label} | ${(code.length / 1024).toFixed(0)} KiB | ${ms} ms | ${outcome} |`);
  } catch (error) {
    const errors = (error as { errors?: { text: string }[] }).errors;
    const text = errors?.map((e) => e.text).join("; ") ?? String(error);
    rows.push(`| ${label} | - | ${Math.round(performance.now() - started)} ms | BUILD ERROR ${text.slice(0, 200)} |`);
  }
}
console.log(rows.join("\n"));
await esbuild.stop();
