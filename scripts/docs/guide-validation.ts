export function createPublicImportValidator(exports: Record<string, unknown>) {
  const validImports = new Set<string>(["veryfront"]);
  for (const exportPath of Object.keys(exports)) {
    validImports.add(exportPath === "." ? "veryfront" : `veryfront${exportPath.slice(1)}`);
  }

  return (moduleId: string): boolean => validImports.has(moduleId);
}

export function collectVeryfrontImports(content: string): string[] {
  const imports: string[] = [];
  const importRe = /from ["'](veryfront(?:\/[a-z0-9-]+)*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(content))) {
    imports.push(match[1]);
  }
  return imports;
}
