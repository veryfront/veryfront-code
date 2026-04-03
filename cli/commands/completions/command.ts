/**
 * Shell completion generators
 *
 * Generates completion scripts from the COMMANDS registry.
 *
 * @module cli/commands/completions
 */

import { COMMANDS } from "../../help/command-definitions.ts";
import type { CommandOption } from "../../help/types.ts";

/** Escape a string for use in shell single-quoted contexts */
export function shellEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Extract long flags (--name) from a CommandOption flag string.
 * Handles formats like: "--port", "-p, --port", "-p, --port <number>"
 */
export function extractLongFlags(options: CommandOption[]): string[] {
  return options.flatMap((o) =>
    o.flag
      .split(",")
      .map((f) => f.trim().split(" ")[0]!)
      .filter((f) => f.startsWith("--"))
  );
}

/**
 * Extract short and long flags for fish completions.
 * Returns { short: "p", long: "port" } pairs.
 */
export function extractFishFlags(
  options: CommandOption[],
): Array<{ short?: string; long?: string; description: string }> {
  return options.map((o) => {
    const parts = o.flag.split(",").map((f) => f.trim().split(" ")[0]!);
    const short = parts.find((p) => p.match(/^-[a-zA-Z]$/))?.slice(1);
    const long = parts.find((p) => p.startsWith("--"))?.slice(2);
    return { short, long, description: o.description };
  });
}

const GLOBAL_FLAGS = [
  "--json",
  "--yes",
  "--quiet",
  "--verbose",
  "--help",
  "--version",
  "--no-color",
  "--output",
];

export function generateBashCompletions(): string {
  const commands = Object.values(COMMANDS);
  const cmdNames = commands.map((c) => c.name).join(" ");

  let script = `# Veryfront CLI bash completions\n_veryfront_completions() {\n`;
  script += `  local cur prev commands\n`;
  script += `  cur="\${COMP_WORDS[COMP_CWORD]}"\n`;
  script += `  prev="\${COMP_WORDS[COMP_CWORD-1]}"\n`;
  script += `  commands="${cmdNames}"\n\n`;
  script += `  if [[ \${COMP_CWORD} -eq 1 ]]; then\n`;
  script += `    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )\n`;
  script += `    return\n`;
  script += `  fi\n\n`;
  script += `  case "\${COMP_WORDS[1]}" in\n`;

  for (const cmd of commands) {
    const flags = extractLongFlags(cmd.options ?? [])
      .concat(GLOBAL_FLAGS)
      .join(" ");
    script += `    ${cmd.name}) COMPREPLY=( $(compgen -W "${flags}" -- "\${cur}") ) ;;\n`;
  }

  script += `    *) COMPREPLY=( $(compgen -W "${GLOBAL_FLAGS.join(" ")}" -- "\${cur}") ) ;;\n`;
  script += `  esac\n`;
  script += `}\n`;
  script += `complete -F _veryfront_completions veryfront\n`;
  return script;
}

export function generateZshCompletions(): string {
  const commands = Object.values(COMMANDS);
  let script = `#compdef veryfront\n# Veryfront CLI zsh completions\n\n`;
  script += `_veryfront() {\n`;
  script += `  local -a commands\n`;
  script += `  commands=(\n`;

  for (const cmd of commands) {
    const desc = shellEscape(cmd.description);
    script += `    '${cmd.name}:${desc}'\n`;
  }

  script += `  )\n\n`;
  script += `  _arguments -C \\\n`;
  script += `    '1:command:->command' \\\n`;
  script += `    '*::arg:->args'\n\n`;
  script += `  case $state in\n`;
  script += `    command)\n`;
  script += `      _describe 'command' commands\n`;
  script += `      ;;\n`;
  script += `    args)\n`;
  script += `      case \${words[1]} in\n`;

  for (const cmd of commands) {
    const flags = extractLongFlags(cmd.options ?? []).concat(GLOBAL_FLAGS);
    if (flags.length > 0) {
      const zshFlags = flags.map((f) =>
        `'${f}[${
          shellEscape(
            (cmd.options ?? []).find((o) => o.flag.includes(f))?.description ??
              "",
          )
        }]'`
      ).join(" ");
      script += `        ${cmd.name}) _arguments ${zshFlags} ;;\n`;
    }
  }

  script += `      esac\n`;
  script += `      ;;\n`;
  script += `  esac\n`;
  script += `}\n\n`;
  script += `_veryfront\n`;
  return script;
}

export function generateFishCompletions(): string {
  const commands = Object.values(COMMANDS);
  let script = `# Veryfront CLI fish completions\n`;

  for (const cmd of commands) {
    const desc = shellEscape(cmd.description);
    script += `complete -c veryfront -n '__fish_use_subcommand' -a '${cmd.name}' -d '${desc}'\n`;
  }

  script += `\n`;

  for (const cmd of commands) {
    const flags = extractFishFlags(cmd.options ?? []);
    for (const flag of flags) {
      if (flag.long) {
        const desc = shellEscape(flag.description);
        let line =
          `complete -c veryfront -n '__fish_seen_subcommand_from ${cmd.name}' -l '${flag.long}'`;
        if (flag.short) {
          line += ` -s '${flag.short}'`;
        }
        line += ` -d '${desc}'\n`;
        script += line;
      } else if (flag.short) {
        const desc = shellEscape(flag.description);
        script +=
          `complete -c veryfront -n '__fish_seen_subcommand_from ${cmd.name}' -s '${flag.short}' -d '${desc}'\n`;
      }
    }
  }

  return script;
}
