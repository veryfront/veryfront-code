#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=BABEL_TYPES_8_BREAKING

import { parse } from "npm:@babel/parser@7.29.2";
import * as generateModule from "npm:@babel/generator@7.29.1";
import process from "node:process";
import type traverseDefault from "npm:@babel/traverse@7.29.0";
import type { NodePath } from "npm:@babel/traverse@7.29.0";
import * as t from "npm:@babel/types@7.29.0";

// @babel/traverse loads `debug`, which enumerates process.env at module load.
// Keep the codemod's env permission limited to Babel's compatibility flag.
const traverseModule = await (async () => {
  const originalEnv = process.env;
  const babelTypes8Breaking = originalEnv.BABEL_TYPES_8_BREAKING;
  process.env = babelTypes8Breaking === undefined
    ? {}
    : { BABEL_TYPES_8_BREAKING: babelTypes8Breaking };
  try {
    return await import("npm:@babel/traverse@7.29.0");
  } finally {
    process.env = originalEnv;
  }
})();

const CHAT_COMPONENT_IMPORTS = new Set([
  "veryfront/chat",
  "veryfront/react",
  "veryfront/react/components/chat",
]);
const USE_CHAT_IMPORTS = new Set([
  "veryfront/chat",
  "veryfront/react",
  "veryfront/agent/react",
]);
const MIGRATION_GUIDE =
  "https://github.com/veryfront/veryfront-code/blob/main/docs/plans/MIGRATION-chat-breaking.md";

const IMPORT_RENAMES = new Map<string, string>([
  ["Attachment", "AttachmentPill"],
  ["AttachmentProps", "AttachmentPillProps"],
  ["UploadsPanel", "AttachmentsPanel"],
  ["UploadsPanelProps", "AttachmentsPanelProps"],
  ["ChatComposer", "ChatInput"],
  ["ChatComposerProps", "ChatInputProps"],
  ["ChatComponents", "Chat"],
  ["StandaloneMessage", "Message"],
  ["StandaloneMessageProps", "MessageProps"],
  ["StreamingMessage", "Message"],
  ["StreamingMessageProps", "MessageProps"],
  ["MessageActions", "MessageActionBar"],
  ["MessageActionsProps", "MessageActionBarProps"],
  ["ReasoningCard", "Reasoning"],
  ["ToolCallCard", "ToolCall"],
]);

const FLAT_CHAT_PROPS = new Set([
  "messages",
  "input",
  "onChange",
  "onSubmit",
  "sendMessage",
  "stop",
  "reload",
  "setInput",
  "isLoading",
  "error",
  "renderTool",
  "models",
  "model",
  "activeModel",
  "onModelChange",
  "inferenceMode",
  "editMessage",
  "getBranches",
  "switchBranch",
  "quickActions",
  "onQuickAction",
  "activeTab",
  "onTabChange",
  "uploads",
  "onRemoveUpload",
  "onVoice",
]);

const USE_CHAT_MEMBER_RENAMES = new Map<string, string>([
  ["onChange", "handleInputChange"],
  ["onSubmit", "handleSubmit"],
  ["onModelChange", "setModel"],
]);

const FLAT_CHAT_MEMBER_NAMES = new Map<string, readonly string[]>([
  ["onChange", ["onChange", "handleInputChange"]],
  ["onSubmit", ["onSubmit", "handleSubmit"]],
  ["onModelChange", ["onModelChange", "setModel"]],
]);

const REMOVED_RENDER_TOOL_COMPONENTS = new Set([
  "Chat",
  "ChatMessageList",
  "MessageContent",
  "MessagePart",
  "AgentCard",
]);

const REMOVED_PROP_MIGRATIONS: Record<string, Record<string, string>> = {
  ChatInput: {
    messages: "Move messages to ChatInput.Export.messages.",
    onExportClick: "Move onExportClick to ChatInput.Export.onClick.",
  },
  AgentPickerContent: {
    searchPlaceholder: "Move searchPlaceholder to AgentPicker.Search.placeholder.",
  },
  ModelSelectorContent: {
    searchPlaceholder: "Move searchPlaceholder to ModelSelector.Search.placeholder.",
  },
};

