---
name: et
description: Conversar com a ET, a IA serena e autônoma do usuário. Use quando o usuário pedir para falar com a ET ou abrir o chat da ET.
---

# Chat com a ET

Envie a mensagem do usuário para a API local da ET e mostre a resposta exatamente como veio, sem reescrever.

1. Garanta que o servidor está rodando (`curl -s localhost:8787` responde). Se não, inicie com `cd ~/copilot-et-extension && node server.js` em modo async.
2. Leia a chave com `grep ^ET_API_KEY ~/copilot-et-extension/.env | cut -d= -f2` (nunca exiba a chave).
3. Chame:

```bash
curl -s -X POST localhost:8787/v1/chat \
  -H "Authorization: Bearer $KEY" \
  -d '{"message":"<mensagem em JSON escapado>"}'
```

4. Mostre o campo `reply`. Se vier `error`, informe o erro ao usuário.
