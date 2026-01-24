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
  const delays = ["0ms", "150ms", "300ms"] as const;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {delays.map((animationDelay) => (
        <span
          key={animationDelay}
          className="animate-bounce rounded-full bg-muted-foreground"
          style={{ width: dotSize, height: dotSize, animationDelay }}
        />
      ))}
    </div>
  );
}
