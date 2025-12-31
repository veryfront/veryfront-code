/// <reference types="@types/react" />

// Extend JSX namespace to fix Deno type checking issues with React
declare namespace JSX {
  interface IntrinsicElements extends React.JSX.IntrinsicElements {}
}

// Re-export JSX runtime types
declare module "react/jsx-runtime" {
  export * from "react";
}

declare module "react/jsx-dev-runtime" {
  export * from "react";
}
