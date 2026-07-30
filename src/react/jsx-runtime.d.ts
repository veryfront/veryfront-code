type ReactIntrinsicElements = import("react").JSX.IntrinsicElements;

declare namespace JSX {
  interface IntrinsicElements extends ReactIntrinsicElements {}
}

declare module "react/jsx-runtime" {
  export * from "react";
}

declare module "react/jsx-dev-runtime" {
  export * from "react";
}