const DEFAULT_TOGGLES: Record<string, Record<string, boolean>> = {
  Chat: {
    showScrollButton: true,
    showMessageActions: true,
    showSources: true,
    showSteps: true,
    enableAttachments: true,
    showExport: false,
    showTabs: false,
    hideTabSwitcher: true,
    enableVoice: false,
  },
  Message: {
    showSources: true,
    showSteps: true,
  },
  MessageContent: {
    showSources: false,
    showSteps: true,
  },
  MessagePart: {
    showSteps: true,
  },
  ChatMessageList: {
    showMessageActions: true,
    showSources: true,
    showSteps: true,
    showScrollButton: false,
  },
  ChatInput: {
    showExport: false,
  },
  ChatRoot: {
    showSources: false,
  },
  AgentPickerContent: {
    showSearch: false,
  },
  ModelSelectorContent: {
    showSearch: false,
  },
  Markdown: {
    enableMermaid: false,
  },
};

interface BabelGeneratorResult {
  code: string;
}

type GenerateFunction = (
  ast: t.Node,
  options?: Record<string, unknown>,
  source?: string,
) => BabelGeneratorResult;

interface ModuleWithDefault<T> {
  default: T | { default: T };
}

function resolveDefaultExport<T>(module: unknown): T {
  const candidate = module as ModuleWithDefault<T>;
  if (typeof candidate.default === "function") return candidate.default as T;
  const nested = candidate.default as { default?: T } | undefined;
  if (typeof nested?.default === "function") return nested.default as T;
  return module as T;
}

const generate = resolveDefaultExport<GenerateFunction>(generateModule);
const traverse = resolveDefaultExport<typeof traverseDefault>(traverseModule);

export interface ChatCodemodResult {
  code: string;
  changed: boolean;
  warnings: string[];
}

function importedName(specifier: t.ImportSpecifier): string | undefined {
  if (t.isIdentifier(specifier.imported)) return specifier.imported.name;
  return specifier.imported.value;
}

function jsxName(
  name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName,
): string {
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) {
    return jsxName(name.object) + "." + jsxName(name.property);
  }
  return name.namespace.name + ":" + name.name.name;
}

function jsxRootIdentifier(
  name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName,
): t.JSXIdentifier | undefined {
  if (t.isJSXIdentifier(name)) return name;
  if (t.isJSXMemberExpression(name)) return jsxRootIdentifier(name.object);
  return undefined;
}

function canonicalElementName(fullName: string, canonicalBase: string): string {
  const member = fullName.includes(".") ? fullName.slice(fullName.indexOf(".") + 1) : undefined;
  if (!member) return canonicalBase;
  if (canonicalBase === "Chat") {
    if (member === "Root") return "ChatRoot";
    if (member === "MessageList") return "ChatMessageList";
    if (member === "Input" || member === "Composer") return "ChatInput";
    if (member === "Message") return "Message";
    if (member.startsWith("Message.")) {
      return canonicalElementName(member, "Message");
    }
  }
  if (canonicalBase === "Message") {
    if (member === "Content") return "MessageContent";
    if (member === "Part") return "MessagePart";
    if (member === "Tokens") return "MessageTokens";
  }
  if (canonicalBase === "AgentPicker" && member === "Content") {
    return "AgentPickerContent";
  }
  if (canonicalBase === "ModelSelector" && member === "Content") {
    return "ModelSelectorContent";
  }
  return canonicalBase + member.replaceAll(".", "");
}

function attributeName(attribute: t.JSXAttribute): string | undefined {
  return t.isJSXIdentifier(attribute.name) ? attribute.name.name : undefined;
}

function booleanAttributeValue(attribute: t.JSXAttribute): boolean | undefined {
  if (attribute.value == null) return true;
  if (!t.isJSXExpressionContainer(attribute.value)) return undefined;
  if (t.isBooleanLiteral(attribute.value.expression)) {
    return attribute.value.expression.value;
  }
  return undefined;
}

