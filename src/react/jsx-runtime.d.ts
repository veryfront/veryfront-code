/// <reference types="@types/react" />

declare namespace JSX {
  interface IntrinsicElements extends React.JSX.IntrinsicElements {}
}

declare module "react/jsx-runtime" {
  export * from "react";
}

declare module "react/jsx-dev-runtime" {
  export * from "react";
}
