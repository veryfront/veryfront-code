import { chromium } from "playwright";

let server;
let closing = false;

async function close() {
  if (closing) return;
  closing = true;
  try {
    await server?.close();
  } finally {
    process.exit(0);
  }
}

try {
  server = await chromium.launchServer({ headless: true, timeout: 15_000 });
  process.stdout.write(`${JSON.stringify({ wsEndpoint: server.wsEndpoint() })}\n`);
  process.stdin.resume();
  process.stdin.on("end", () => void close());
  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}
