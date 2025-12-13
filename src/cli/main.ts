#!/usr/bin/env -S deno run --allow-all --unstable-kv


if (import.meta.main) {
  const { main } = await import("./index.ts");
  await main();
}
