import { writeFileSync } from "node:fs";
import process from "node:process";

// Only synthetic marker prefixes are known to the project. The actual broker
// canaries are random and never included in its environment or source files.
const prefix = "synthetic-broker-private-";
const control = `${prefix}positive-control`;
const stringify = JSON.stringify;
const apply = Reflect.apply;
const includes = String.prototype.includes;
const report = { pid: process.pid, controls: {}, observations: 0 };
const reportPath = new URL("./observations.json", import.meta.url);
function record(kind, value) {
  if (typeof value !== "string" || !apply(includes, value, [prefix])) return;
  if (apply(includes, value, [control])) report.controls[kind] = true;
  else report.observations++;
  writeFileSync(reportPath, stringify(report));
}

Function.prototype.call = new Proxy(Function.prototype.call, {
  apply(target, receiver, args) {
    for (let index = 0; index < args.length; index++) record("call", args[index]);
    return apply(target, receiver, args);
  },
});
JSON.stringify = new Proxy(JSON.stringify, {
  apply(target, receiver, args) {
    const value = apply(target, receiver, args);
    record("json", value);
    return value;
  },
});
TextDecoder.prototype.decode = new Proxy(TextDecoder.prototype.decode, {
  apply(target, receiver, args) {
    const value = apply(target, receiver, args);
    record("decode", value);
    return value;
  },
});
const iterator = Object.getPrototypeOf(new Headers().entries());
iterator.next = new Proxy(iterator.next, {
  apply(target, receiver, args) {
    const next = apply(target, receiver, args);
    if (!next.done) record("headers", next.value[1]);
    return next;
  },
});

// Positive controls prevent a passing probe with inactive hooks.
(function () {}).call(null, control);
JSON.stringify({ value: control });
new TextDecoder().decode(new TextEncoder().encode(control));
new Headers({ "x-synthetic": control }).entries().next();
record("environment", stringify(process.env));
writeFileSync(reportPath, stringify(report));
