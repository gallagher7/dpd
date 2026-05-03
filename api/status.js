// api/status.js
// GET /api/status?domain=example.com → {"status":"on"} veya {"status":"off"}

export const config = { runtime: "nodejs" };

async function upstash(cmd) {
  const r = await fetch(
    `${process.env.UPSTASH_REDIS_REST_URL}/${cmd.map(encodeURIComponent).join("/")}`,
    { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } }
  );
  return (await r.json()).result;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  let domain = (req.query.domain || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!domain) return res.json({ status: "off" });

  try {
    const [lic, site] = await Promise.all([
      upstash(["get", `lic:${domain}`]),
      upstash(["get", `site:${domain}`]),
    ]);
    const on = lic === "1" && site !== "off";
    return res.json({ status: on ? "on" : "off" });
  } catch {
    return res.json({ status: "on" }); // hata → aç bırak
  }
}
