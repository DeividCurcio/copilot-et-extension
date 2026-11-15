"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY = 32 * 1024;
const MAX_MESSAGES = 30;
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const UPSTREAM_URL =
  process.env.UPSTREAM_URL ||
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const UPSTREAM_MODEL = process.env.UPSTREAM_MODEL || "gemini-3.5-flash-lite";
const ACCESS_PASSWORD_HASH = process.env.ET_ACCESS_PASSWORD_HASH || "";
const SESSION_SECRET = process.env.ET_SESSION_SECRET || "";
const WEB_ROOT = path.join(__dirname, "public");

const SYSTEM = `Você é ET, assistente pessoal do usuário. Seja curiosa, calorosa,
direta e honesta; responda em português brasileiro, a menos que o usuário peça
outro idioma. Você pode conversar sobre muitos assuntos, mas não alegue ser
consciente, superinteligente, ter experiências próprias ou acesso a ferramentas
que não foram realmente conectadas. Se algo exige internet, dados recentes ou
uma ferramenta não disponível, diga isso claramente. Não peça nem repita senhas,
chaves de API ou códigos de autenticação. Esta edição remota não tem Gmail,
câmera, gravação nem geração de mídia conectados.`;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const failedLogins = new Map();
const requestCounts = new Map();

if (process.env.NODE_ENV === "production") {
  if (!ACCESS_PASSWORD_HASH || !SESSION_SECRET) {
    throw new Error(
      "ET_ACCESS_PASSWORD_HASH e ET_SESSION_SECRET são obrigatórios em produção.",
    );
  }
  if (Buffer.from(SESSION_SECRET, "base64url").length < 32) {
    throw new Error("ET_SESSION_SECRET deve ter pelo menos 32 bytes aleatórios.");
  }
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(value));
}

function rateLimit(map, key, max, windowMs) {
  const now = Date.now();
  const record = map.get(key);
  if (!record || record.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  record.count += 1;
  return record.count > max;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Requisição muito grande."), { status: 413 }));
      } else {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((item) => item.trim().split("="))
      .filter((parts) => parts.length >= 2)
      .map(([name, ...value]) => [name, value.join("=")]),
  );
}

function sign(payload) {
  return crypto
    .createHmac("sha256", Buffer.from(SESSION_SECRET, "base64url"))
    .update(payload)
    .digest("base64url");
}

