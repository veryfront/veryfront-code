/**
 * Veryfront CLI
 *
 * Full-stack app renderer with SSR support
 */
import "../../_dnt.polyfills.js";
if (globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).main) {
    const { main } = await import("./index.js");
    await main();
}
