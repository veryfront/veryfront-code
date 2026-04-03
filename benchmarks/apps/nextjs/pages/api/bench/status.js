export default function handler(_req, res) {
  res.status(200).json({ ok: true, source: "nextjs", items: 10 });
}
