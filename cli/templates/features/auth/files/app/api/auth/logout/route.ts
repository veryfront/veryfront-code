export function POST(): Response {
  return Response.json(
    { success: true },
    {
      headers: {
        "Set-Cookie": "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      },
    },
  );
}
