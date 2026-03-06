import * as React from "react";
import { cn } from "../../theme.ts";

export function Shimmer({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="relative inline-block overflow-hidden">
      <span className="animate-pulse">{children}</span>
    </span>
  );
}

export function Loader({
  className,
  size = 16,
}: {
  className?: string;
  size?: number;
}): React.ReactElement {
  const dotSize = size / 4;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {["0ms", "150ms", "300ms"].map((animationDelay) => (
        <span
          key={animationDelay}
          className="animate-bounce rounded-full bg-[var(--muted-foreground)]"
          style={{ width: dotSize, height: dotSize, animationDelay }}
        />
      ))}
    </div>
  );
}

export function FadeIn({
  children,
  duration = 300,
  className,
}: {
  children: React.ReactNode;
  duration?: number;
  className?: string;
}): React.ReactElement {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={className}
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(8px)",
        transition: `opacity ${duration}ms ease-out, transform ${duration}ms ease-out`,
      }}
    >
      {children}
    </div>
  );
}
