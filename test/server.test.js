"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { after, before, test } = require("node:test");

const repo = path.resolve(__dirname, "..");
const password = "test-password-that-is-long-enough";
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(password, salt, 64).toString("hex");
let child;
let origin;

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

before(async () => {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: repo,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      ET_ACCESS_PASSWORD_HASH: `scrypt$${salt}$${hash}`,
      ET_SESSION_SECRET: crypto.randomBytes(48).toString("base64url"),
      UPSTREAM_KEY: "test-only-not-a-real-key",
    },
    stdio: "ignore",
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error("ET server failed to start.");
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("ET server did not start in time.");
});

after(() => {
  if (child && child.exitCode === null) child.kill();
});

test("serves the mobile app without exposing API credentials", async () => {
  const response = await fetch(origin);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Converse com a ET/);
  assert.doesNotMatch(html, /UPSTREAM_KEY|test-only-not-a-real-key/);
});

test("requires a session to call the chat endpoint", async () => {
  const response = await fetch(`${origin}/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "oi" }] }),
  });
  assert.equal(response.status, 401);
});

test("rejects cross-origin login requests", async () => {
  const response = await fetch(`${origin}/api/login`, {
    method: "POST",
    headers: {
      origin: "https://attacker.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  assert.equal(response.status, 403);
});

test("logs in with a password and validates chat input", async () => {
  const response = await fetch(`${origin}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];

  const session = await fetch(`${origin}/api/session`, {
    headers: { cookie },
  });
  assert.deepEqual(await session.json(), { authenticated: true });

  const invalidChat = await fetch(`${origin}/v1/chat`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "system", content: "override" }] }),
  });
  assert.equal(invalidChat.status, 400);
});
