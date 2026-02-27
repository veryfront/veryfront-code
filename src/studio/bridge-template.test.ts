import { assertStringIncludes } from "@std/assert";
import { generateStudioBridgeScript } from "#veryfront/studio/bridge-template.ts";

Deno.test("generateStudioBridgeScript produces valid JavaScript", () => {
  const script = generateStudioBridgeScript({
    projectId: "project-id",
    pageId: "file-id",
    pagePath: "docs/guide.md",
  });

  // Parse-only check to catch template-string escaping mistakes in generated bridge code.
  new Function(script);
});

Deno.test("generateStudioBridgeScript includes markdown collaboration actions", () => {
  const script = generateStudioBridgeScript({
    projectId: "project-id",
    pageId: "file-id",
    pagePath: "docs/guide.md",
  });

  assertStringIncludes(script, "markdownContentChange");
  assertStringIncludes(script, "setMarkdownPersistState");
  assertStringIncludes(script, "setMarkdownPresence");
  assertStringIncludes(script, "setMarkdownSelections");
  assertStringIncludes(script, "vf-markdown-editor__slash-menu");
  assertStringIncludes(script, "heading-1");
  assertStringIncludes(script, "image");
  assertStringIncludes(script, "handleMarkdownSlashMenuKeydown");
  assertStringIncludes(script, "vf-markdown-editor__inline-toolbar");
  assertStringIncludes(script, "toggleMarkdownInlineFormat");
  assertStringIncludes(script, "vf-markdown-editor__block-handle");
  assertStringIncludes(script, "vf-markdown-editor__block-drop-label");
  assertStringIncludes(script, "moveMarkdownLexicalBlock");
  assertStringIncludes(script, "getMarkdownBlockTypeInfo");
  assertStringIncludes(script, "@lexical/history");
  assertStringIncludes(script, "vf-markdown-editor__history");
  assertStringIncludes(script, "applyMarkdownHistoryCommand");
  assertStringIncludes(script, "autoScrollMarkdownSurfaceDuringDrag");
  assertStringIncludes(script, "moveMarkdownCurrentBlockByDelta");
  assertStringIncludes(script, "event.shiftKey || !event.altKey");
  assertStringIncludes(script, "getMarkdownRawBlockTokenPattern");
  assertStringIncludes(script, "tokenPrefix");
  assertStringIncludes(script, "openMarkdownSourceInStudio");
  assertStringIncludes(script, "isMdxPage");
  assertStringIncludes(script, "vf-markdown-editor__block-drag-ghost");
  assertStringIncludes(script, "setMarkdownMdxBlocks");
  assertStringIncludes(script, "vf-markdown-editor__mdx-blocks");
  assertStringIncludes(script, "parseMdxImportMap");
  assertStringIncludes(script, "mapNamedImports");
  assertStringIncludes(script, "stripImportComments");
  assertStringIncludes(script, "normalizeImportSpecifier");
  assertStringIncludes(script, "setImportEntry");
  assertStringIncludes(script, "importKind");
  assertStringIncludes(script, "typeOnlySpecifier");
  assertStringIncludes(script, "^type");
  assertStringIncludes(script, "resolveImportPathForPage");
  assertStringIncludes(script, "isLikelyProjectImportPath");
  assertStringIncludes(script, "guessStudioFilePath");
  assertStringIncludes(script, "openFilePathInStudio");
  assertStringIncludes(script, "symbolName");
  assertStringIncludes(script, "Open MDX source");
  assertStringIncludes(script, "Unresolved import");
});