function sessionCookie(req, clear = false) {
  const secure = process.env.NODE_ENV === "production" ||
    req.headers["x-forwarded-proto"] === "https";
  const attributes = [
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${clear ? 0 : SESSION_TTL_SECONDS}`,
  ];
  if (secure) attributes.push("Secure");
  return `et_session=${clear ? "" : req.sessionToken}; ${attributes.join("; ")}`;
}

function validSession(req) {
  const token = parseCookies(req.headers.cookie).et_session || "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return false;
  }
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.exp > Date.now();
  } catch {
    return false;
  }
}

function passwordMatches(password) {
  const [algorithm, salt, hashHex] = ACCESS_PASSWORD_HASH.split("$");
  if (algorithm !== "scrypt" || !salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  const expectedProtocol =
    req.headers["x-forwarded-proto"] === "https" ? "https:" : "http:";
  try {
    const parsed = new URL(origin);
    return parsed.host === host && parsed.protocol === expectedProtocol;
  } catch {
    return false;
  }
}

async function reply(messages) {
  if (!process.env.UPSTREAM_KEY) {
    throw Object.assign(new Error("A chave do modelo não está configurada."), {
      status: 503,
    });
  }
  const response = await fetch(UPSTREAM_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.UPSTREAM_KEY}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model: UPSTREAM_MODEL,
      messages: [{ role: "system", content: SYSTEM }, ...messages],
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    console.error("Upstream model error:", response.status, error.slice(0, 500));
    throw Object.assign(new Error("O serviço de IA recusou a solicitação."), {
      status: response.status === 429 ? 429 : 502,
    });
  }
  const text = (await response.json())?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw Object.assign(new Error("O modelo retornou uma resposta vazia."), {
      status: 502,
    });
  }
  return text;
}

function serveStatic(req, res, pathname) {
  const route = pathname === "/" ? "/index.html" : pathname;
  const target = path.resolve(WEB_ROOT, `.${route}`);
  if (!target.startsWith(`${WEB_ROOT}${path.sep}`) || !fs.existsSync(target)) {
    json(res, 404, { error: "Não encontrado." });
    return;
  }
  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    json(res, 404, { error: "Não encontrado." });
    return;
  }
  res.writeHead(200, {
    "cache-control": route === "/service-worker.js" ? "no-cache" : "public, max-age=300",
    "content-type": MIME_TYPES[path.extname(target)] || "application/octet-stream",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; " +
      "style-src 'self'; script-src 'self'; manifest-src 'self'; " +
      "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
  });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  try {
    if (req.method === "GET" && pathname === "/health") {
      return json(res, 200, { status: "ok", name: "ET" });
    }

    if (req.method === "GET" && pathname === "/api/session") {
      return json(res, 200, { authenticated: validSession(req) });
    }

    if (req.method === "POST") {
      if (!isSameOrigin(req)) {
        return json(res, 403, { error: "Origem não permitida." });
      }
      if (pathname === "/api/login") {
        const address = req.socket.remoteAddress || "unknown";
        if (rateLimit(failedLogins, address, 12, 15 * 60_000)) {
          return json(res, 429, { error: "Muitas tentativas; espere 15 minutos." });
        }
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch (error) {
          return json(res, error.status || 400, { error: "JSON inválido." });
        }
        const password = body?.password;
        if (typeof password !== "string" || password.length > 256 ||
            !passwordMatches(password)) {
          return json(res, 401, { error: "Senha incorreta." });
        }
        failedLogins.delete(address);
        const payload = Buffer.from(
          JSON.stringify({ exp: Date.now() + SESSION_TTL_SECONDS * 1000 }),
        ).toString("base64url");
        req.sessionToken = `${payload}.${sign(payload)}`;
        return json(
          res,
          200,
          { authenticated: true },
          { "set-cookie": sessionCookie(req) },
        );
      }

      if (pathname === "/api/logout") {
        return json(
          res,
          200,
          { authenticated: false },
          { "set-cookie": sessionCookie(req, true) },
        );
      }

      if (pathname === "/v1/chat") {
        if (!validSession(req)) {
          return json(res, 401, { error: "Entre na ET para continuar." });
        }
        const address = req.socket.remoteAddress || "unknown";
        if (rateLimit(requestCounts, address, 60, 60_000)) {
          return json(res, 429, { error: "Limite temporário de mensagens atingido." });
        }
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch (error) {
          return json(res, error.status || 400, { error: "JSON inválido." });
        }
        const messages = body?.messages;
        if (!Array.isArray(messages) || messages.length < 1 ||
            messages.length > MAX_MESSAGES ||
            messages.some((message) =>
              !message || !["user", "assistant"].includes(message.role) ||
              typeof message.content !== "string" ||
              !message.content.trim() || message.content.length > 8000)) {
          return json(res, 400, { error: "Histórico de conversa inválido." });
        }
        return json(res, 200, { reply: await reply(messages) });
      }
      return json(res, 404, { error: "Não encontrado." });
    }

    if (req.method === "GET" && pathname.startsWith("/api/")) {
      return json(res, 404, { error: "Não encontrado." });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: "Método não permitido." });
    }
    return serveStatic(req, res, pathname);
  } catch (error) {
    console.error(error.message);
    return json(
      res,
      error.status || 500,
      { error: error.status ? error.message : "Erro interno." },
    );
  }
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`ET web listening on port ${PORT}`);
});

process.on("unhandledRejection", (error) =>
  console.error("Unhandled rejection:", error),
);
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
