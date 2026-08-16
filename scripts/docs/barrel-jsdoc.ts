export interface BarrelJSDoc {
  description: string;
  moduleName: string;
  remarks: string;
  examples: Array<{ title: string; code: string }>;
}

const EMPTY_BARREL_JSDOC: BarrelJSDoc = {
  description: "",
  moduleName: "",
  remarks: "",
  examples: [],
};

export function parseBarrelJSDoc(content: string): BarrelJSDoc {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("/**")) {
    return EMPTY_BARREL_JSDOC;
  }

  const endIdx = trimmed.indexOf("*/");
  if (endIdx === -1) {
    return EMPTY_BARREL_JSDOC;
  }

  const block = trimmed.slice(3, endIdx);
  const lines = block.split("\n").map((line) => line.replace(/^\s*\*\s?/, ""));

  let moduleName = "";
  const descLines: string[] = [];
  const remarkLines: string[] = [];
  const examples: Array<{ title: string; code: string }> = [];
  let inExample = false;
  let inRemarks = false;
  let exampleTitle = "";
  let exampleLines: string[] = [];
  let codeFence: { marker: "`" | "~"; length: number } | null = null;

  const finishExample = (): void => {
    if (exampleLines.length > 0) {
      examples.push({ title: exampleTitle, code: exampleLines.join("\n") });
    }
    exampleTitle = "";
    exampleLines = [];
    codeFence = null;
  };

  for (const line of lines) {
    if (codeFence === null && line.startsWith("@module")) {
      moduleName = line.replace("@module", "").trim();
      inRemarks = false;
      continue;
    }

    if (codeFence === null && line.startsWith("@remarks")) {
      finishExample();
      inExample = false;
      inRemarks = true;
      const inlineRemarks = line.replace("@remarks", "").trim();
      if (inlineRemarks) remarkLines.push(inlineRemarks);
      continue;
    }

    if (codeFence === null && line.startsWith("@example")) {
      finishExample();
      exampleTitle = line.replace("@example", "").trim();
      exampleLines = [];
      inExample = true;
      inRemarks = false;
      codeFence = null;
      continue;
    }

    if (codeFence === null && line.startsWith("@")) {
      finishExample();
      inExample = false;
      inRemarks = false;
      continue;
    }

    if (inExample) {
      const fenceMatch = line.trimStart().match(/^(`{3,}|~{3,})(.*)$/);
      if (fenceMatch) {
        const fence = fenceMatch[1];
        const marker = fence[0] as "`" | "~";
        if (codeFence === null) {
          codeFence = { marker, length: fence.length };
        } else if (
          marker === codeFence.marker &&
          fence.length >= codeFence.length &&
          fenceMatch[2].trim() === ""
        ) {
          codeFence = null;
        }
      }
      exampleLines.push(line);
    } else if (inRemarks) {
      remarkLines.push(line);
    } else if (!moduleName || descLines.length > 0 || line.trim()) {
      if (!line.startsWith("@")) {
        descLines.push(line);
      }
    }
  }

  finishExample();

  const description = normalizePublicDocText(
    descLines.join(" ").replace(/\s+/g, " ").trim(),
  );
  const remarks = remarkLines.join("\n").trim();
  return { description, moduleName, remarks, examples };
}

export function normalizePublicDocText(text: string): string {
  const withoutInlineJsDocLinks = text.replace(
    /\{@(?:link|linkcode|linkplain)\s+([^}]+)\}/g,
    (_match, rawTarget: string) => {
      const target = rawTarget.trim();
      const pipeIndex = target.indexOf("|");
      const display = pipeIndex >= 0
        ? target.slice(pipeIndex + 1).trim()
        : target.match(/^\S+\s+(.+)$/)?.[1]?.trim() || target;
      const longestBacktickRun = Math.max(
        0,
        ...(display.match(/`+/g) ?? []).map((run) => run.length),
      );
      const delimiter = "`".repeat(longestBacktickRun + 1);
      const needsPadding = display.startsWith("`") || display.endsWith("`");
      return `${delimiter}${
        needsPadding ? ` ${display} ` : display
      }${delimiter}`;
    },
  );

  return withoutInlineJsDocLinks
    .replace(/(`+)[\s\S]*?\1|[<>]/g, (token) => {
      if (token.startsWith("`")) return token;
      return token === "<" ? "&lt;" : "&gt;";
    })
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
