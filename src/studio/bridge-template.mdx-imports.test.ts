import { assertEquals } from "@std/assert";
import { generateStudioBridgeScript } from "#veryfront/studio/bridge-template.ts";

type BridgeDebugApi = {
  parseMdxImportMap: (content: string) => Record<
    string,
    { filePath: string; symbolName: string; importKind: string }
  >;
  extractRawBlocksForEditor: (
    body: string,
    importMap: Record<string, { filePath: string; symbolName: string; importKind: string }>,
  ) => {
    markdown: string;
    rawBlocks: string[];
    tokenPrefix: string;
    mdxBlocks: Array<{
      tokenIndex: number;
      label: string;
      lineNumber: number;
      filePath: string;
      symbolName: string;
    }>;
  };
  getMdxBlockOpenUiState: (
    block: { filePath?: string | null } | null,
  ) => { hasResolvedTarget: boolean; buttonLabel: string; showUnresolvedNote: boolean };
};

type WindowWithBridgeDebug = {
  __VF_STUDIO_BRIDGE_DEBUG?: BridgeDebugApi;
};

function loadBridgeDebugApi(pagePath = "docs/guide/page.mdx"): BridgeDebugApi {
  const script = generateStudioBridgeScript({
    projectId: "project-id",
    pageId: "page-id",
    pagePath,
    debugSkipInit: true,
    debugExposeInternals: true,
  });

  const previousWindow = (globalThis as { window?: WindowWithBridgeDebug }).window;
  const windowStub: WindowWithBridgeDebug = {};
  (globalThis as { window?: WindowWithBridgeDebug }).window = windowStub;
  try {
    new Function(script)();
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: WindowWithBridgeDebug }).window;
    } else {
      (globalThis as { window?: WindowWithBridgeDebug }).window = previousWindow;
    }
  }

  if (!windowStub.__VF_STUDIO_BRIDGE_DEBUG) {
    throw new Error("Bridge debug API not available");
  }
  return windowStub.__VF_STUDIO_BRIDGE_DEBUG;
}

Deno.test("parseMdxImportMap handles multiline/comments/default-as/type-only imports", () => {
  const debugApi = loadBridgeDebugApi("docs/guide/page.mdx");
  const importMap = debugApi.parseMdxImportMap(
    [
      "import React from 'react';",
      "import DefaultComp, {",
      "  /* explain */",
      "  Card as UiCard,",
      "  type Foo,",
      "  default as AliasDefault",
      "} from './components/ui';",
      "import type { OnlyType } from './types';",
      "import { Banner, // comment",
      "  Badge } from '~/widgets';",
      "import DefaultLayout, * as LayoutNS from '../layout';",
      "import { default as Header } from '/shared/header';",
    ].join("\n"),
  );

  assertEquals(importMap.React, undefined);
  assertEquals(importMap.Foo, undefined);
  assertEquals(importMap.OnlyType, undefined);

  assertEquals(importMap.DefaultComp, {
    filePath: "docs/guide/components/ui.tsx",
    symbolName: "",
    importKind: "default",
  });
  assertEquals(importMap.UiCard, {
    filePath: "docs/guide/components/ui.tsx",
    symbolName: "Card",
    importKind: "named",
  });
  assertEquals(importMap.AliasDefault, {
    filePath: "docs/guide/components/ui.tsx",
    symbolName: "",
    importKind: "default",
  });
  assertEquals(importMap.Banner, {
    filePath: "widgets.tsx",
    symbolName: "Banner",
    importKind: "named",
  });
  assertEquals(importMap.Badge, {
    filePath: "widgets.tsx",
    symbolName: "Badge",
    importKind: "named",
  });
  assertEquals(importMap.DefaultLayout, {
    filePath: "docs/layout.tsx",
    symbolName: "",
    importKind: "default",
  });
  assertEquals(importMap.LayoutNS, {
    filePath: "docs/layout.tsx",
    symbolName: "",
    importKind: "namespace",
  });
  assertEquals(importMap.Header, {
    filePath: "shared/header.tsx",
    symbolName: "",
    importKind: "default",
  });
});

Deno.test("getMdxBlockOpenUiState marks unresolved imports only when mapping is missing", () => {
  const debugApi = loadBridgeDebugApi();

  assertEquals(
    debugApi.getMdxBlockOpenUiState({ filePath: "components/Button.tsx" }),
    {
      hasResolvedTarget: true,
      buttonLabel: "Edit in Studio",
      showUnresolvedNote: false,
    },
  );

  assertEquals(
    debugApi.getMdxBlockOpenUiState({ filePath: "" }),
    {
      hasResolvedTarget: false,
      buttonLabel: "Open MDX source",
      showUnresolvedNote: true,
    },
  );

  assertEquals(
    debugApi.getMdxBlockOpenUiState(null),
    {
      hasResolvedTarget: false,
      buttonLabel: "Open MDX source",
      showUnresolvedNote: true,
    },
  );
});

Deno.test("extractRawBlocksForEditor marks resolved and unresolved MDX component blocks", () => {
  const debugApi = loadBridgeDebugApi("docs/guide/page.mdx");
  const source = [
    "import { Card as UiCard } from './components/ui';",
    "",
    "<UiCard />",
    "<UnknownBlock />",
    "",
    "```tsx",
    "export const Inline = () => <UiCard />;",
    "```",
  ].join("\n");

  const importMap = debugApi.parseMdxImportMap(source);
  const result = debugApi.extractRawBlocksForEditor(source, importMap);

  const uiCardBlock = result.mdxBlocks.find((block) => block.label.includes("UiCard"));
  if (!uiCardBlock) {
    throw new Error("Expected UiCard block to be extracted");
  }
  assertEquals(uiCardBlock.filePath, "docs/guide/components/ui.tsx");
  assertEquals(uiCardBlock.symbolName, "Card");

  const unknownBlock = result.mdxBlocks.find((block) => block.label.includes("UnknownBlock"));
  if (!unknownBlock) {
    throw new Error("Expected UnknownBlock to be extracted");
  }
  assertEquals(unknownBlock.filePath, "");
  assertEquals(unknownBlock.symbolName, "UnknownBlock");

  const tsxFenceBlock = result.mdxBlocks.find((block) => block.label === "TSX block");
  if (!tsxFenceBlock) {
    throw new Error("Expected TSX fence block to be extracted");
  }
  assertEquals(tsxFenceBlock.filePath, "docs/guide/components/ui.tsx");
  assertEquals(tsxFenceBlock.symbolName, "Card");
});
