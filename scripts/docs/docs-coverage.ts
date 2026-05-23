#!/usr/bin/env -S deno run --allow-read

const SYNTHETIC_PARENTS = new Set<string>(["channels"]);

export interface DocsCoverageReport {
  publicExports: {
    total: number;
    topLevel: number;
    deep: number;
  };
  apiDeclarations: {
    total: number;
    withSourceLinks: number;
    withoutSourceLinks: number;
    missingSourceLinkSamples: DeclarationLinkGap[];
  };
  referencePages: {
    required: number;
    present: number;
    missing: string[];
    extra: string[];
  };
  guides: {
    total: number;
    withContracts: number;
    contractMissing: string[];
    contractStale: string[];
    withCodeExamples: number;
    withCodeExampleTests: number;
    codeExampleMissing: string[];
    codeExampleStale: string[];
  };
  links: {
    referenceModulesLinkedFromGuides: number;
    referenceModulesMissingGuideLinks: string[];
    guidesLinkedFromReferencePages: number;
    guidesMissingReferenceLinks: string[];
  };
}

export interface DeclarationLinkGap {
  page: string;
  line: number;
  declaration: string;
}

interface ReferencePage {
  slug: string;
  content: string;
}

interface GuidePage {
  file: string;
  path: string;
  content: string;
}

function fromRoot(root: string, path: string): string {
  const normalizedRoot = root.replace(/\/$/, "");
  return normalizedRoot === "" ? path : `${normalizedRoot}/${path}`;
}

function topLevelSlug(exportPath: string): string {
  if (exportPath === ".") return "index";
  return exportPath.replace("./", "").split("/")[0] ?? exportPath;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

async function listMarkdownFiles(path: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(path)) {
      if (entry.isFile && entry.name.endsWith(".md")) names.push(entry.name);
    }
  } catch {
    return names;
  }
  return names.sort();
}

function extractStringArrayConst(source: string, name: string): string[] {
  const pattern = new RegExp(
    `const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as\\s+const`,
    "m",
  );
  const arrayMatch = source.match(pattern);
  if (!arrayMatch?.[1]) return [];
  return [...arrayMatch[1].matchAll(/"([^"]+\.md)"/g)].map((match) =>
    match[1] ?? ""
  );
}

function extractGuideContracts(source: string): string[] {
  return [...source.matchAll(/^\s+"([^"]+\.md)":\s+\{/gm)]
    .map((match) => match[1] ?? "")
    .sort();
}

