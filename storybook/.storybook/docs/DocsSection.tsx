import type * as React from "react";
import { cn } from "./cn";
import { renderInlineCode } from "./markdown";

/** Content section with a heading, optional description, and top divider. */
export function DocsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("border-b border-edge py-12 last:border-b-0", className)}
    >
      <h2 className="text-xl font-semibold tracking-tight mb-2">{title}</h2>
      {description && (
        <p className="text-base text-foreground mb-8">
          {renderInlineCode(description)}
        </p>
      )}
      <div className={cn("docs-prose", description ? "" : "mt-6")}>
        {children}
      </div>
    </section>
  );
}
