#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=BABEL_TYPES_8_BREAKING

import { parse } from "npm:@babel/parser@7.29.2";
import * as generateModule from "npm:@babel/generator@7.29.1";
import * as t from "npm:@babel/types@7.29.0";

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

function canonicalElementName(fullName: string, canonicalBase: string): string {
  const member = fullName.includes(".") ? fullName.slice(fullName.indexOf(".") + 1) : undefined;
  if (!member) return canonicalBase;
  if (canonicalBase === "Chat") {
    if (member === "Root") return "ChatRoot";
    if (member === "MessageList") return "ChatMessageList";
    if (member === "Input" || member === "Composer") return "ChatInput";
    if (member === "Message") return "Message";
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
  return canonicalBase;
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
): string | undefined {
  const expression = expressionValue(attribute);
  if (!expression || !t.isMemberExpression(expression) || expression.computed) {
    return undefined;
  }
  if (
    !t.isIdentifier(expression.object) || !t.isIdentifier(expression.property)
  ) return undefined;
  const expected = typeof expectedProperty === "string" ? [expectedProperty] : expectedProperty;
  return expected.includes(expression.property.name) ? expression.object.name : undefined;
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
  chatResultNames: ReadonlySet<string>,
): boolean {
  const opening = element.openingElement;
  let changed = false;
  const existingChat = opening.attributes.find((attribute) =>
    t.isJSXAttribute(attribute) && attributeName(attribute) === "chat"
  );
  const existingChatExpression = existingChat && t.isJSXAttribute(existingChat)
    ? expressionValue(existingChat)
    : undefined;
  let session = t.isIdentifier(existingChatExpression) ? existingChatExpression.name : undefined;

  const sessionSpread = opening.attributes.find((attribute) =>
    t.isJSXSpreadAttribute(attribute) &&
    t.isIdentifier(attribute.argument) &&
    chatResultNames.has(attribute.argument.name)
  );
  if (sessionSpread && t.isJSXSpreadAttribute(sessionSpread)) {
    const spreadSession = (sessionSpread.argument as t.Identifier).name;
    opening.attributes = opening.attributes.filter((attribute) => attribute !== sessionSpread);
    changed = true;
    if (!existingChat) {
      session = spreadSession;
      opening.attributes.unshift(
        t.jsxAttribute(
          t.jsxIdentifier("chat"),
          t.jsxExpressionContainer(t.identifier(spreadSession)),
        ),
      );
    }
  }

  if (!hasAttribute(opening, "chat")) {
    const attributes = opening.attributes.filter(t.isJSXAttribute);
    const messages = attributes.find((attribute) => attributeName(attribute) === "messages");
    const input = attributes.find((attribute) => attributeName(attribute) === "input");
    const inferredSession = messages && input
      ? memberBaseForAttribute(messages, "messages")
      : undefined;
    if (inferredSession && memberBaseForAttribute(input!, "input") === inferredSession) {
      session = inferredSession;
      opening.attributes.unshift(
        t.jsxAttribute(
          t.jsxIdentifier("chat"),
          t.jsxExpressionContainer(t.identifier(inferredSession)),
        ),
      );
      changed = true;
    }
  }

  if (hasAttribute(opening, "chat")) {
    opening.attributes = opening.attributes.filter((attribute) => {
      if (!t.isJSXAttribute(attribute)) return true;
      const name = attributeName(attribute);
      if (!name || !FLAT_CHAT_PROPS.has(name)) return true;
      const memberNames = FLAT_CHAT_MEMBER_NAMES.get(name) ?? name;
      if (!session || memberBaseForAttribute(attribute, memberNames) !== session) return true;
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
): boolean {
  let changed = false;
  const manual: t.JSXAttribute[] = [];
  for (const attribute of element.openingElement.attributes) {
    if (!t.isJSXAttribute(attribute)) continue;
    const name = attributeName(attribute);
    if (name === "renderPill" && canonicalElement === "Sources") {
      const expression = expressionValue(attribute);
      if (expression) {
        attribute.name = t.jsxIdentifier("renderItem");
        attribute.value = t.jsxExpressionContainer(renderItemAdapter(expression, true));
        changed = true;
      } else {
        manual.push(attribute);
      }
    } else if (name === "renderRow" && canonicalElement === "MessageTokens") {
      const expression = expressionValue(attribute);
      if (expression) {
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
  const localToCanonical = new Map<string, string>();
  const useChatNames = new Set<string>();
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
        useChatNames.add(specifier.local.name);
      }
      if (!hasChatComponents) continue;
      const replacement = IMPORT_RENAMES.get(imported);
      if (replacement) {
        specifier.imported = t.identifier(replacement);
        changed = true;
      }
      localToCanonical.set(specifier.local.name, replacement ?? imported);
    }
  }

  const chatResultNames = new Set<string>();
  walkAst(ast.program as unknown as t.Node, (node) => {
    if (!t.isVariableDeclarator(node) || !t.isCallExpression(node.init)) return;
    if (!t.isIdentifier(node.init.callee) || !useChatNames.has(node.init.callee.name)) return;
    if (t.isIdentifier(node.id)) {
      chatResultNames.add(node.id.name);
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
  });

  walkAst(ast.program as unknown as t.Node, (node) => {
    if (
      t.isMemberExpression(node) &&
      !node.computed &&
      t.isIdentifier(node.object) &&
      chatResultNames.has(node.object.name) &&
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
      localToCanonical.get(node.object.name) === "Chat" &&
      node.property.name === "Composer"
    ) {
      node.property.name = "Input";
      changed = true;
      return;
    }
    if (!t.isJSXElement(node)) return;
    const fullName = jsxName(node.openingElement.name);
    const localName = fullName.split(".")[0];
    const canonicalBase = localToCanonical.get(localName);
    if (!canonicalBase) return;
    const canonical = canonicalElementName(fullName, canonicalBase);
    if (canonical === "Chat" && !fullName.includes(".")) {
      changed = rewriteFlatChatSession(node, warnings, chatResultNames) || changed;
    }
    changed = rewriteToggles(node, canonical, warnings) || changed;
    changed = rewriteRemovedSlots(node, warnings) || changed;
    changed = rewriteLegacyRenderProps(node, canonical, warnings) || changed;
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
