const RESOURCE_PARAMETER = /(^|\/):([A-Za-z_][A-Za-z0-9_]*)/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resourcePatternToRegex(pattern: string): RegExp {
  const escapedPattern = escapeRegExp(pattern).replace(
    RESOURCE_PARAMETER,
    "$1(?<$2>[^/]+)",
  );
  return new RegExp(`^${escapedPattern}$`);
}

export function resourcePatternToUriTemplate(pattern: string): string | undefined {
  let parameterized = false;
  const template = pattern.replace(RESOURCE_PARAMETER, (_match, prefix: string, name: string) => {
    parameterized = true;
    return `${prefix}{${name}}`;
  });
  return parameterized ? template : undefined;
}