function expressionValue(attribute: t.JSXAttribute): t.Expression | undefined {
  if (!t.isJSXExpressionContainer(attribute.value)) return undefined;
  return t.isExpression(attribute.value.expression) ? attribute.value.expression : undefined;
}

function memberBaseForAttribute(
  attribute: t.JSXAttribute,
  expectedProperty: string | readonly string[],
): t.Identifier | undefined {
  const expression = expressionValue(attribute);
  if (!expression || !t.isMemberExpression(expression) || expression.computed) {
    return undefined;
  }
  if (
    !t.isIdentifier(expression.object) || !t.isIdentifier(expression.property)
  ) return undefined;
  const expected = typeof expectedProperty === "string" ? [expectedProperty] : expectedProperty;
  return expected.includes(expression.property.name) ? expression.object : undefined;
}

function identifiersShareBinding(
  left: t.Identifier,
  right: t.Identifier,
  bindings: WeakMap<t.Node, object>,
): boolean {
  const leftBinding = bindings.get(left);
  const rightBinding = bindings.get(right);
  if (leftBinding || rightBinding) return leftBinding !== undefined && leftBinding === rightBinding;
  return left.name === right.name;
}

function hasAttribute(opening: t.JSXOpeningElement, name: string): boolean {
  return opening.attributes.some((attribute) =>
    t.isJSXAttribute(attribute) && attributeName(attribute) === name
  );
}

function addTodo(
  node: t.JSXElement | t.JSXFragment,
  message: string,
  preferredAnchor?: t.JSXAttribute | t.JSXSpreadAttribute,
): void {
  const value = ` TODO(veryfront-migration): ${message} See ${MIGRATION_GUIDE}. `;
  const anchor = preferredAnchor ??
    (t.isJSXElement(node) ? node.openingElement.attributes[0] : undefined);
  if (!anchor) return;
  // A comment on the JSX element itself becomes visible JSX text when nested.
  // Anchor it inside the opening tag, where it stays a non-rendering JS comment.
  const comments = anchor.leadingComments ?? [];
  if (comments.some((comment) => comment.value.includes(message))) return;
  anchor.leadingComments = [...comments, { type: "CommentBlock", value }];
}

function addNodeTodo(node: t.Node, message: string): void {
  const value = ` TODO(veryfront-migration): ${message} See ${MIGRATION_GUIDE}. `;
  const comments = node.leadingComments ?? [];
  if (comments.some((comment) => comment.value.includes(message))) return;
  node.leadingComments = [...comments, { type: "CommentBlock", value }];
}

function walkAst(node: t.Node, visit: (node: t.Node) => void): void {
  visit(node);
  const keys = (t.VISITOR_KEYS as Record<string, readonly string[]>)[node.type] ?? [];
  const record = node as unknown as Record<string, unknown>;
  for (const key of keys) {
    const child = record[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && "type" in item) {
          walkAst(item as t.Node, visit);
        }
      }
    } else if (child && typeof child === "object" && "type" in child) {
      walkAst(child as t.Node, visit);
    }
  }
}

