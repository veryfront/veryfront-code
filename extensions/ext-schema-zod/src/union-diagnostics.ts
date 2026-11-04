import { z } from "zod";

type Parser = z.ZodUnion["_zod"]["parse"];
type Payload = Parameters<Parser>[0];
type Context = Parameters<Parser>[1];

const patched = new WeakSet<z.ZodType>();

function isCollectionSizeRefusal(issue: z.core.$ZodRawIssue): boolean {
  return issue.code === "too_big" &&
    (issue.origin === "array" || issue.origin === "set" || issue.origin === "map");
}

function selectUnionResult(
  results: Payload[],
  final: Payload,
  union: z.ZodUnion,
  context: Context,
): Payload {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  let matched = results.filter((result) => !z.core.util.aborted(result));
  if (matched.length === 0) {
    // Only eager collection caps need the fallback. A failed custom type
    // predicate must retain its enclosing union's original error boundary.
    matched = results.filter((result) =>
      !result.aborted &&
      result.issues.every((issue) =>
        issue.continue === true || issue.continue === false && isCollectionSizeRefusal(issue)
      ) && result.issues.some(isCollectionSizeRefusal)
    );
  }
  if (matched.length === 1) {
    final.value = matched[0]!.value;
    return matched[0]!;
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst: union,
    errors: results.map((result) =>
      result.issues.map((issue) => z.core.util.finalizeIssue(issue, context, z.core.config()))
    ),
  });
  return final;
}

/** Adapt upstream #6662 for eager collection bounds without changing custom type errors. */
export function preserveUnionCheckDiagnostics(schema: z.ZodType): void {
  const def = schema._zod.def;
  if (
    def.type !== "union" || "discriminator" in def || "exclusive" in def || patched.has(schema)
  ) return;
  const union = schema as z.ZodUnion;
  const options = union._zod.def.options;
  const previous = union._zod.parse;
  const directRun = union._zod.run === previous;
  const parse: Parser = (payload, context) => {
    if (options.length === 1) return options[0]!._zod.run(payload, context);
    const results: ReturnType<Parser>[] = [];
    let asynchronous = false;
    for (const option of options) {
      const result = option._zod.run({ value: payload.value, issues: [] }, context);
      if (result instanceof Promise) asynchronous = true;
      else if (result.issues.length === 0) return result;
      results.push(result);
    }
    return asynchronous
      ? Promise.all(results).then((resolved) =>
        selectUnionResult(resolved, payload, union, context)
      )
      : selectUnionResult(results as Payload[], payload, union, context);
  };
  union._zod.parse = parse;
  if (directRun) union._zod.run = parse;
  patched.add(schema);
}
