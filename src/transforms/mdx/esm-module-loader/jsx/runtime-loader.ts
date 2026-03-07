export interface JSXRuntime {
  Fragment: unknown;
  jsx: (type: unknown, props: unknown, key?: unknown) => unknown;
  jsxs: (type: unknown, props: unknown, key?: unknown) => unknown;
  jsxDEV: (type: unknown, props: unknown, key?: unknown) => unknown;
}

export async function loadJSXRuntime(): Promise<JSXRuntime> {
  // deno-lint-ignore no-explicit-any -- react/jsx-dev-runtime has no type declarations in Deno; module shape is untyped
  const runtime = (await import("react/jsx-dev-runtime")) as any;

  return {
    Fragment: runtime.Fragment,
    jsx: runtime.jsx ?? runtime.jsxDEV,
    jsxs: runtime.jsxs ?? runtime.jsxDEV,
    jsxDEV: runtime.jsxDEV ?? runtime.jsx,
  } as JSXRuntime;
}