function rewriteFlatChatSession(
  element: t.JSXElement,
  warnings: string[],
  isChatResultReference: (node: t.Identifier) => boolean,
  sameBinding: (left: t.Identifier, right: t.Identifier) => boolean,
): boolean {
  const opening = element.openingElement;
  let changed = false;
  const existingChat = opening.attributes.find((attribute) =>
    t.isJSXAttribute(attribute) && attributeName(attribute) === "chat"
  );
  const existingChatExpression = existingChat && t.isJSXAttribute(existingChat)
    ? expressionValue(existingChat)
    : undefined;
  let session = t.isIdentifier(existingChatExpression) ? existingChatExpression : undefined;

  const sessionSpreads = opening.attributes.filter(
    (attribute): attribute is t.JSXSpreadAttribute =>
      t.isJSXSpreadAttribute(attribute) &&
      t.isIdentifier(attribute.argument) &&
      isChatResultReference(attribute.argument),
  );
  if (sessionSpreads.length > 0) {
    const sessionSpreadSet = new Set(sessionSpreads);
    const otherSpreads = opening.attributes.filter((attribute) =>
      t.isJSXSpreadAttribute(attribute) && !sessionSpreadSet.has(attribute)
    );
    const spreadSessions = sessionSpreads.map((attribute) => attribute.argument as t.Identifier);
    const spreadSession = spreadSessions[0];

    if (otherSpreads.length > 0) {
      addTodo(
        element,
        "Reconcile the useChat result with the other spread props before migrating Chat.",
        sessionSpreads[0],
      );
      warnings.push(
        "A Chat element mixes a useChat result with another spread.",
      );
      return true;
    }

    if (!spreadSessions.every((candidate) => sameBinding(spreadSession, candidate))) {
      addTodo(
        element,
        "Reconcile the spread useChat sessions before migrating Chat.",
        sessionSpreads[0],
      );
      warnings.push("A Chat element spreads different useChat results.");
      return true;
    }

    if (existingChat && (!session || !sameBinding(session, spreadSession))) {
      addTodo(
        element,
        "Reconcile the spread useChat session with the explicit chat prop.",
        sessionSpreads[0],
      );
      warnings.push(
        "A Chat element uses different useChat results for chat and a spread.",
      );
      return true;
    } else {
      opening.attributes = opening.attributes.filter((attribute) =>
        !(t.isJSXSpreadAttribute(attribute) && sessionSpreadSet.has(attribute))
      );
      changed = true;
      if (!existingChat) {
        session = spreadSession;
        opening.attributes.unshift(
          t.jsxAttribute(
            t.jsxIdentifier("chat"),
            t.jsxExpressionContainer(t.cloneNode(spreadSession)),
          ),
        );
      }
    }
  }

  if (!hasAttribute(opening, "chat")) {
    const attributes = opening.attributes.filter(t.isJSXAttribute);
    const messages = attributes.find((attribute) => attributeName(attribute) === "messages");
    const input = attributes.find((attribute) => attributeName(attribute) === "input");
    const inferredSession = messages && input
      ? memberBaseForAttribute(messages, "messages")
      : undefined;
    const inputSession = input ? memberBaseForAttribute(input, "input") : undefined;
    if (inferredSession && inputSession && sameBinding(inferredSession, inputSession)) {
      const remainingSpread = opening.attributes.find(t.isJSXSpreadAttribute);
      if (remainingSpread) {
        addTodo(
          element,
          "Reconcile the spread props before inferring the Chat session.",
          remainingSpread,
        );
        warnings.push(
          "A Chat session cannot be inferred safely beside spread props.",
        );
        return true;
      }
      session = inferredSession;
      opening.attributes.unshift(
        t.jsxAttribute(
          t.jsxIdentifier("chat"),
          t.jsxExpressionContainer(t.cloneNode(inferredSession)),
        ),
      );
      changed = true;
    }
  }

  if (hasAttribute(opening, "chat")) {
    const flat = opening.attributes.filter(
      (attribute): attribute is t.JSXAttribute =>
        t.isJSXAttribute(attribute) &&
        FLAT_CHAT_PROPS.has(attributeName(attribute) ?? ""),
    );
    if (
      flat.length > 0 &&
      opening.attributes.some(t.isJSXSpreadAttribute)
    ) {
      addTodo(
        element,
        "Reconcile the flat Chat props with the explicit session and spread props.",
        flat[0],
      );
      warnings.push(
        "Flat Chat props beside an explicit session and spread require manual migration.",
      );
      return true;
    }
    opening.attributes = opening.attributes.filter((attribute) => {
      if (!t.isJSXAttribute(attribute)) return true;
      const name = attributeName(attribute);
      if (!name || !FLAT_CHAT_PROPS.has(name)) return true;
      const memberNames = FLAT_CHAT_MEMBER_NAMES.get(name) ?? name;
      const memberBase = memberBaseForAttribute(attribute, memberNames);
      if (!session || !memberBase || !sameBinding(memberBase, session)) return true;
      changed = true;
      return false;
    });
    const remaining = opening.attributes.filter((attribute) =>
      t.isJSXAttribute(attribute) &&
      FLAT_CHAT_PROPS.has(attributeName(attribute) ?? "")
    );
    if (remaining.length > 0) {
      addTodo(
        element,
        "Move the remaining flat Chat props into the useChat session or composition leaves.",
        remaining[0],
      );
      warnings.push(
        "A Chat session rewrite left flat props that require manual migration.",
      );
      changed = true;
    }
    return changed;
  }

  const flat = opening.attributes.filter((attribute) =>
    t.isJSXAttribute(attribute) &&
    FLAT_CHAT_PROPS.has(attributeName(attribute) ?? "")
  );
  if (flat.length > 0) {
    addTodo(
      element,
      "Replace the flat Chat session props with chat={useChat()}.",
      flat[0],
    );
    warnings.push(
      "Flat Chat props could not be associated with one useChat result.",
    );
    return true;
  }
  return false;
}

