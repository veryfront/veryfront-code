import { join } from "#veryfront/compat/path";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

type RendererTestContext = {
  projectDir: string;
  projectId: string;
};

export async function withRendererTestContext(
  name: string,
  fn: (context: RendererTestContext) => Promise<void>,
): Promise<void> {
  await withTestContext(name, fn);
}

export function stripReactSSRMarkers(html: string): string {
  return html.replaceAll("<!-- -->", "");
}

export function createRendererForTest(
  context: RendererTestContext,
  mode: "development" | "production" = "development",
) {
  return createRenderer({
    projectDir: context.projectDir,
    projectId: context.projectId,
    mode,
  });
}

export function removeAppDir(context: RendererTestContext): Promise<void> {
  return remove(join(context.projectDir, "app"), { recursive: true });
}

export function writePageFile(
  context: RendererTestContext,
  relativePath: string,
  content: string,
): Promise<void> {
  return writeTextFile(join(context.projectDir, relativePath), content);
}

export function ensureDirForTest(
  context: RendererTestContext,
  relativePath: string,
): Promise<void> {
  return mkdir(join(context.projectDir, relativePath), { recursive: true });
}
