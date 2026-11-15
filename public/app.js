"use strict";

const loginPanel = document.querySelector("#login");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const appPanel = document.querySelector("#app");
const chatForm = document.querySelector("#chat-form");
const input = document.querySelector("#message");
const messagesPanel = document.querySelector("#messages");
const sendButton = document.querySelector("#send");
const history = [];

function showMessage(text, role) {
  const item = document.createElement("div");
  item.className = `bubble ${role}`;
  item.textContent = text;
  messagesPanel.append(item);
  messagesPanel.scrollTop = messagesPanel.scrollHeight;
  return item;
}

async function request(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "A solicitação falhou.");
  return data;
}

function showLogin() {
  appPanel.hidden = true;
  loginPanel.hidden = false;
  document.querySelector("#password").focus();
}

function showApp() {
  loginPanel.hidden = true;
  appPanel.hidden = false;
  input.focus();
  if (!history.length) {
    showMessage("Oi! Sou a ET. Sobre o que você gostaria de conversar?", "et");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const button = loginForm.querySelector("button");
  button.disabled = true;
  try {
    await request("/api/login", {
      password: document.querySelector("#password").value,
    });
    document.querySelector("#password").value = "";
    showApp();
  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logout").addEventListener("click", async () => {
  try {
    await request("/api/logout", {});
  } finally {
    history.length = 0;
    messagesPanel.replaceChildren();
    showLogin();
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content || sendButton.disabled) return;

  history.push({ role: "user", content });
  showMessage(content, "user");
  input.value = "";
  sendButton.disabled = true;
  const pending = showMessage("ET está pensando…", "et pending");

  try {
    const data = await request("/v1/chat", {
      messages: history.slice(-30),
    });
    pending.textContent = data.reply;
    pending.classList.remove("pending");
    history.push({ role: "assistant", content: data.reply });
  } catch (error) {
    pending.textContent = error.message;
    pending.classList.remove("pending");
    if (error.message.includes("Entre na ET")) showLogin();
    history.pop();
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
});

async function initialize() {
  try {
    const session = await request("/api/session");
    if (session.authenticated) showApp();
    else showLogin();
  } catch {
    loginPanel.hidden = false;
    loginError.textContent = "Não foi possível conectar à ET. Atualize a página.";
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}

initialize();