function rewriteToggles(
  element: t.JSXElement,
  canonicalElement: string,
  warnings: string[],
): boolean {
  const defaults = DEFAULT_TOGGLES[canonicalElement];
  if (!defaults) return false;
  const toggleAttributes = element.openingElement.attributes.filter(
    (attribute): attribute is t.JSXAttribute =>
      t.isJSXAttribute(attribute) &&
      (attributeName(attribute) ?? "") in defaults,
  );
  if (
    toggleAttributes.length > 0 &&
    element.openingElement.attributes.some(t.isJSXSpreadAttribute)
  ) {
    const names = toggleAttributes.map((attribute) => attributeName(attribute));
    addTodo(
      element,
      `Reconcile ${names.join(", ")} with the spread props before compound migration.`,
      toggleAttributes[0],
    );
    warnings.push(
      `Presence-driven props on ${canonicalElement} require manual migration beside a spread: ${
        names.join(", ")
      }.`,
    );
    return true;
  }
  let changed = false;
  const manual: t.JSXAttribute[] = [];
  element.openingElement.attributes = element.openingElement.attributes.filter(
    (attribute) => {
      if (!t.isJSXAttribute(attribute)) return true;
      const name = attributeName(attribute);
      if (!name || !(name in defaults)) return true;
      const value = booleanAttributeValue(attribute);
      if (value === defaults[name]) {
        changed = true;
        return false;
      }
      manual.push(attribute);
      return true;
    },
  );
  if (manual.length > 0) {
    const names = manual.map((attribute) => attributeName(attribute));
    addTodo(
      element,
      `Replace ${names.join(", ")} with presence-driven compound children.`,
      manual[0],
    );
    warnings.push(
      `Presence-driven migration required for ${canonicalElement}: ${names.join(", ")}.`,
    );
    changed = true;
  }
  return changed;
}

function rewriteRemovedSlots(
  element: t.JSXElement,
  warnings: string[],
): boolean {
  const removed = element.openingElement.attributes.filter(
    (attribute): attribute is t.JSXAttribute => {
      if (!t.isJSXAttribute(attribute)) return false;
      const name = attributeName(attribute);
      return name === "icons" || name === "contentClassName" ||
        name === "cardClassName";
    },
  );
  if (removed.length === 0) return false;
  addTodo(
    element,
    "Move removed icon and class-name bags to the matching compound leaf.",
    removed[0],
  );
  warnings.push(
    "A removed icon or class-name bag requires compound-leaf migration.",
  );
  return true;
}

function rewriteRemovedProps(
  element: t.JSXElement,
  canonicalElement: string,
  warnings: string[],
): boolean {
  const migrations = REMOVED_PROP_MIGRATIONS[canonicalElement];
  if (!migrations) return false;

  const removed = element.openingElement.attributes.filter(
    (attribute): attribute is t.JSXAttribute =>
      t.isJSXAttribute(attribute) &&
      (attributeName(attribute) ?? "") in migrations,
  );
  if (removed.length === 0) return false;

  const instructions = removed.flatMap((attribute) => {
    const name = attributeName(attribute);
    return name ? [migrations[name]] : [];
  });
  addTodo(element, instructions.join(" "), removed[0]);
  warnings.push(
    `Removed ${canonicalElement} props require compound-leaf migration: ${
      removed.map((attribute) => attributeName(attribute)).join(", ")
    }.`,
  );
  return true;
}

