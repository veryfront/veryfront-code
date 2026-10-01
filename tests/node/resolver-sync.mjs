import { registerHooks } from "node:module";
import { loadSync, resolve } from "./resolver-hooks.mjs";

registerHooks({ resolve, load: loadSync });
