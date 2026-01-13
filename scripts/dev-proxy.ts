#!/usr/bin/env -S deno run --allow-all
/**
 * Local Proxy + Renderer launcher
 * Usage: deno task proxy [--project path/to/project]
 */

const PROXY_PORT = 8080;
const RENDERER_PORT = 3001;

// Check .env.local exists
try {
  await Deno.stat(".env.local");
} catch {
  console.error("Missing .env.local - copy from .env.local.example");
  Deno.exit(1);
}

// Start proxy
const proxy = new Deno.Command("deno", {
  args: ["run", "--allow-net", "--allow-env", "--env=.env.local", "main.ts"],
  cwd: "./proxy",
  stdout: "inherit",
  stderr: "inherit",
  env: { ...Deno.env.toObject(), PORT: String(PROXY_PORT), RENDERER_URL: `http://localhost:${RENDERER_PORT}` },
}).spawn();

await new Promise((r) => setTimeout(r, 2000));

// Start renderer with passed args
const renderer = new Deno.Command("deno", {
  args: ["run", "--allow-all", "--no-lock", "--unstable-net", "--unstable-worker-options", "src/cli/main.ts", "dev", ...Deno.args],
  stdout: "inherit",
  stderr: "inherit",
  env: { ...Deno.env.toObject(), PROXY_MODE: "1", PORT: String(RENDERER_PORT) },
}).spawn();

console.log(`\n🚀 Proxy: http://localhost:${PROXY_PORT}  |  Renderer: http://localhost:${RENDERER_PORT}\n`);
console.log(`   Test: http://codersociety.preview.lvh.me:${PROXY_PORT}/\n`);

// Shutdown handler
const shutdown = () => {
  try { proxy.kill("SIGTERM"); } catch {}
  try { renderer.kill("SIGTERM"); } catch {}
  Deno.exit(0);
};

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

await Promise.race([proxy.status, renderer.status]);
shutdown();
