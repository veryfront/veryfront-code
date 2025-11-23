import React from "react";

export function Head({ children }: { children: React.ReactNode }) {
  return React.createElement(
    "div",
    {
      "data-veryfront-head": "1",
      style: { display: "none" },
    },
    children,
  );
}
