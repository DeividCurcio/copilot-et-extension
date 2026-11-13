// API da IA ET: POST /v1/chat  { "message": "..." }  com  Authorization: Bearer <ET_API_KEY>
const http = require("http");
const fs = require("fs");
const path = require("path");

try {
  for (const l of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const { PORT = 8787, ET_API_KEY, UPSTREAM_URL, UPSTREAM_KEY, UPSTREAM_MODEL } = process.env;
const SYSTEM = "Você é a IA ET, uma assistente amigável e prestativa.";

async function reply(message) {
  if (!UPSTREAM_URL) return `ET recebeu: ${message} (configure UPSTREAM_URL para usar um modelo real)`;
  const r = await fetch(UPSTREAM_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${UPSTREAM_KEY}` },
    body: JSON.stringify({
      model: UPSTREAM_MODEL,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: message }],
    }),
  });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return (await r.json()).choices[0].message.content;
}

http
  .createServer(async (req, res) => {
    const send = (c, o) => (res.writeHead(c, { "content-type": "application/json" }), res.end(JSON.stringify(o)));
    if (req.method !== "POST" || req.url !== "/v1/chat") return send(404, { error: "not found" });
    if (!ET_API_KEY || req.headers.authorization !== `Bearer ${ET_API_KEY}`) return send(401, { error: "invalid key" });
    let body = "";
    for await (const c of req) body += c;
    try {
      const { message } = JSON.parse(body);
      send(200, { reply: await reply(String(message)) });
    } catch (e) {
      send(400, { error: e.message });
    }
  })
  .listen(PORT, () => console.log(`IA ET em http://localhost:${PORT}/v1/chat`));
