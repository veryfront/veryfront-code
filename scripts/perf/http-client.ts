import { encodeMessage, readMessages } from "./protocol.ts";

if (Deno.args[0] === "--check-only") Deno.exit(0);

const [origin, scenario, durationText] = Deno.args;
const durationMs = Number(durationText);
const api = scenario === "http-api";
const cached = scenario === "http-cached";
const dev = scenario === "http-dev";
const url = `${origin}${api ? "/api/items" : "/catalog"}`;
const headers: Record<string, string> = api || cached
  ? {}
  : { cookie: "perf-fixture=1" };
let checksum = 0;
let cacheHits = 0;
async function work(expectWarmCache = true) {
  const response = await fetch(url, { headers });
  const body = await response.text();
  if (response.status !== 200) {
    throw new Error("HTTP fixture returned a non-200 response");
  }
  if (api) {
    const data = JSON.parse(body);
    if (data.items?.length !== 100 || data.items[99]?.title !== "Item 99") {
      throw new Error("HTTP fixture returned incomplete JSON");
    }
  } else {
    if (
      !body.includes("Catalog fixture") || !body.includes("Item <!-- -->99")
    ) {
      throw new Error("HTTP fixture returned incomplete HTML");
    }
    if (body.includes("data-node-id=") !== dev) {
      throw new Error("HTTP fixture used the wrong compile mode");
    }
    const hit =
      response.headers.get("server-timing")?.includes("render.cache_hit") ??
        false;
    if (hit !== (cached && expectWarmCache)) {
      throw new Error("HTTP fixture used an unexpected page cache state");
    }
    if (hit) cacheHits++;
  }
  checksum = (checksum + body.length) >>> 0;
}

async function exercise(ms: number) {
  const started = performance.now();
  let operations = 0;
  do {
    await work();
    operations++;
  } while (performance.now() - started < ms);
  return { operations, elapsedMs: performance.now() - started };
}

const firstStart = performance.now();
await work(false);
const firstOperationMs = performance.now() - firstStart;
await exercise(500);
await Deno.stdout.write(encodeMessage({ stage: "ready" }));
for await (const command of readMessages(Deno.stdin.readable)) {
  if (command.stage === "measure") {
    cacheHits = 0;
    const measured = await exercise(durationMs);
    await Deno.stdout.write(encodeMessage({
      stage: "measured",
      measurement: {
        ...measured,
        msPerOperation: measured.elapsedMs / measured.operations,
        firstOperationMs,
        checksum,
        cacheHits,
        compileMode: dev ? "development" : "production",
      },
    }));
  } else if (command.stage === "profile") {
    await exercise(Math.max(2000, durationMs));
    await Deno.stdout.write(encodeMessage({ stage: "profiled" }));
  } else if (command.stage === "stop") {
    break;
  } else throw new Error("Unknown performance control message");
}
Deno.exit(0);
