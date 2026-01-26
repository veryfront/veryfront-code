import { DEFAULT_PORT } from "../../config/defaults.js";
const ARRAY_FLAGS = new Set(["with"]);
function maybeNumber(val) {
    if (typeof val === "string" && /^\d+$/.test(val))
        return parseInt(val, 10);
    return val;
}
function isValue(arg) {
    return arg !== undefined && !arg.startsWith("-");
}
function parse(args, options = {}) {
    const result = { _: [], ...options.default };
    const aliasMap = new Map(Object.entries(options.alias ?? {}));
    function setValue(key, value) {
        const converted = maybeNumber(value);
        if (!ARRAY_FLAGS.has(key)) {
            result[key] = converted;
            return;
        }
        const arr = result[key] ?? [];
        result[key] = [...arr, converted];
    }
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg)
            continue;
        if (arg.startsWith("--")) {
            const eqIdx = arg.indexOf("=");
            if (eqIdx !== -1) {
                setValue(arg.slice(2, eqIdx), arg.slice(eqIdx + 1));
                continue;
            }
            const key = arg.slice(2);
            const next = args[i + 1];
            if (isValue(next)) {
                setValue(key, next);
                i++;
                continue;
            }
            setValue(key, true);
            continue;
        }
        if (arg.startsWith("-") && arg.length === 2) {
            const short = arg.slice(1);
            const key = aliasMap.get(short) ?? short;
            const next = args[i + 1];
            if (isValue(next)) {
                setValue(key, next);
                i++;
                continue;
            }
            setValue(key, true);
            continue;
        }
        result._.push(arg);
    }
    return result;
}
export function parseArrayArg(arg) {
    if (Array.isArray(arg))
        return arg;
    if (arg)
        return [String(arg)];
    return undefined;
}
export function parseCliArgs(args) {
    return parse(args, {
        alias: {
            p: "port",
            h: "help",
            v: "version",
            q: "quiet",
            f: "force",
            s: "strict",
            t: "template",
            j: "json",
            w: "with",
        },
        default: { port: DEFAULT_PORT },
    });
}
