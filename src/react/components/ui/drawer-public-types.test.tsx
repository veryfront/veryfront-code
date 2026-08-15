import * as React from "react";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DrawerContent, type DrawerContentProps } from "./index.ts";

function DrawerContentWithPublicProps(): React.ReactElement {
  const ref = React.createRef<HTMLDivElement>();
  const props: DrawerContentProps = {
    ref,
    className: "vf-test-drawer",
    children: "Drawer body",
  };
  return <DrawerContent {...props} />;
}

describe("Drawer public content types", () => {
  it("keeps a runtime assertion so the type fixture stays in test discovery", () => {
    assert(typeof DrawerContentWithPublicProps === "function");
  });
});
