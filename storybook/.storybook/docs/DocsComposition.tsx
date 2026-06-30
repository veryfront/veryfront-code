import { cn } from "./cn";
import { DocsSurface } from "./DocsSurface";

interface CompositionNode {
  id: string;
  label: string;
  children: CompositionNode[];
}

function getDepth(line: string) {
  const connectorIndex = line.indexOf("+--");

  if (connectorIndex === -1) {
    return { depth: 0, label: line.trim() };
  }

  const prefix = line.slice(0, connectorIndex);
  return {
    depth: Math.max(1, Math.floor(prefix.length / 4) + 1),
    label: line.slice(connectorIndex + 3).trim(),
  };
}

function parseComposition(value: string): CompositionNode[] {
  const roots: CompositionNode[] = [];
  const stack: CompositionNode[] = [];

  value
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .forEach((line, index) => {
      const parsed = getDepth(line);
      const node: CompositionNode = {
        id: `${index}-${parsed.label}`,
        label: parsed.label,
        children: [],
      };

      if (parsed.depth === 0 || stack.length === 0) {
        roots.push(node);
        stack[0] = node;
        stack.length = 1;
        return;
      }

      const parent = stack[parsed.depth - 1] ?? stack[stack.length - 1];
      parent.children.push(node);
      stack[parsed.depth] = node;
      stack.length = parsed.depth + 1;
    });

  return roots;
}

function splitLabel(label: string) {
  const arrowMatch = label.match(/^(.*?)\s*<-\s*(.*)$/);
  if (arrowMatch) {
    return { title: arrowMatch[1].trim(), detail: arrowMatch[2].trim() };
  }

  const parenMatch = label.match(/^(.*?)\s+\((.*)\)$/);
  if (parenMatch) {
    return { title: parenMatch[1], detail: parenMatch[2] };
  }

  return { title: label, detail: null };
}

/*
 * Role inference is symbol-driven — match against the identifier (e.g. `ChatRoot`),
 * never the freeform description. Otherwise primitives that describe themselves as a "Root
 * container with variant styling" get tagged as stateful Containers.
 */
function getRole(label: string) {
  const symbol = splitLabel(label).title.toLowerCase();

  if (/container$|provider$|store$/.test(symbol) || symbol.endsWith("hook")) {
    return "state";
  }

  if (symbol.includes("responsiveswitch")) {
    return "responsive";
  }

  if (symbol.includes("desktop")) {
    return "desktop";
  }

  if (symbol.includes("mobile")) {
    return "mobile";
  }

  if (
    symbol.includes("drawer") ||
    symbol.includes("dialog") ||
    symbol.includes("overlay") ||
    symbol.includes("confirm")
  ) {
    return "overlay";
  }

  if (symbol.includes("form") || symbol.includes("field")) {
    return "form";
  }

  if (
    symbol.includes("list") || symbol.includes("table") ||
    symbol.includes("row") || symbol.includes("tree")
  ) {
    return "list";
  }

  if (
    symbol.includes("panel") || symbol.includes("layout") ||
    symbol.includes("split")
  ) {
    return "layout";
  }

  return "component";
}

function CompositionRole({ role }: { role: string }) {
  return (
    <span className="rounded border border-edge bg-surface-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-normal text-foreground">
      {role}
    </span>
  );
}

function CompositionNodeView(
  { node, isRoot = false }: { node: CompositionNode; isRoot?: boolean },
) {
  const label = splitLabel(node.label);
  const role = getRole(node.label);

  return (
    <div className={cn(!isRoot && "border-l border-edge pl-3")}>
      <div className="rounded border border-edge bg-background px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[12px] text-foreground">
            {label.title}
          </span>
          <CompositionRole role={role} />
        </div>
        {label.detail
          ? (
            <div className="mt-1 text-[12px] text-foreground">
              {label.detail}
            </div>
          )
          : null}
      </div>

      {node.children.length > 0
        ? (
          <div className="mt-2 space-y-2">
            {node.children.map((child) => (
              <CompositionNodeView key={child.id} node={child} />
            ))}
          </div>
        )
        : null}
    </div>
  );
}

/** Low-fidelity component map showing panel composition without implementation-only Storybook framing. */
export function DocsComposition(
  { children, className }: { children: string; className?: string },
) {
  const roots = parseComposition(typeof children === "string" ? children : "");

  return (
    <DocsSurface className={cn("p-3", className)}>
      <div className="space-y-3">
        {roots.map((node) => (
          <CompositionNodeView key={node.id} node={node} isRoot />
        ))}
      </div>
    </DocsSurface>
  );
}
