$ErrorActionPreference = "Stop"

function Convert-SecureStringToPlainText([System.Security.SecureString]$Value) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Set-CloudSecret([string]$Name, [string]$Value, [string]$Project) {
    $tempPath = Join-Path $env:TEMP ("et-secret-" + [guid]::NewGuid().ToString("N"))
    try {
        [IO.File]::WriteAllText($tempPath, $Value, [Text.UTF8Encoding]::new($false))
        $identity = "$env:USERDOMAIN\$env:USERNAME"
        icacls $tempPath /inheritance:r /grant:r "${identity}:(R,W)" | Out-Null
        gcloud secrets describe $Name --project $Project *> $null
        if ($LASTEXITCODE -ne 0) {
            gcloud secrets create $Name --replication-policy=automatic --project $Project
            if ($LASTEXITCODE -ne 0) { throw "Não foi possível criar o segredo $Name." }
        }
        gcloud secrets versions add $Name --data-file=$tempPath --project $Project
        if ($LASTEXITCODE -ne 0) { throw "Não foi possível atualizar o segredo $Name." }
    }
    finally {
        if (Test-Path $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
    }
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "Google Cloud CLI não encontrado. Instale em https://cloud.google.com/sdk/docs/install e abra um novo PowerShell."
}

$activeAccount = gcloud auth list --filter=status:ACTIVE --format="value(account)"
if ($LASTEXITCODE -ne 0 -or -not $activeAccount) {
    throw "Faça login primeiro com: gcloud auth login"
}
Write-Host "Conta Google Cloud ativa: $activeAccount"

$projectId = Read-Host "ID do projeto Google Cloud (não o nome)"
$region = Read-Host "Região Cloud Run [southamerica-east1]"
if ([string]::IsNullOrWhiteSpace($region)) { $region = "southamerica-east1" }
Write-Host ""
Write-Host "Este deploy publica a página na internet, protegida por senha, e pode gerar cobrança de Cloud Run, Cloud Build e Secret Manager."
Write-Host "A senha protege o aplicativo; a URL Cloud Run em si será acessível publicamente."
$confirm = Read-Host "Digite DEPLOY para confirmar e continuar"
if ($confirm -cne "DEPLOY") { throw "Deploy cancelado." }

$apiSecure = Read-Host "Cole uma NOVA chave Gemini (revogue a que foi compartilhada antes)" -AsSecureString
$apiKey = Convert-SecureStringToPlainText $apiSecure
if ([string]::IsNullOrWhiteSpace($apiKey)) { throw "A chave Gemini não pode estar vazia." }

$passwordSecure = Read-Host "Crie uma senha de acesso forte (mínimo 24 caracteres; não reutilize senha Google)" -AsSecureString
$password = Convert-SecureStringToPlainText $passwordSecure
if ($password.Length -lt 24) { throw "Use uma senha com pelo menos 24 caracteres." }
$passwordAgain = Convert-SecureStringToPlainText (Read-Host "Repita a senha de acesso" -AsSecureString)
if ($password -cne $passwordAgain) { throw "As senhas não coincidem." }

try {
    $env:ET_SETUP_PASSWORD = $password
    $passwordHash = node -e "const c=require('node:crypto'), p=process.env.ET_SETUP_PASSWORD, s=c.randomBytes(16).toString('hex'); console.log('scrypt$'+s+'$'+c.scryptSync(p,s,64).toString('hex'))"
    if ($LASTEXITCODE -ne 0 -or -not $passwordHash) { throw "Não foi possível derivar o hash da senha." }
}
finally {
    Remove-Item Env:\ET_SETUP_PASSWORD -ErrorAction SilentlyContinue
}

$sessionSecret = node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
if ($LASTEXITCODE -ne 0 -or -not $sessionSecret) { throw "Não foi possível gerar a chave de sessão." }

try {
    gcloud config set project $projectId
    if ($LASTEXITCODE -ne 0) { throw "Projeto Google Cloud inválido ou inacessível." }
    gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com --project $projectId
    if ($LASTEXITCODE -ne 0) { throw "Falha ao habilitar APIs. Confira permissões e faturamento." }

    Set-CloudSecret "et-upstream-key" $apiKey $projectId
    Set-CloudSecret "et-access-password-hash" $passwordHash $projectId
    Set-CloudSecret "et-session-secret" $sessionSecret $projectId

    $projectNumber = gcloud projects describe $projectId --format="value(projectNumber)"
    if ($LASTEXITCODE -ne 0 -or -not $projectNumber) { throw "Não foi possível descobrir o número do projeto." }
    $serviceAccount = "et-runtime@$projectId.iam.gserviceaccount.com"
    gcloud iam service-accounts describe $serviceAccount --project $projectId *> $null
    if ($LASTEXITCODE -ne 0) {
        gcloud iam service-accounts create et-runtime --display-name="ET Cloud Run runtime" --project $projectId
        if ($LASTEXITCODE -ne 0) { throw "Não foi possível criar a conta de serviço da ET." }
    }

    foreach ($secretName in @("et-upstream-key", "et-access-password-hash", "et-session-secret")) {
        gcloud secrets add-iam-policy-binding $secretName `
            --member="serviceAccount:$serviceAccount" `
            --role="roles/secretmanager.secretAccessor" --project $projectId
        if ($LASTEXITCODE -ne 0) { throw "Não foi possível conceder leitura de $secretName à ET." }
    }

    gcloud run deploy et-mobile --source . --project $projectId --region $region `
        --allow-unauthenticated --port 8080 --memory 512Mi --max 2 --min 0 --timeout 60 `
        --service-account=$serviceAccount `
        --set-env-vars="NODE_ENV=production,UPSTREAM_MODEL=gemini-3.5-flash-lite" `
        --set-secrets="UPSTREAM_KEY=et-upstream-key:latest,ET_ACCESS_PASSWORD_HASH=et-access-password-hash:latest,ET_SESSION_SECRET=et-session-secret:latest"
    if ($LASTEXITCODE -ne 0) { throw "Cloud Run não concluiu o deploy." }
    $url = gcloud run services describe et-mobile --project $projectId --region $region --format="value(status.url)"
    Write-Host ""
    Write-Host "Deploy concluído. Link privado por senha: $url"
    Write-Host "Instale no celular: abra o link no navegador e use 'Adicionar à tela inicial'."
}
finally {
    $apiKey = $null
    $password = $null
    $passwordAgain = $null
    $passwordHash = $null
    $sessionSecret = $null
}
