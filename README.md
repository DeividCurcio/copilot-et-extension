# ET — assistente web pessoal

Este repositório contém uma interface PWA responsiva e uma API Node.js para
conversar com a ET em celular ou computador. O backend mantém a chave do modelo
no Secret Manager; a página nunca recebe nem armazena essa chave.

## Recursos desta versão

- Interface adaptável a celular e opção de instalação na tela inicial.
- Conversa com Gemini; o histórico fica apenas na aba atual.
- Login com senha forte e sessão `HttpOnly`, `SameSite=Strict`, com validade de
  12 horas.
- O Gmail não está conectado nesta versão remota. A conexão OAuth desktop atual
  permanece apenas na ET local; não copie tokens para este repositório/Cloud Run.
- Não há envio autônomo de e-mail, acesso à câmera/microfone ou geração remota
  de mídia nesta edição.

## Executar localmente

Requer Node.js 20+.

1. Defina `UPSTREAM_KEY`, `ET_ACCESS_PASSWORD_HASH` e `ET_SESSION_SECRET` no
   ambiente. Nunca adicione esses valores ao repositório.
2. O hash da senha tem o formato `scrypt$<salt-hex>$<hash-hex>`; o segredo de
   sessão deve ser pelo menos 32 bytes aleatórios codificados em base64url.
3. Execute `npm start` e abra `http://localhost:8787`.

## Publicar no Google Cloud Run

O deploy é uma ação de nuvem e pode gerar cobrança de Cloud Run, Cloud Build e
Secret Manager. O Cloud Run terá uma URL pública, mas todas as conversas exigem
uma senha forte de acesso. Não reutilize a senha da sua conta Google.

1. Instale o [Google Cloud CLI](https://cloud.google.com/sdk/docs/install).
2. Faça login no seu computador: `gcloud auth login`.
3. Selecione/crie um projeto Google Cloud com faturamento habilitado e permissões
   para Cloud Run, Cloud Build, Secret Manager e contas de serviço.
4. No PowerShell, entre nesta pasta e rode:

   ```powershell
   .\scripts\deploy-cloud-run.ps1
   ```

5. O script pede o ID do projeto, região, uma **nova** chave Gemini e uma senha
   exclusiva com pelo menos 24 caracteres. Confirma antes de habilitar serviços
   ou publicar. Os segredos são enviados ao Google Secret Manager por arquivos
   temporários locais, que são removidos ao fim.
6. Abra a URL HTTPS retornada no celular e selecione **Adicionar à tela inicial**.

Para custo baixo, a implantação usa zero instâncias mínimas e limita o máximo a
duas. Isso não garante custo zero; veja o faturamento e configure alertas no
Google Cloud.

## Testes

```powershell
npm test
```

Consulte [SEGURANCA.md](./SEGURANCA.md) antes de publicar ou mudar os escopos.
