import type { BuildOptions } from "#dnt";

/** Keep dnt's JavaScript emit aligned with the repository's JSX runtime. */
export const NPM_DNT_COMPILER_OPTIONS: NonNullable<
  BuildOptions["compilerOptions"]
> = {
  lib: ["ES2022", "DOM", "DOM.Iterable"],
  target: "ES2022",
  skipLibCheck: true,
  jsx: "react-jsx",
  jsxImportSource: "react",
};
