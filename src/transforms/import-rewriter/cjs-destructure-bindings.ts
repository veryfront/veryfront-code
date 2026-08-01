export function toCjsDestructureBindings(bindings: string): string {
  const inner = bindings.trim().replace(/^\{\s*/, "").replace(/\s*\}$/, "");
  if (!inner) return "{}";

  const converted = inner
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const aliasMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (aliasMatch) return `${aliasMatch[1]}: ${aliasMatch[2]}`;
      return part;
    });

  return `{ ${converted.join(", ")} }`;
}
