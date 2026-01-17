/**
 * Simple Test Route
 */

export function GET(req: Request) {
  return Response.json({ ok: true, message: "Test route works!" });
}

export function POST(req: Request) {
  return Response.json({ ok: true, message: "POST works!" });
}

export const OPTIONS = () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
