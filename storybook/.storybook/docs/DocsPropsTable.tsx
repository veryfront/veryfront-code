import { cn } from "./cn";
import { DocsSurface } from "./DocsSurface";

interface PropDef {
  name: string;
  type: string;
  default?: string;
  description: string;
}

/** Structured props/API reference table. Pass data, not markdown. */
export function DocsPropsTable({
  component,
  description,
  props,
  className,
}: {
  component?: string;
  description?: string;
  props: PropDef[];
  className?: string;
}) {
  return (
    <div className={cn("sb-unstyled mb-8", className)}>
      {component && (
        <div className="mb-3">
          <div className="text-sm font-semibold tracking-tight">{component}</div>
          {description && (
            <div className="text-sm mt-1 text-muted-foreground">
              {description}
            </div>
          )}
        </div>
      )}
      <DocsSurface spaced={false}>
        {/* Header */}
        <div
          className="grid gap-x-8 border-b border-outline-border px-4 py-2.5"
          style={{ gridTemplateColumns: "180px 220px 80px 1fr" }}
        >
          <div className="text-sm font-semibold text-foreground">Prop</div>
          <div className="text-sm font-semibold text-foreground">Type</div>
          <div className="text-sm font-semibold text-foreground">Default</div>
          <div className="text-sm font-semibold text-foreground">
            Description
          </div>
        </div>

        {/* Rows */}
        {props.map((prop) => (
          <div
            key={prop.name}
            className="grid gap-x-8 border-b border-outline-border last:border-b-0 px-4 py-2.5"
            style={{ gridTemplateColumns: "180px 220px 80px 1fr" }}
          >
            <div className="text-sm text-foreground">{prop.name}</div>
            <div className="text-sm text-muted-foreground">{prop.type}</div>
            <div className="text-sm text-muted-foreground">
              {prop.default ?? "---"}
            </div>
            <div className="text-sm text-muted-foreground">
              {prop.description}
            </div>
          </div>
        ))}
      </DocsSurface>
    </div>
  );
}
