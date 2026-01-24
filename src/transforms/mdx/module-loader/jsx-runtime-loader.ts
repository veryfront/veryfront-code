export interface JSXRuntime {
  Fragment: unknown;
  jsx: (type: unknown, props: unknown, key?: unknown) => unknown;
  jsxs: (type: unknown, props: unknown, key?: unknown) => unknown;
  jsxDEV: (type: unknown, props: unknown, key?: unknown) => unknown;
}

export async function loadJSXRuntime(): Promise<JSXRuntime> {
  const runtime = (await import("react/jsx-dev-runtime")) as Partial<JSXRuntime>;

  return {
    Fragment: runtime.Fragment,
    jsx: (runtime.jsx ?? runtime.jsxDEV) as JSXRuntime["jsx"],
    jsxs: (runtime.jsxs ?? runtime.jsxDEV) as JSXRuntime["jsxs"],
    jsxDEV: (runtime.jsxDEV ?? runtime.jsx) as JSXRuntime["jsxDEV"],
  };
}
