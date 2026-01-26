/**
 * Veryfront CLI
 *
 * Full-stack app renderer with SSR support
 */
import "../../_dnt.polyfills.js";


if (import.meta.main) {
  const { main } = await import("./index.js");
  await main();
}
