import * as React from "react";
import { cn } from "../../theme.js";
export function Shimmer({ children }) {
    return (React.createElement("span", { className: "relative inline-block overflow-hidden" },
        React.createElement("span", { className: "animate-pulse" }, children)));
}
export function Loader({ className, size = 16, }) {
    const dotSize = size / 4;
    const delays = ["0ms", "150ms", "300ms"];
    return (React.createElement("div", { className: cn("flex items-center gap-1", className) }, delays.map((animationDelay) => (React.createElement("span", { key: animationDelay, className: "animate-bounce rounded-full bg-muted-foreground", style: { width: dotSize, height: dotSize, animationDelay } })))));
}
