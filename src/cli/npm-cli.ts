import { join } from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { getEnv } from "../../platform/compat/process.ts";

const VERSION = getEnv("VERYFRONT_VERSION") || "0.0.0-dev";

/**
 * Get command line arguments cross-platform
 */
function getArgs(): string[] {
  if (typeof process !== "undefined" && Array.isArray(process.argv)) {
    return process.argv.slice(2);
  }
  if (typeof Deno !== "undefined") {
    return (Deno as { args: string }).args;
  }
  return [];
}

/**
 * Simple argument parser
 */
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

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        flags[key] = nextArg;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        flags[key] = nextArg;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, flags, positional };
}

/**
 * Show help information
 */
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

/**
 * Create directory if it doesn't exist
 */
async function ensureDir(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    await mkdir(path, { recursive: true });
  }
}

/**
 * Initialize a new Veryfront project
 */
async function initCommand(name: string, template: string = "minimal"): Promise<void> {
  const projectDir = join(process.cwd(), name);

  console.log(`\nCreating new Veryfront project: ${name}`);
  console.log(`Template: ${template}\n`);

  // Create project structure
  await ensureDir(projectDir);
  await ensureDir(join(projectDir, "pages"));
  await ensureDir(join(projectDir, "public"));

  // Create deno.json
  const denoJson = {
    name: name,
    version: "0.1.0",
    tasks: {
      dev: `deno run -A npm:veryfront@^${VERSION} dev`,
      build: `deno run -A npm:veryfront@^${VERSION} build`,
      preview: `deno run -A npm:veryfront@^${VERSION} preview`,
    },
    imports: {
      "veryfront": `npm:veryfront@^${VERSION}`,
      "veryfront/": `npm:veryfront@^${VERSION}/`,
      "react": "https://esm.sh/react@18.3.1",
      "react-dom": "https://esm.sh/react-dom@18.3.1",
      "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
    },
    compilerOptions: {
      jsx: "react-jsx",
      jsxImportSource: "react",
    },
  };
  await writeFile(
    join(projectDir, "deno.json"),
    JSON.stringify(denoJson, null, 2),
  );

  // Create veryfront.config.ts
  const config = `import { defineConfig } from "veryfront/config";

export default defineConfig({
  // Add your configuration here
});
`;
  await writeFile(join(projectDir, "veryfront.config.ts"), config);

  // Create index page
  const indexPage = `export default function Home() {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Welcome to Veryfront!</h1>
      <p>Edit <code>pages/index.tsx</code> to get started.</p>
    </div>
  );
}
`;
  await writeFile(join(projectDir, "pages", "index.tsx"), indexPage);

  // Create package.json for Node.js/Bun compatibility
  const packageJson = {
    name: name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: `npx veryfront dev`,
      build: `npx veryfront build`,
      preview: `npx veryfront preview`,
    },
    dependencies: {
      veryfront: `^${VERSION}`,
      react: "^18.3.1",
      "react-dom": "^18.3.1",
    },
  };
  await writeFile(
    join(projectDir, "package.json"),
    JSON.stringify(packageJson, null, 2),
  );

  console.log("Project created successfully!\n");
  console.log("Next steps:");
  console.log(`  cd ${name}`);
  console.log("  npm install  # or: deno cache deno.json");
  console.log("  npm run dev  # or: deno task dev\n");
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  const args = getArgs();
  const { command, flags, positional } = parseArgs(args);

  // Handle version flag
  if (flags.version || flags.v) {
    console.log(`Veryfront CLI v${VERSION}`);
    process.exit(0);
  }

  // Handle help flag or no command
  if (flags.help || flags.h || !command) {
    showHelp();
    process.exit(0);
  }

  switch (command) {
    case "init": {
      const name = positional[0];
      if (!name) {
        console.error("Error: Project name required");
        console.log("Usage: veryfront init <project-name> [-t <template>]");
        process.exit(1);
      }
      const template = (flags.t || flags.template || "minimal") as string;
      await initCommand(name, template);
      break;
    }

    case "dev":
    case "build":
    case "preview":
    case "doctor":
    case "clean":
    case "routes":
    case "generate":
    case "g":
      // These commands require the full Veryfront runtime
      console.log(`
The '${command}' command requires the Veryfront development server.

For Deno (recommended):
  deno run -A npm:veryfront@^${VERSION} ${args.join(" ")}

For Node.js, install dependencies first:
  npm install
  npx veryfront@^${VERSION} ${args.join(" ")}

Note: dev/build/preview commands work best with Deno runtime.
`);
      process.exit(0);
      break;

    default:
      console.error(`Unknown command: ${command}\n`);
      showHelp();
      process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error("CLI Error:", error);
  process.exit(1);
});
