export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Simulate validation
    if (!body.name || body.name.length < 2) {
      return Response.json({ error: "Name is too short" }, { status: 400 });
    }

    if (!body.email || !body.email.includes("@")) {
      return Response.json({ error: "Invalid email address" }, { status: 400 });
    }

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return Response.json({
      success: true,
      message: `Thanks ${body.name}! We received your message.`,
    });
  } catch (_e) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}
