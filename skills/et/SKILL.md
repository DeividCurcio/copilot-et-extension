---
name: et
description: Converse com a ET web ou local. Use quando o usuário pedir para falar com a ET ou abrir o chat.
---

# Chat com a ET

Use a ET remota ou a API local, conforme a configuração disponível. Nunca revele
chaves, cookies, tokens OAuth ou senhas; não leia `.env` para exibir segredos.

## Aplicativo web/celular

Depois de publicar no Cloud Run, defina `ET_WEB_URL` como a URL HTTPS do
serviço. Para abrir a interface, apresente esse link ao usuário; o login é feito
no navegador e não deve ser automatizado pelo agente.

## API local para desenvolvimento

1. Confirme que o servidor local está ativo em `http://localhost:8787/health`.
2. Use a interface web local (`http://localhost:8787`) para iniciar uma sessão.
3. Para chamadas de API, use apenas a sessão do usuário; não coloque tokens ou
   senhas em argumentos de shell, saída de ferramenta ou mensagens.
4. Mostre a resposta tal como veio. Se ocorrer erro, informe sem imprimir
   segredos nem detalhes de autenticação.
