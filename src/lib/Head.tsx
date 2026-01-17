import React from "react";

// SSR-compatible Head component
// During SSR, this collects head elements; during hydration, react-helmet-async takes over
export const Head: React.FC<React.PropsWithChildren<Record<string, unknown>>> = ({
  children,
}) => {
  // For SSR, we just render null - the actual head management is done by the shell generator
  // The children will be processed separately if needed
  return <>{children}</>;
};

export default Head;
