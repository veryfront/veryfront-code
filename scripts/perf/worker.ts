import { Session } from "node:inspector";
import { cpuUsage } from "node:process";
import { createWorkload, type Scenario } from "./workloads.ts";
import { type CpuProfile, sanitizeProfile } from "./report.ts";

if (Deno.args[0] === "--check-only") Deno.exit(0);

const [scenario, durationText, profilePath] = Deno.args;
const durationMs = Number(durationText);
const work = await createWorkload(scenario as Scenario);
const firstStart = performance.now();
await work();
const firstOperationMs = performance.now() - firstStart;
let checksum = 0;
async function exercise(ms: number) {
  const started = performance.now();
  let operations = 0;
  do {
    // Timer reads happen once per batch so they do not dominate small operations.
    for (let i = 0; i < 50; i++) checksum = (checksum + await work()) >>> 0;
    operations += 50;
  } while (performance.now() - started < ms);
  return { operations, elapsedMs: performance.now() - started };
}
await exercise(500);
const cpuStart = cpuUsage();
const measured = await exercise(durationMs);
const cpu = cpuUsage(cpuStart);
const measurement = {
  ...measured,
  msPerOperation: measured.elapsedMs / measured.operations,
  cpuUsPerOperation: (cpu.user + cpu.system) / measured.operations,
  firstOperationMs,
  rssBytes: Deno.memoryUsage().rss,
  checksum,
};
// Capture separately, after the unprofiled measurement.
if (profilePath) {
  const session = new Session();
  session.connect();
  const post = (method: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      session.post(
        method,
        (error, result) =>
          error
            ? reject(error)
            : resolve((result ?? {}) as Record<string, unknown>),
      );
    });
  try {
    await post("Profiler.enable");
    await post("Profiler.start");
    await exercise(Math.max(2000, durationMs));
    const { profile } = await post("Profiler.stop");
    await Deno.writeTextFile(
      profilePath,
      JSON.stringify(
        sanitizeProfile(
          profile as CpuProfile,
          new URL("../../", import.meta.url).href,
        ),
      ),
    );
  } finally {
    session.disconnect();
  }
}
await Deno.stdout.write(
  new TextEncoder().encode(JSON.stringify(measurement) + "\n"),
);
// React's server scheduler can retain MessagePorts. This disposable process owns
// those resources; exit only after the measurement and profile are flushed.
Deno.exit(0);
