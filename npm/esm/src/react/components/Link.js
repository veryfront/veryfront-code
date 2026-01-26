import React from "react";
export function Link({ prefetch = true, children, ...rest }) {
    return (React.createElement("a", { ...rest, ...(prefetch ? { "data-prefetch": "true" } : {}) }, children));
}
