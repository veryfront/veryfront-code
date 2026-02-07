import { join } from "#std/path.ts";
import { getConfig } from "veryfront/config";
import { cliLogger } from "#cli/utils";
import { createError, toError } from "veryfront/errors";
import { createFileSystem } from "veryfront/platform";
import { generateIntegration } from "./integration-generator.ts";
import { ensureDir } from "../../utils/fs.ts";
import { toComponentName, toSlug } from "../../utils/string.ts";

async function getPreferredRouter(
  projectDir: string,
): Promise<"pages-router" | "app-router"> {
  try {
    const { runtime } = await import("veryfront/platform");
    const adapter = await runtime.get();
    const cfg = await getConfig(projectDir, adapter);
    const pref = cfg?.generate?.preferredRouter ?? cfg?.router;
    if (pref === "app-router" || pref === "pages-router") return pref;
  } catch {
    cliLogger.debug("Could not load config for generate command, using defaults");
  }
  return "pages-router";
}

export async function generateCommand(
  projectDir: string,
  type: string,
  name: string,
): Promise<void> {
  const fs = createFileSystem();

  const preferred = await getPreferredRouter(projectDir);
  const slug = toSlug(name);

  if (type === "integration") {
    await generateIntegration(projectDir, { name: name || undefined });
    return;
  }

  switch (type) {
    case "rsc": {
      const dir = join(projectDir, "app", slug || "");
      await ensureDir(dir);

      const file = join(dir, "page.tsx");
      const title = slug.split("/").pop() || "RSC";
      const componentName = toComponentName(title);
      const content = `export default function ${componentName}(){
  return (
    <div>
      <h1>${title}</h1>
      <p>Open the experimental RSC shell for this route:</p>
      <a href="/_veryfront/rsc/page?name=${componentName}">RSC Shell</a>
    </div>
  );
}
`;
      await fs.writeTextFile(file, content);
      cliLogger.info(`Created ${file}`);
      return;
    }

    case "page": {
      if (preferred === "app-router") {
        const pageDir = join(projectDir, "app", slug || "");
        await ensureDir(pageDir);

        const file = join(pageDir, "page.tsx");
        const title = slug.split("/").pop() || "Page";
        const componentName = toComponentName(title);
        const content =
          `export default function ${componentName}(){ return <div>${title}</div>; }\n`;
        await fs.writeTextFile(file, content);
        cliLogger.info(`Created ${file}`);
        return;
      }

      const parts = slug.split("/");
      const subdir = slug.includes("/") ? parts.slice(0, -1).join("/") : "";
      const base = join(projectDir, "pages");
      const targetDir = subdir ? join(base, subdir) : base;
      await ensureDir(targetDir);

      const fname = `${parts.pop() || "index"}.mdx`;
      const file = join(targetDir, fname);
      const title = slug.split("/").pop() || "Page";
      const content = `---\ntitle: ${title}\n---\n\n# ${title}\n\nThis is a new page.\n`;
      await fs.writeTextFile(file, content);
      cliLogger.info(`Created ${file}`);
      return;
    }

    case "layout": {
      if (preferred === "app-router") {
        const dir = join(projectDir, "app", slug || "");
        await ensureDir(dir);

        const file = join(dir, "layout.tsx");
        const content =
          `export default function Layout({ children }: { children: React.ReactNode }){ return (<section>${
            slug || "root"
          }{children}</section>); }\n`;
        await fs.writeTextFile(file, content);
        cliLogger.info(`Created ${file}`);
        return;
      }

      const dir = join(projectDir, "layouts");
      await ensureDir(dir);

      const file = join(dir, `${slug}.mdx`);
      const componentName = toComponentName(slug);
      const content =
        `---\nisLayout: true\n---\n\nexport default function ${componentName}({ children }) {\n  return (<div className="${slug}-layout"><main>{children}</main></div>);\n}\n`;
      await fs.writeTextFile(file, content);
      cliLogger.info(`Created ${file}`);
      return;
    }

    case "api": {
      if (preferred === "app-router") {
        const routeDir = join(projectDir, "app", slug || "");
        await ensureDir(routeDir);

        const file = join(routeDir, "route.ts");
        const content = `export const GET = (_req: Request) => Response.json({ ok: true });\n`;
        await fs.writeTextFile(file, content);
        cliLogger.info(`Created ${file}`);
        return;
      }

      const parts = slug.split("/");
      const subdir = slug.includes("/") ? parts.slice(0, -1).join("/") : "";
      const apiBase = join(projectDir, "pages", "api");
      const targetDir = subdir ? join(apiBase, subdir) : apiBase;
      await ensureDir(targetDir);

      const fname = `${parts.pop() || "index"}.ts`;
      const file = join(targetDir, fname);
      const content =
        `export function GET(_req: Request) {\n  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });\n}\n`;
      await fs.writeTextFile(file, content);
      cliLogger.info(`Created ${file}`);
      return;
    }

    default:
      throw toError(
        createError({
          type: "config",
          message: `Unknown generate type: ${type}`,
        }),
      );
  }
}