function renderItemAdapter(
  expression: t.Expression,
  includeIndex: boolean,
): t.ArrowFunctionExpression {
  return t.arrowFunctionExpression(
    [
      t.objectPattern([
        t.objectProperty(t.identifier("item"), t.identifier("item"), false, true),
        t.objectProperty(t.identifier("index"), t.identifier("index"), false, true),
      ]),
    ],
    t.callExpression(
      t.cloneNode(expression, true),
      includeIndex ? [t.identifier("item"), t.identifier("index")] : [t.identifier("item")],
    ),
  );
}

function rewriteLegacyRenderProps(
  element: t.JSXElement,
  canonicalElement: string,
  warnings: string[],
  isStableReference: (node: t.Identifier) => boolean,
): boolean {
  const renderProps = element.openingElement.attributes.filter(
    (attribute): attribute is t.JSXAttribute => {
      if (!t.isJSXAttribute(attribute)) return false;
      const name = attributeName(attribute);
      return name === "renderPill" && canonicalElement === "Sources" ||
        name === "renderRow" && canonicalElement === "MessageTokens" ||
        (name === "renderTrigger" || name === "renderRow") &&
          canonicalElement === "ModelSelector" ||
        name === "renderCard" && canonicalElement === "InlineCitation" ||
        name === "renderSkill" && canonicalElement === "ToolCall";
    },
  );
  if (
    renderProps.length > 0 &&
    element.openingElement.attributes.some(t.isJSXSpreadAttribute)
  ) {
    const names = renderProps.map((attribute) => attributeName(attribute));
    addTodo(
      element,
      `Reconcile ${names.join(", ")} with the spread props before render-prop migration.`,
      renderProps[0],
    );
    warnings.push(
      `A render prop on ${canonicalElement} requires manual migration beside a spread: ${
        names.join(", ")
      }.`,
    );
    return true;
  }

  let changed = false;
  const manual: t.JSXAttribute[] = [];
  for (const attribute of element.openingElement.attributes) {
    if (!t.isJSXAttribute(attribute)) continue;
    const name = attributeName(attribute);
    if (name === "renderPill" && canonicalElement === "Sources") {
      const expression = expressionValue(attribute);
      if (t.isIdentifier(expression) && isStableReference(expression)) {
        attribute.name = t.jsxIdentifier("renderItem");
        attribute.value = t.jsxExpressionContainer(renderItemAdapter(expression, true));
        changed = true;
      } else {
        manual.push(attribute);
      }
    } else if (name === "renderRow" && canonicalElement === "MessageTokens") {
      const expression = expressionValue(attribute);
      if (t.isIdentifier(expression) && isStableReference(expression)) {
        attribute.name = t.jsxIdentifier("renderItem");
        attribute.value = t.jsxExpressionContainer(renderItemAdapter(expression, false));
        changed = true;
      } else {
        manual.push(attribute);
      }
    } else if (
      (name === "renderTrigger" || name === "renderRow") &&
        canonicalElement === "ModelSelector" ||
      name === "renderCard" && canonicalElement === "InlineCitation" ||
      name === "renderSkill" && canonicalElement === "ToolCall"
    ) {
      manual.push(attribute);
    }
  }
  if (manual.length > 0) {
    const names = manual.map((attribute) => attributeName(attribute));
    addTodo(
      element,
      `Replace ${names.join(", ")} with compound children or canonical renderItem composition.`,
      manual[0],
    );
    warnings.push(`Manual render-prop migration required: ${names.join(", ")}.`);
    changed = true;
  }
  return changed;
}

