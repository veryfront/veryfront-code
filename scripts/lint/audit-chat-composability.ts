/**
 * Chat composability doc-truth lint.
 *
 * Storybook chat stories document a component's anatomy as a `compositionTree`.
 * The systemic failure we keep hitting: a tree names `Component.SubPart` tokens
 * that were never exported — aspirational anatomy dressed up as a composable
 * API, which misleads developers into composing parts that don't exist.
 *
 * This lint makes the trees honest MECHANICALLY: every `Compound.SubPart` token
 * that appears in a `compositionTree` must resolve to a real sub-part hanging
 * off that compound's `Object.assign(...)` in the chat source. If a compound
 * doesn't have the part, the doc is lying — fail.
 *
 * (The runtime side of the contract — that each compound actually exposes its
 * parts and its hook throws outside a provider — lives in
 * `src/react/components/chat/chat/composability.contract.test.tsx`.)
 */

import { walk } from "#std/fs";

const CHAT_SRC_DIR = "src/react/components/chat";
const CHAT_STORIES_DIR = "storybook/stories/chat";

export interface CompositionLie {
  path: string;
  token: string;
}

/**
 * Collect `CompoundName -> {sub-part names}` from every
 * `const Name = Object.assign(base, { Part: ..., ... })` in the given sources.
 */
export function collectCompoundParts(
  files: Array<{ path: string; content: string }>,
): Map<string, Set<string>> {
  const compounds = new Map<string, Set<string>>();
  const declRe = /(?:export\s+)?const\s+(\w+)\s*=\s*Object\.assign\(/g;

  for (const f of files) {
    let m: RegExpExecArray | null;
    while ((m = declRe.exec(f.content)) !== null) {
      const name = m[1];
      // Find the second argument: the object literal after the first `{`.
      const objStart = f.content.indexOf("{", declRe.lastIndex);
      if (objStart === -1) continue;
      let depth = 0;
      let end = -1;
      for (let i = objStart; i < f.content.length; i++) {
        const c = f.content[i];
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end === -1) continue;
      const body = f.content.slice(objStart + 1, end);
      const keys = compounds.get(name) ?? new Set<string>();
      const keyRe = /(?:^|[,{\s])([A-Za-z_]\w*)\s*:/g;
      let km: RegExpExecArray | null;
      while ((km = keyRe.exec(body)) !== null) keys.add(km[1]);
      compounds.set(name, keys);
    }
  }
  return compounds;
}

/**
 * Find `Compound.SubPart` tokens inside story `compositionTree`s that do not
 * resolve to a real exported sub-part.
 */
export function findCompositionLies(
  storyFiles: Array<{ path: string; content: string }>,
  compounds: Map<string, Set<string>>,
): CompositionLie[] {
  const lies: CompositionLie[] = [];
  const treeRe = /compositionTree\s*=\s*(?:\n\s*)?`([\s\S]*?)`/g;
  const tokenRe = /\b([A-Z][A-Za-z0-9]*)\.([A-Z][A-Za-z0-9]*)\b/g;

  for (const f of storyFiles) {
    let tm: RegExpExecArray | null;
    while ((tm = treeRe.exec(f.content)) !== null) {
      const tree = tm[1];
      let tk: RegExpExecArray | null;
      while ((tk = tokenRe.exec(tree)) !== null) {
        const [token, base, sub] = tk;
        const parts = compounds.get(base);
        // Only judge tokens whose base is a known compound — a leaf/sealed
        // component referenced as `Name.Whatever` is not our concern here.
        if (!parts) continue;
        if (!parts.has(sub)) lies.push({ path: f.path, token });
      }
    }
  }
  return lies;
}

async function readDir(
  dir: string,
  exts: string[],
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  for await (const entry of walk(dir, { exts, skip: [/\bnode_modules\b/, /\bdist\b/] })) {
    if (!entry.isFile) continue;
    files.push({ path: entry.path, content: await Deno.readTextFile(entry.path) });
  }
  return files;
}

if (import.meta.main) {
  const srcFiles = await readDir(CHAT_SRC_DIR, [".ts", ".tsx"]);
  const storyFiles = await readDir(CHAT_STORIES_DIR, [".tsx"]);
  const compounds = collectCompoundParts(srcFiles);
  const lies = findCompositionLies(storyFiles, compounds);

  if (lies.length === 0) {
    console.log(
      `chat composability: ${compounds.size} compounds; all composition trees are honest.`,
    );
    Deno.exit(0);
  }

  console.error(`${lies.length} aspirational composition-tree token(s):`);
  for (const lie of lies) {
    console.error(`  ${lie.path}: "${lie.token}" is not a real exported sub-part`);
  }
  Deno.exit(1);
}
