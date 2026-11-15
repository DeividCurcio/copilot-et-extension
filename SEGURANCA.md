# Segurança e limites da ET web

- O repositório público contém somente código e configuração sem credenciais.
- O backend aceita apenas sessão autenticada para `/v1/chat`; não habilita CORS.
- Sessões são assinadas no servidor e enviadas em cookie `HttpOnly`,
  `SameSite=Strict`, com `Secure` em produção.
- O deploy usa segredos do Secret Manager e uma conta de serviço com acesso
  somente aos três segredos necessários.
- Use uma senha aleatória, exclusiva, com 24+ caracteres. A proteção por senha
  não substitui autenticação corporativa; limite instâncias e monitore os logs.
- Nunca comite chaves Gemini, tokens Gmail, `credentials.json`, `.env` ou
  arquivos de conta de serviço.
- A edição hospedada não usa Gmail. Não mova `et_gmail_token.json` para o
  servidor nem conceda escopos Gmail ao serviço atual.
- Para habilitar Gmail no futuro, configure um projeto/consentimento e cliente
  OAuth próprios da ET, com redirect HTTPS, revisão dos escopos Google e
  armazenamento protegido dos tokens no servidor. Não reutilize o cliente que
  mostra a marca de outro aplicativo.
- Rotacione qualquer chave Gemini que tenha sido compartilhada. A chave usada
  no deploy deve ser digitada diretamente no prompt seguro do script local.
