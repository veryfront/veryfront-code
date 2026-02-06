export function POST(): Response {
  return Response.json(
    { success: true },
    {
      headers: {
        "Set-Cookie": "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
      },
    },
  );
}