/** Migrate a TypeScript/JSX module to the breaking chat composition surface. */
export function migrateChatComposition(source: string): ChatCodemodResult {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const componentImports: Array<{ localName: string; canonicalName: string }> = [];
  const useChatImportNames: string[] = [];
  let changed = false;
  const warnings: string[] = [];

  for (const statement of ast.program.body) {
    if (!t.isImportDeclaration(statement)) continue;
    const importSource = statement.source.value;
    const hasChatComponents = CHAT_COMPONENT_IMPORTS.has(importSource);
    const hasUseChat = USE_CHAT_IMPORTS.has(importSource);
    if (!hasChatComponents && !hasUseChat) continue;
    for (const specifier of statement.specifiers) {
      if (!t.isImportSpecifier(specifier)) continue;
      const imported = importedName(specifier);
      if (!imported) continue;
      if (hasUseChat && imported === "useChat") {
        useChatImportNames.push(specifier.local.name);
      }
      if (!hasChatComponents) continue;
      const replacement = IMPORT_RENAMES.get(imported);
      if (replacement) {
        specifier.imported = t.identifier(replacement);
        changed = true;
      }
      componentImports.push({
        localName: specifier.local.name,
        canonicalName: replacement ?? imported,
      });
    }
  }

  let rootPath: NodePath<t.Program> | undefined;
  const referenceBindings = new WeakMap<t.Node, object>();
  const stableReferences = new WeakSet<t.Node>();
  traverse(ast, {
    Program(path: NodePath<t.Program>) {
      rootPath = path;
    },
    Identifier(path: NodePath<t.Identifier>) {
      if (!path.isReferencedIdentifier()) return;
      const binding = path.scope.getBinding(path.node.name);
      if (binding) {
        referenceBindings.set(path.node, binding);
        if (binding.constant) stableReferences.add(path.node);
      }
    },
  });
  if (!rootPath) throw new Error("Unable to resolve the parsed module scope.");

  const componentCanonicalByReference = new WeakMap<t.Node, string>();
  for (const componentImport of componentImports) {
    const binding = rootPath.scope.getBinding(componentImport.localName);
    if (!binding) continue;
    for (const reference of binding.referencePaths) {
      componentCanonicalByReference.set(reference.node, componentImport.canonicalName);
      referenceBindings.set(reference.node, binding);
    }
  }

  const useChatReferences = new WeakSet<t.Node>();
  for (const localName of useChatImportNames) {
    const binding = rootPath.scope.getBinding(localName);
    if (!binding) continue;
    for (const reference of binding.referencePaths) useChatReferences.add(reference.node);
  }

  const chatResultReferences = new WeakSet<t.Node>();
  traverse(ast, {
    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      const node = path.node;
      if (!t.isVariableDeclarator(node) || !t.isCallExpression(node.init)) return;
      if (!t.isIdentifier(node.init.callee) || !useChatReferences.has(node.init.callee)) return;
      if (t.isIdentifier(node.id)) {
        const binding = path.scope.getBinding(node.id.name);
        if (binding) {
          if (!binding.constant) {
            addNodeTodo(
              path.parentPath?.node ?? node,
              `Review the reassigned useChat result ${node.id.name} manually.`,
            );
            warnings.push(
              `A reassigned useChat result requires manual migration: ${node.id.name}.`,
            );
            changed = true;
            return;
          }
          for (const reference of binding.referencePaths) {
            chatResultReferences.add(reference.node);
            referenceBindings.set(reference.node, binding);
          }
        }
        return;
      }
      if (!t.isObjectPattern(node.id)) return;
      for (const property of node.id.properties) {
        if (!t.isObjectProperty(property) || property.computed || !t.isIdentifier(property.key)) {
          continue;
        }
        const replacement = USE_CHAT_MEMBER_RENAMES.get(property.key.name);
        if (!replacement) continue;
        property.key = t.identifier(replacement);
        property.shorthand = false;
        changed = true;
      }
    },
  });

  const sameBinding = (left: t.Identifier, right: t.Identifier) =>
    identifiersShareBinding(left, right, referenceBindings);

  walkAst(ast.program as unknown as t.Node, (node) => {
    if (
      t.isMemberExpression(node) &&
      !node.computed &&
      t.isIdentifier(node.object) &&
      chatResultReferences.has(node.object) &&
      t.isIdentifier(node.property)
    ) {
      const replacement = USE_CHAT_MEMBER_RENAMES.get(node.property.name);
      if (replacement) {
        node.property.name = replacement;
        changed = true;
      }
      return;
    }
    if (
      t.isJSXMemberExpression(node) &&
      t.isJSXIdentifier(node.object) &&
      t.isJSXIdentifier(node.property) &&
      componentCanonicalByReference.get(node.object) === "Chat" &&
      node.property.name === "Composer"
    ) {
      node.property.name = "Input";
      changed = true;
      return;
    }
    if (!t.isJSXElement(node)) return;
    const fullName = jsxName(node.openingElement.name);
    const rootIdentifier = jsxRootIdentifier(node.openingElement.name);
    const canonicalBase = rootIdentifier
      ? componentCanonicalByReference.get(rootIdentifier)
      : undefined;
    if (!canonicalBase) return;
    const canonical = canonicalElementName(fullName, canonicalBase);
    if (canonical === "Chat" && !fullName.includes(".")) {
      changed = rewriteFlatChatSession(
        node,
        warnings,
        (identifier) => chatResultReferences.has(identifier),
        sameBinding,
      ) || changed;
    }
    changed = rewriteToggles(node, canonical, warnings) || changed;
    changed = rewriteRemovedProps(node, canonical, warnings) || changed;
    changed = rewriteRemovedSlots(node, warnings) || changed;
    changed = rewriteLegacyRenderProps(
      node,
      canonical,
      warnings,
      (identifier) => stableReferences.has(identifier),
    ) || changed;
    if (
      REMOVED_RENDER_TOOL_COMPONENTS.has(canonical) &&
      hasAttribute(node.openingElement, "renderTool")
    ) {
      const renderTool = node.openingElement.attributes.find((attribute) =>
        t.isJSXAttribute(attribute) && attributeName(attribute) === "renderTool"
      );
      addTodo(
        node,
        "Move renderTool logic into a Message.Content function child.",
        renderTool,
      );
      warnings.push("renderTool requires a manual Message.Content migration.");
      changed = true;
    }
  });

  if (!changed) return { code: source, changed: false, warnings };
  return {
    code: generate(ast as unknown as t.Node, {
      comments: true,
      retainLines: false,
      jsescOption: { minimal: true },
    }, source).code + (source.endsWith("\n") ? "\n" : ""),
    changed: true,
    warnings,
  };
}

