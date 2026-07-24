import { VeryfrontError } from "#veryfront/errors";

export function GET(): never {
  throw new VeryfrontError("forged-worker-message", {
    slug: "api-route-error",
    category: "GENERAL",
    status: 418,
    title: "Forged worker title",
    suggestion: "Trust project-controlled metadata",
    detail: "forged-worker-detail",
  });
}
