import { API_ERROR } from "#veryfront/errors";

export function GET(): never {
  throw API_ERROR.create({
    detail: "Sensitive worker failure at /private/project/route.ts",
  });
}
