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
        <div className="mb-8">
          {(typeof description === "string"
            ? description.split(/\n{2,}/)
            : [description]).map((para, i, arr) => (
              <p
                key={i}
                className={cn(
                  "text-base text-foreground",
                  i < arr.length - 1 && "mb-4",
                )}
              >
                {renderInlineCode(para)}
              </p>
            ))}
        </div>
      )}
      <div className={cn("docs-prose", description ? "" : "mt-6")}>
        {children}
      </div>
    </section>
  );
}