interface CliOptions {
  paths: string[];
  check: boolean;
  dryRun: boolean;
}

export function parseCliOptions(args: string[]): CliOptions {
  const paths: string[] = [];
  let check = false;
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--") continue;
    if (arg === "--check") check = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: deno task codemod:chat -- [--check] [--dry-run] <file-or-directory> [...]",
      );
      Deno.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else paths.push(arg);
  }
  if (paths.length === 0) {
    throw new Error("Provide at least one file or directory.");
  }
  return { paths, check, dryRun };
}

async function collectSourceFiles(
  path: string,
  files: string[],
): Promise<void> {
  const stat = await Deno.stat(path);
  if (stat.isFile) {
    if (/\.[cm]?[jt]sx?$/.test(path)) files.push(path);
    return;
  }
  if (!stat.isDirectory) return;
  for await (const entry of Deno.readDir(path)) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    await collectSourceFiles(`${path}/${entry.name}`, files);
  }
}

async function main(args: string[]): Promise<void> {
  const options = parseCliOptions(args);
  const files: string[] = [];
  for (const path of options.paths) await collectSourceFiles(path, files);
  files.sort();

  let changedCount = 0;
  let warningCount = 0;
  for (const file of files) {
    const source = await Deno.readTextFile(file);
    const result = migrateChatComposition(source);
    if (!result.changed) continue;
    changedCount++;
    warningCount += result.warnings.length;
    if (options.dryRun && files.length === 1) console.log(result.code);
    else if (!options.check && !options.dryRun) {
      await Deno.writeTextFile(file, result.code);
    }
    console.error(
      `${options.check || options.dryRun ? "Would migrate" : "Migrated"} ${file}`,
    );
    for (const warning of result.warnings) console.error(`  ${warning}`);
  }

  console.error(
    `${
      options.check || options.dryRun ? "Found" : "Migrated"
    } ${changedCount} file(s), ${warningCount} manual follow-up(s).`,
  );
  if (options.check && changedCount > 0) Deno.exit(1);
}

if (import.meta.main) {
  await main(Deno.args);
}
