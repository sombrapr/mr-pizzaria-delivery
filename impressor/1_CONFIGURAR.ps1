$ErrorActionPreference = 'Stop'
$BaseDir = $PSScriptRoot
$ConfigPath = Join-Path $BaseDir 'config.json'

Write-Host ''
Write-Host 'CONFIGURACAO DO IMPRESSOR - MR PIZZARIA' -ForegroundColor Yellow
Write-Host ''

$defaultUrl = 'https://SEU-SISTEMA.onrender.com'
$url = Read-Host "Endereco do sistema [$defaultUrl]"
if ([string]::IsNullOrWhiteSpace($url)) { $url = $defaultUrl }
$url = $url.TrimEnd('/')

try {
  $printers = @(Get-Printer | Sort-Object Name | Select-Object -ExpandProperty Name)
} catch {
  $printers = @(Get-CimInstance Win32_Printer | Sort-Object Name | Select-Object -ExpandProperty Name)
}

if (-not $printers.Count) { throw 'Nenhuma impressora foi encontrada no Windows.' }
Write-Host ''
for ($i = 0; $i -lt $printers.Count; $i++) { Write-Host ("[{0}] {1}" -f ($i + 1), $printers[$i]) }
Write-Host ''
$choice = [int](Read-Host 'Numero da impressora')
if ($choice -lt 1 -or $choice -gt $printers.Count) { throw 'Impressora invalida.' }
$printerName = $printers[$choice - 1]

$secureKey = Read-Host 'PRINT_API_KEY configurada no servidor' -AsSecureString
$encryptedKey = ConvertFrom-SecureString $secureKey
$poll = Read-Host 'Intervalo de consulta em segundos [5]'
if ([string]::IsNullOrWhiteSpace($poll)) { $poll = 5 }

$config = [ordered]@{
  ApiBaseUrl = $url
  PrinterName = $printerName
  EncryptedApiKey = $encryptedKey
  PollSeconds = [Math]::Max(3, [int]$poll)
}
$config | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8

Write-Host ''
Write-Host 'Configuracao salva com sucesso.' -ForegroundColor Green
Write-Host "Impressora: $printerName"
Write-Host "Sistema: $url"
Write-Host ''
Read-Host 'Pressione ENTER para fechar'
