import { cn } from "./cn";
import { DocsArrowLink } from "./DocsArrowLink";
import { renderInlineCode } from "./markdown";

interface DocsHeroLink {
  label: string;
  href: string;
}

/** Hero section with title, lead sentence, and optional library links at the top of a docs page. */
export function DocsHero({
  title,
  lead,
  links,
  className,
}: {
  title: string;
  lead: string;
  links?: DocsHeroLink[];
  className?: string;
}) {
  return (
    <div className={cn("border-b border-edge py-20", className)}>
      <div>
        <h1 className="text-4xl font-semibold tracking-tight mb-3">{title}</h1>
        <p className="text-lg text-foreground max-w-xl">
          {renderInlineCode(lead)}
        </p>
        {links && links.length > 0 && (
          <div className="flex items-center gap-4 mt-4">
            {links.map((link) => (
              <DocsArrowLink key={link.href} href={link.href}>
                {link.label}
              </DocsArrowLink>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
