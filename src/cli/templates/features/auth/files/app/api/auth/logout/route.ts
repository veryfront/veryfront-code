export function POST() {
  const headers = new Headers();
  headers.set(
    "Set-Cookie",
    "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
  );
  return Response.json({ success: true }, { headers });
}
