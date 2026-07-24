import { API_ROUTE_ERROR } from "#veryfront/errors";

export function GET(): never {
  throw API_ROUTE_ERROR.create({
    message: "worker-private-message",
    detail: "worker-private-detail",
  });
}
