export interface JSXRuntime {
  Fragment: unknown;
  jsx: (type: unknown, props: unknown, key?: unknown) => unknown;
  jsxs: (type: unknown, props: unknown, key?: unknown) => unknown;
  jsxDEV: (type: unknown, props: unknown, key?: unknown) => unknown;
}

export async function loadJSXRuntime(): Promise<JSXRuntime> {
  const ReactJsxRuntime = (await import("react/jsx-dev-runtime")) as Record<string, unknown>;

  const Fragment = ReactJsxRuntime.Fragment;
  const jsx = (ReactJsxRuntime.jsx || ReactJsxRuntime.jsxDEV) as JSXRuntime["jsx"];
  const jsxs = (ReactJsxRuntime.jsxs || ReactJsxRuntime.jsxDEV) as JSXRuntime["jsxs"];
  const jsxDEV = (ReactJsxRuntime.jsxDEV || ReactJsxRuntime.jsx) as JSXRuntime["jsxDEV"];

  return { Fragment, jsx, jsxs, jsxDEV };
}
