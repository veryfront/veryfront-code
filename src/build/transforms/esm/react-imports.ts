import { REACT_DEFAULT_VERSION } from "@veryfront/utils/constants/cdn.ts";

export function resolveReactImports(code: string): string {
  const reactImports = [
    {
      bare: "react/jsx-runtime",
      url: `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-runtime`,
    },
    {
      bare: "react/jsx-dev-runtime",
      url: `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-dev-runtime`,
    },
    {
      bare: "react-dom/server",
      url: `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/server`,
    },
    {
      bare: "react-dom/client",
      url: `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/client`,
    },
    {
      bare: "react-dom",
      url: `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}`,
    },
    { bare: "react", url: `https://esm.sh/react@${REACT_DEFAULT_VERSION}` },
  ];

  for (const { bare, url } of reactImports) {
    const regex = new RegExp(`from\\s+["']${bare}["']`, "g");
    code = code.replace(regex, `from "${url}"`);
  }

  return code;
}

export function addDepsToEsmShUrls(code: string): string {
  return code.replace(
    /from\s+["'](https:\/\/esm\.sh\/[^"'?]+)["']/g,
    (match, url) => {
      if (url.includes("?") || url.includes(`react@${REACT_DEFAULT_VERSION}`)) {
        return match;
      }
      return `from "${url}?deps=react@${REACT_DEFAULT_VERSION},react-dom@${REACT_DEFAULT_VERSION}"`;
    },
  );
}
