let marker;
const conditions = new Map();
export function initialize(data) {
  marker = data.marker;
}
function resolverUrl(value) {
  if (!value?.startsWith("file:")) return undefined;
  const url = new URL(value);
  return url.searchParams.get(marker) === "1" ? url : undefined;
}
export function resolve(specifier, context, nextResolve) {
  if (resolverUrl(specifier)) {
    conditions.set(specifier, context.conditions);
    return { url: specifier, shortCircuit: true };
  }
  const parent = resolverUrl(context.parentURL);
  if (parent) {
    parent.searchParams.delete(marker);
    return nextResolve(specifier, { ...context, parentURL: parent.href });
  }
  return nextResolve(specifier, context);
}
export function load(url, context, nextLoad) {
  if (resolverUrl(url)) {
    return {
      format: "module",
      source: `export const resolve = import.meta.resolve; export const conditions = ${
        JSON.stringify(conditions.get(url) ?? [])
      };`,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