function countDeclarationRows(pages: ReferencePage[]): {
  total: number;
  withSourceLinks: number;
  withoutSourceLinks: number;
  missingSourceLinkSamples: DeclarationLinkGap[];
} {
  let total = 0;
  let withSourceLinks = 0;
  let withoutSourceLinks = 0;
  const missingSourceLinkSamples: DeclarationLinkGap[] = [];

  for (const page of pages) {
    const lines = page.content.split("\n");
    let inCliCommandCatalog = false;
    for (const [index, line] of lines.entries()) {
      if (page.slug === "cli" && line === "## Commands") {
        inCliCommandCatalog = true;
      } else if (page.slug === "cli" && line === "## Exports") {
        inCliCommandCatalog = false;
      }

      if (inCliCommandCatalog) continue;

      const declaration = line.match(/^\|\s*`([^`]+)`\s*\|/)?.[1];
      if (!declaration) continue;
      total += 1;
      if (line.includes("[source](")) {
        withSourceLinks += 1;
        continue;
      }
      withoutSourceLinks += 1;
      if (missingSourceLinkSamples.length < 20) {
        missingSourceLinkSamples.push({
          page: `docs/api-reference/veryfront/${page.slug}.md`,
          line: index + 1,
          declaration,
        });
      }
    }
  }

  return {
    total,
    withSourceLinks,
    withoutSourceLinks,
    missingSourceLinkSamples,
  };
}

function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return "100.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function difference(expected: string[], actual: Set<string>): string[] {
  return expected.filter((item) => !actual.has(item));
}

function requiresReferenceBacklink(file: string): boolean {
  return !file.endsWith("/index.md") && !file.startsWith("concepts/");
}

export async function collectDocsCoverage(
  root = Deno.cwd(),
): Promise<DocsCoverageReport> {
  const denoConfig = JSON.parse(
    await Deno.readTextFile(fromRoot(root, "deno.json")),
  );
  const exportsMap =
    (denoConfig.exports as Record<string, string> | undefined) ?? {};
  const exportPaths = Object.keys(exportsMap);
  const topLevelExports = exportPaths.filter((path) =>
    path.split("/").length <= 2
  );

  const requiredSlugs = new Set<string>();
  for (const exportPath of exportPaths) {
    requiredSlugs.add(topLevelSlug(exportPath));
  }
  for (const slug of SYNTHETIC_PARENTS) requiredSlugs.add(slug);
  const requiredSlugList = [...requiredSlugs].sort();

  const referenceDir = fromRoot(root, "docs/api-reference/veryfront");
  const referenceFileNames = await listMarkdownFiles(referenceDir);
  const referenceSlugs = referenceFileNames.map((name) =>
    name.replace(/\.md$/, "")
  ).sort();
  const referenceSlugSet = new Set(referenceSlugs);
  const requiredSlugSet = new Set(requiredSlugList);
  const missingReferencePages = requiredSlugList.filter((slug) =>
    !referenceSlugSet.has(slug)
  );
  const extraReferencePages = referenceSlugs.filter((slug) =>
    !requiredSlugSet.has(slug)
  );

  const referencePages: ReferencePage[] = [];
  for (const slug of referenceSlugs) {
    referencePages.push({
      slug,
      content: await Deno.readTextFile(
        fromRoot(root, `docs/api-reference/veryfront/${slug}.md`),
      ),
    });
  }

  const declarations = countDeclarationRows(referencePages);

  const guidePages: GuidePage[] = [];
  for (const section of ["getting-started", "guides", "concepts"]) {
    const guideDir = fromRoot(root, `docs/${section}`);
    const guideFiles = (await listMarkdownFiles(guideDir)).filter((name) =>
      name !== "README.md"
    );
    for (const file of guideFiles) {
      const path = `docs/${section}/${file}`;
      guidePages.push({
        file,
        path,
        content: await Deno.readTextFile(fromRoot(root, path)),
      });
    }
  }
  const guideFiles = guidePages.map((page) => page.path.replace(/^docs\//, ""))
    .sort();
  const guideFilesRequiringReferenceBacklinks = guideFiles.filter(
    requiresReferenceBacklink,
  );
  const guideFileSet = new Set(guideFiles);
  const guideFilesWithCodeExamples: string[] = [];
  const guideLinkedReferenceSlugs = new Set<string>();

  for (const page of guidePages) {
    if (page.content.includes("```")) {
      guideFilesWithCodeExamples.push(page.path.replace(/^docs\//, ""));
    }
    for (
      const match of page.content.matchAll(
        /\.\.\/api-reference\/veryfront\/([a-z0-9-]+)\.md/g,
      )
    ) {
      guideLinkedReferenceSlugs.add(match[1] ?? "");
    }
  }

  const guideContractSourcePath = fromRoot(
    root,
    "tests/docs/guide-contracts.test.ts",
  );
  const contractFiles = await fileExists(guideContractSourcePath)
    ? extractGuideContracts(await Deno.readTextFile(guideContractSourcePath))
    : [];
  const contractFileSet = new Set(contractFiles);

  const codeExampleSourcePath = fromRoot(
    root,
    "tests/docs/guide-code-examples.test.ts",
  );
  let codeExampleFiles: string[] = [];
  if (await fileExists(codeExampleSourcePath)) {
    const codeExampleSource = await Deno.readTextFile(codeExampleSourcePath);
    const codeExampleNames = [
      ...extractStringArrayConst(
        codeExampleSource,
        "EXISTING_GUIDE_EXAMPLE_SUITE",
      ),
      ...extractStringArrayConst(
        codeExampleSource,
        "THIS_GUIDE_EXAMPLE_SUITE",
      ),
    ].sort();
    codeExampleFiles = codeExampleNames.map((name) => {
      const page = guidePages.find((candidate) => candidate.file === name);
      return page?.path.replace(/^docs\//, "") ?? name;
    }).sort();
  }
  const codeExampleFileSet = new Set(codeExampleFiles);

  const guidesLinkedFromReferencePages = new Set<string>();
  for (const page of referencePages) {
    for (
      const match of page.content.matchAll(
        /\.\.\/\.\.\/((?:getting-started|guides|concepts)\/[^)\s#]+\.md)/g,
      )
    ) {
      guidesLinkedFromReferencePages.add(match[1] ?? "");
    }
  }

  const guidesWithCodeExamples = guideFilesWithCodeExamples.sort();

  return {
    publicExports: {
      total: exportPaths.length,
      topLevel: topLevelExports.length,
      deep: exportPaths.length - topLevelExports.length,
    },
    apiDeclarations: declarations,
    referencePages: {
      required: requiredSlugList.length,
      present:
        requiredSlugList.filter((slug) => referenceSlugSet.has(slug)).length,
      missing: missingReferencePages,
      extra: extraReferencePages,
    },
    guides: {
      total: guideFiles.length,
      withContracts:
        guideFiles.filter((file) => contractFileSet.has(file)).length,
      contractMissing: difference(guideFiles, contractFileSet),
      contractStale: contractFiles.filter((file) => !guideFileSet.has(file)),
      withCodeExamples: guidesWithCodeExamples.length,
      withCodeExampleTests:
        guidesWithCodeExamples.filter((file) => codeExampleFileSet.has(file))
          .length,
      codeExampleMissing: difference(
        guidesWithCodeExamples,
        codeExampleFileSet,
      ),
      codeExampleStale: codeExampleFiles.filter((file) =>
        !guideFileSet.has(file)
      ),
    },
    links: {
      referenceModulesLinkedFromGuides:
        requiredSlugList.filter((slug) => guideLinkedReferenceSlugs.has(slug))
          .length,
      referenceModulesMissingGuideLinks: difference(
        requiredSlugList,
        guideLinkedReferenceSlugs,
      ),
      guidesLinkedFromReferencePages:
        guideFilesRequiringReferenceBacklinks.filter((file) =>
          guidesLinkedFromReferencePages.has(file)
        )
          .length,
      guidesMissingReferenceLinks: difference(
        guideFilesRequiringReferenceBacklinks,
        guidesLinkedFromReferencePages,
      ),
    },
  };
}

export function formatDocsCoverage(report: DocsCoverageReport): string {
  return [
    "Docs coverage",
    `Public exports: ${report.publicExports.total} total (${report.publicExports.topLevel} top-level, ${report.publicExports.deep} deep)`,
    `API declarations: ${report.apiDeclarations.withSourceLinks}/${report.apiDeclarations.total} with source links (${
      percent(
        report.apiDeclarations.withSourceLinks,
        report.apiDeclarations.total,
      )
    })`,
    `Reference pages: ${report.referencePages.present}/${report.referencePages.required} present, ${report.referencePages.missing.length} missing, ${report.referencePages.extra.length} extra`,
    `Guide contracts: ${report.guides.withContracts}/${report.guides.total} guides (${
      percent(report.guides.withContracts, report.guides.total)
    })`,
    `Guide code examples: ${report.guides.withCodeExampleTests}/${report.guides.withCodeExamples} guides with fenced examples tested (${
      percent(
        report.guides.withCodeExampleTests,
        report.guides.withCodeExamples,
      )
    })`,
    `Reference modules linked from guides: ${report.links.referenceModulesLinkedFromGuides}/${report.referencePages.required} modules (${
      percent(
        report.links.referenceModulesLinkedFromGuides,
        report.referencePages.required,
      )
    })`,
    `Guides linked from reference pages: ${report.links.guidesLinkedFromReferencePages}/${report.guides.total} guides (${
      percent(report.links.guidesLinkedFromReferencePages, report.guides.total)
    })`,
  ].join("\n");
}

function hasArg(name: string): boolean {
  return Deno.args.includes(name);
}

if (import.meta.main) {
  const report = await collectDocsCoverage();
  if (hasArg("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDocsCoverage(report));
  }
}
