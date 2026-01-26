/**
 * Veryfront CLI
 *
 * Full-stack app renderer with SSR support
 */

if (import.meta.main) {
  const { main } = await import("./index.ts");
  await main();
}
