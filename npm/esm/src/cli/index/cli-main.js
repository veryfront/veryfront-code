#!/usr/bin/env -S deno run --allow-all --unstable-kv
import { getArgs } from "../../platform/compat/process.js";
import { parseCliArgs } from "./arg-parser.js";
import { routeCommand } from "./command-router.js";
export async function main() {
    await routeCommand(parseCliArgs(getArgs()));
}
if (globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).main) {
    await main();
}
