/**
 * Animation Components
 * @module ai/react/components/chat/components/animations
 */

import * as React from "react";
import { cn } from "../../theme.ts";

/**
 * Shimmer animation for loading states (AI Elements style)
 */
export function Shimmer({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-block overflow-hidden">
      <span className="animate-pulse">{children}</span>
    </span>
  );
}

/**
 * Loader component - animated loading dots
 */
export function Loader({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span
        className="animate-bounce rounded-full bg-muted-foreground"
        style={{ width: size / 4, height: size / 4, animationDelay: "0ms" }}
      />
      <span
        className="animate-bounce rounded-full bg-muted-foreground"
        style={{ width: size / 4, height: size / 4, animationDelay: "150ms" }}
      />
      <span
        className="animate-bounce rounded-full bg-muted-foreground"
        style={{ width: size / 4, height: size / 4, animationDelay: "300ms" }}
      />
    </div>
  );
}
