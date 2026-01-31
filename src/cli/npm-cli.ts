import { join } from "#veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { cwd, exit, getArgs } from "#veryfront/platform/compat/process.ts";
import { getVeryfrontVersion } from "#veryfront/config/env.ts";
import { DEFAULT_REACT_VERSION, getReactUrls } from "#veryfront/transforms/esm/package-registry.ts";

const VERSION = getVeryfrontVersion() ?? "0.0.0-dev";

function parseArgs(args: string[]): {
  command: string | undefined;
  flags: Record<string, boolean | string>;
  positional: string[];
} {
  const flags: Record<string, boolean | string> = {};
  const positional: string[] = [];
  let command: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    const isLongFlag = arg.startsWith("--");
    const isShortFlag = arg.startsWith("-") && arg.length === 2;

    if (isLongFlag || isShortFlag) {
      const key = arg.slice(isLongFlag ? 2 : 1);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith("-")) {
        flags[key] = nextArg;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }

    if (!command) {
      command = arg;
      continue;
    }

    positional.push(arg);
  }

  return { command, flags, positional };
}

function showHelp(): void {
  console.log(`Veryfront CLI v${VERSION}`);
  console.log(`
Available commands:
  init          Create a new Veryfront project
  dev           Start the development server
  build         Build for production
  preview       Preview the production build
  doctor        Run diagnostic checks
  clean         Clean build and cache directories
  routes        List application routes
  generate      Generate new pages/components

Use 'veryfront <command> --help' for command-specific help.`);
}

async function initCommand(name: string, template: string = "minimal"): Promise<void> {
  const fs = createFileSystem();
  const projectDir = join(cwd(), name);

  console.log(`\nCreating new Veryfront project: ${name}`);
  console.log(`Template: ${template}\n`);

  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(join(projectDir, "pages"), { recursive: true });
  await fs.mkdir(join(projectDir, "public"), { recursive: true });

  const denoJson = {
    name,
    version: "0.1.0",
    tasks: {
      dev: `deno run -A npm:veryfront@^${VERSION} dev`,
      build: `deno run -A npm:veryfront@^${VERSION} build`,
      preview: `deno run -A npm:veryfront@^${VERSION} preview`,
    },
    imports: {
      veryfront: `npm:veryfront@^${VERSION}`,
      "veryfront/": `npm:veryfront@^${VERSION}/`,
      ...getReactUrls(DEFAULT_REACT_VERSION),
    },
    compilerOptions: {
      jsx: "react-jsx",
      jsxImportSource: "react",
    },
  };

  await fs.writeTextFile(join(projectDir, "deno.json"), JSON.stringify(denoJson, null, 2));

  const config = `import { defineConfig } from "veryfront/config";

export default defineConfig({
  // Add your configuration here
});
`;
  await fs.writeTextFile(join(projectDir, "veryfront.config.ts"), config);

  const indexPage = `export default function Home() {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Welcome to Veryfront!</h1>
      <p>Edit <code>pages/index.tsx</code> to get started.</p>
    </div>
  );
}
`;
  await fs.writeTextFile(join(projectDir, "pages", "index.tsx"), indexPage);

  const packageJson = {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "npx veryfront dev",
      build: "npx veryfront build",
      preview: "npx veryfront preview",
    },
    dependencies: {
      veryfront: `^${VERSION}`,
      react: "^18.3.1",
      "react-dom": "^18.3.1",
    },
  };

  await fs.writeTextFile(join(projectDir, "package.json"), JSON.stringify(packageJson, null, 2));

  console.log("Project created successfully!\n");
  console.log("Next steps:");
  console.log(`  cd ${name}`);
  console.log("  npm install  # or: deno cache deno.json");
  console.log("  npm run dev  # or: deno task dev\n");
}

function showRuntimeCommandHelp(command: string, args: string[]): void {
  const joinedArgs = args.join(" ");
  console.log(`
The '${command}' command requires the Veryfront development server.

For Deno (recommended):
  deno run -A npm:veryfront@^${VERSION} ${joinedArgs}

For Node.js, install dependencies first:
  npm install
  npx veryfront@^${VERSION} ${joinedArgs}

Note: dev/build/preview commands work best with Deno runtime.
`);
}

async function main(): Promise<void> {
  const args = getArgs();
  const { command, flags, positional } = parseArgs(args);

  if (flags.version || flags.v) {
    console.log(`Veryfront CLI v${VERSION}`);
    exit(0);
  }

  if (flags.help || flags.h || !command) {
    showHelp();
    exit(0);
  }

  if (command === "init") {
    const name = positional[0];
    if (!name) {
      console.error("Error: Project name required");
      console.log("Usage: veryfront init <project-name> [-t <template>]");
      exit(1);
    }

    const templateFlag = flags.t ?? flags.template;
    const template = typeof templateFlag === "string" ? templateFlag : "minimal";
    await initCommand(name, template);
    return;
  }

  const runtimeCommands = new Set([
    "dev",
    "build",
    "preview",
    "doctor",
    "clean",
    "routes",
    "generate",
    "g",
  ]);

  if (runtimeCommands.has(command)) {
    showRuntimeCommandHelp(command, args);
    exit(0);
  }

  console.error(`Unknown command: ${command}\n`);
  showHelp();
  exit(1);
}

main().catch((error) => {
  console.error("CLI Error:", error);
  exit(1);
});
