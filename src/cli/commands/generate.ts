import { join } from "#std/path.ts";
import { getConfig } from "#veryfront/config";
import { cliLogger } from "#veryfront/utils";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import {
  createFileSystem,
  type FileSystem,
  isAlreadyExistsError,
} from "#veryfront/platform/compat/fs.ts";
import { generateIntegration } from "./generate/integration-generator.ts";

let fs: FileSystem;

async function ensureDir(path: string) {
  if (!fs) fs = createFileSystem();
  try {
    await fs.mkdir(path, { recursive: true });
  } catch (error) {
    // Directory might already exist, which is fine
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  }
}

function toSlug(name: string) {
  return name
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_\-[\]/]/g, "")
    .replace(/\/+/g, "/");
}

export async function generateCommand(projectDir: string, type: string, name: string) {
  fs = createFileSystem();
  let preferred: "pages-router" | "app-router" = "pages-router";
  try {
    const { getAdapter } = await import("#veryfront/platform/adapters/detect.ts");

    const adapter = await getAdapter();
    const cfg = await getConfig(projectDir, adapter);
    const pref = cfg?.generate?.preferredRouter || cfg?.router;
    if (pref === "app-router" || pref === "pages-router") preferred = pref;
  } catch {
    cliLogger.debug("Could not load config for generate command, using defaults");
  }
  const slug = toSlug(name);
  switch (type) {
    case "rsc": {
      const dir = join(projectDir, "app", slug || "");
      await ensureDir(dir);
      const file = join(dir, "page.tsx");
      const title = slug.split("/").pop() || "RSC";
      const content = `export default function ${toComponentName(title)}(){
  return (
    <div>
      <h1>${title}</h1>
      <p>Open the experimental RSC shell for this route:</p>
      <a href="/_veryfront/rsc/page?name=${toComponentName(title)}">RSC Shell</a>
    </div>
  );
}
`;
      await fs.writeTextFile(file, content);
      cliLogger.info(`Created ${file}`);
      break;
    }
    case "page": {
      const isApp = preferred === "app-router";
      if (isApp) {
        const pageDir = join(projectDir, "app", slug || "");
        await ensureDir(pageDir);
        const file = join(pageDir, "page.tsx");
        const title = slug.split("/").pop() || "Page";
        const content = `export default function ${
          toComponentName(
            title,
          )
        }(){ return <div>${title}</div>; }\n`;
        await fs.writeTextFile(file, content);
        cliLogger.info(`Created ${file}`);
        break;
      }
      const subdir = slug.includes("/") ? slug.split("/").slice(0, -1).join("/") : "";
      const base = join(projectDir, "pages");
      await ensureDir(base + (subdir ? `/${subdir}` : ""));
      const fname = `${slug.split("/").pop() || "index"}.mdx`;
      const file = join(base, subdir ? `${subdir}/${fname}` : fname);
      const title = slug.split("/").pop() || "Page";
      const content = `---\ntitle: ${title}\n---\n\n# ${title}\n\nThis is a new page.\n`;
      await fs.writeTextFile(file, content);
      cliLogger.info(`Created ${file}`);
      break;
    }
    case "layout": {
      if (preferred === "app-router") {
        const dir = join(projectDir, "app", slug || "");
        await ensureDir(dir);
        const file = join(dir, `layout.tsx`);
        const content =
          `export default function Layout({ children }: { children: React.ReactNode }){ return (<section>${
            slug || "root"
          }{children}</section>); }\n`;
        await fs.writeTextFile(file, content);
        cliLogger.info(`Created ${file}`);
      } else {
        const dir = join(projectDir, "layouts");
        await ensureDir(dir);
        const file = join(dir, `${slug}.mdx`);
        const content = `---\nisLayout: true\n---\n\nexport default function ${
          toComponentName(
            slug,
          )
        }({ children }) {\n  return (<div className="${slug}-layout"><main>{children}</main></div>);\n}\n`;
        await fs.writeTextFile(file, content);
        cliLogger.info(`Created ${file}`);
      }
      break;
    }
    case "api": {
      const isApp = preferred === "app-router";
      if (isApp) {
        const routeDir = join(projectDir, "app", slug || "");
        await ensureDir(routeDir);
        const file = join(routeDir, "route.ts");
        const content = `export const GET = (_req: Request) => Response.json({ ok: true });\n`;
        await fs.writeTextFile(file, content);
        cliLogger.info(`Created ${file}`);
        break;
      }
      const subdir = slug.includes("/") ? slug.split("/").slice(0, -1).join("/") : "";
      const apiBase = join(projectDir, "pages", "api");
      await ensureDir(apiBase + (subdir ? `/${subdir}` : ""));
      const fname = `${slug.split("/").pop() || "index"}.ts`;
      const file = join(apiBase, subdir ? `${subdir}/${fname}` : fname);
      const content =
        `export function GET(_req: Request) {\n  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });\n}\n`;
      await fs.writeTextFile(file, content);
      cliLogger.info(`Created ${file}`);
      break;
    }
    case "integration": {
      // Integration generator handles its own name/prompts
      await generateIntegration(projectDir, { name: name || undefined });
      break;
    }
    default:
      throw toError(createError({
        type: "config",
        message: `Unknown generate type: ${type}`,
      }));
  }
}

function toComponentName(slug: string) {
  const base = slug.split("/").pop() || slug;
  return base
    .replace(/\W+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}
