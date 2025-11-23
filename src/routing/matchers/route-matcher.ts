import type { Route, RouteMatch } from "./types.ts";

export function matchRoute(pathname: string, route: Route): RouteMatch | null {
  const match = pathname.match(route.regex!);
  if (!match) return null;

  const params: Record<string, string | string[]> = {
    /* empty */
  };

  const catchAllParamNames = new Set<string>();
  if (route.pattern) {
    route.pattern.replace(/\[\[\.\.\.(\w+)\]\]/g, (_, paramName: string) => {
      catchAllParamNames.add(paramName);
      return "";
    });
    route.pattern.replace(/\[\.\.\.(\w+)\]/g, (_, paramName: string) => {
      catchAllParamNames.add(paramName);
      return "";
    });
  }

  route.paramNames?.forEach((name, index) => {
    const value = match[index + 1];

    if (catchAllParamNames.has(name)) {
      const segments = value ? value.split("/").filter((segment) => segment.length > 0) : [];
      params[name] = segments.map((segment) => decodeURIComponent(segment));
    } else {
      params[name] = decodeURIComponent(value || "");
    }
  });

  return { params, route };
}
