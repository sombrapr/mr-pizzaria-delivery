param(
    [switch]$Once,
    [switch]$TestPrint
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$BaseDir = $PSScriptRoot
$ConfigPath = Join-Path $BaseDir "config.json"
$StatePath = Join-Path $BaseDir "estado_local.json"
$LogPath = Join-Path $BaseDir "impressao.log"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
    Write-Host $line
}

function Get-PlainTextFromSecureString {
    param([Security.SecureString]$Secure)
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

function Read-Config {
    if (-not (Test-Path $ConfigPath)) {
        throw "Configuracao nao encontrada. Execute primeiro o arquivo 1_CONFIGURAR.bat."
    }

    $cfg = Get-Content -Path $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $cfg.ApiBaseUrl -or -not $cfg.PrinterName -or -not $cfg.EncryptedApiKey) {
        throw "Configuracao incompleta. Execute novamente o arquivo 1_CONFIGURAR.bat."
    }

    $secureKey = ConvertTo-SecureString $cfg.EncryptedApiKey
    $apiKey = Get-PlainTextFromSecureString $secureKey

    return [PSCustomObject]@{
        ApiBaseUrl = ([string]$cfg.ApiBaseUrl).TrimEnd("/")
        PrinterName = [string]$cfg.PrinterName
        ApiKey = $apiKey
        PollSeconds = [Math]::Max(3, [int]$cfg.PollSeconds)
    }
}

function Get-InstalledPrinters {
    try {
        return @(Get-Printer | Sort-Object Name | Select-Object -ExpandProperty Name)
    }
    catch {
        return @(Get-CimInstance Win32_Printer | Sort-Object Name | Select-Object -ExpandProperty Name)
    }
}

function Load-LocalState {
    $set = New-Object 'System.Collections.Generic.HashSet[string]'
    if (Test-Path $StatePath) {
        try {
            $items = @(Get-Content $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json)
            foreach ($item in $items) {
                if ($item) { [void]$set.Add([string]$item) }
            }
        }
        catch {
            Write-Log "Nao foi possivel ler o estado local; um novo estado sera criado." "WARN"
        }
    }
    # A vírgula impede o PowerShell de enumerar o HashSet vazio e devolvê-lo como $null.
    return ,$set
}

function Save-LocalState {
    param($Set)
    @($Set) | ConvertTo-Json | Set-Content -Path $StatePath -Encoding UTF8
}

function Invoke-MrApi {
    param(
        [string]$Method,
        [string]$Path,
        $Body = $null,
        $Config
    )

    $headers = @{ "x-api-key" = $Config.ApiKey }
    $uri = "$($Config.ApiBaseUrl)$Path"

    $params = @{
        Uri = $uri
        Method = $Method
        Headers = $headers
        TimeoutSec = 30
        UseBasicParsing = $true
    }

    if ($null -ne $Body) {
        $params.ContentType = "application/json"
        $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
    }

    return Invoke-RestMethod @params
}

function Add-Line {
    param(
        [System.Collections.ArrayList]$Lines,
        [string]$Text,
        [bool]$Bold = $false,
        [bool]$Center = $false
    )
    [void]$Lines.Add([PSCustomObject]@{
        Text = $Text
        Bold = $Bold
        Center = $Center
    })
}

function Wrap-Text {
    param([string]$Text, [int]$Width = 42)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return @("")
    }

    $result = New-Object System.Collections.ArrayList
    $remaining = $Text.Trim()

    while ($remaining.Length -gt $Width) {
        $cut = $remaining.LastIndexOf(" ", $Width)
        if ($cut -lt 1) { $cut = $Width }
        [void]$result.Add($remaining.Substring(0, $cut).Trim())
        $remaining = $remaining.Substring($cut).Trim()
    }

    if ($remaining.Length -gt 0) {
        [void]$result.Add($remaining)
    }

    return @($result)
}

function Format-Address {
    param($Address)

    if ($null -eq $Address) { return "" }

    $parts = New-Object System.Collections.ArrayList
    $streetNumber = @($Address.street, $Address.number) | Where-Object { $_ }
    if ($streetNumber.Count -gt 0) {
        [void]$parts.Add(($streetNumber -join ", "))
    }
    if ($Address.district) { [void]$parts.Add([string]$Address.district) }
    if ($Address.reference) { [void]$parts.Add([string]$Address.reference) }

    return ($parts -join " - ")
}

function Build-ReceiptLines {
    param($Job)

    $order = $Job.order
    $type = [string]$Job.type
    $lines = New-Object System.Collections.ArrayList

    $title = if ($type -eq "pizza") { "COMANDA - PIZZAS" } else { "COMANDA - COZINHA" }

    Add-Line $lines "MR PIZZARIA" $true $true
    Add-Line $lines ("PEDIDO N. {0}" -f $order.number) $true $true
    Add-Line $lines $title $true $true
    Add-Line $lines ("-" * 42)

    try {
        $created = [DateTimeOffset]::Parse([string]$order.createdAt).ToLocalTime().ToString("dd/MM/yyyy HH:mm")
    }
    catch {
        $created = [string]$order.createdAt
    }

    Add-Line $lines ("HORARIO: {0}" -f $created)
    foreach ($part in (Wrap-Text ("CLIENTE: {0}" -f $order.customerName))) {
        Add-Line $lines $part
    }

    if ([string]$order.deliveryType -eq "Entrega") {
        $addressText = Format-Address $order.address
        foreach ($part in (Wrap-Text ("ENTREGA: {0}" -f $addressText))) {
            Add-Line $lines $part
        }
    }
    else {
        foreach ($part in (Wrap-Text "RETIRADA: Av. Parana, 897, Centro")) {
            Add-Line $lines $part
        }
    }

    Add-Line $lines ("-" * 42)

    $items = @($order.items | Where-Object {
        if ($type -eq "pizza") { $_.type -eq "pizza" }
        else { $_.type -ne "pizza" }
    })

    foreach ($item in $items) {
        foreach ($part in (Wrap-Text ("{0}x {1}" -f $item.qty, $item.name))) {
            Add-Line $lines $part $true
        }

        if ($item.note) {
            foreach ($part in (Wrap-Text ("OBS.: {0}" -f $item.note))) {
                Add-Line $lines $part $true
            }
        }

        Add-Line $lines ("-" * 42)
    }

    Add-Line $lines ("TIPO: {0}" -f $order.deliveryType) $true
    Add-Line $lines "PREVISAO: 40 A 60 MINUTOS"
    Add-Line $lines ""

    return $lines
}

function Print-Lines {
    param(
        [System.Collections.ArrayList]$Lines,
        [string]$PrinterName
    )

    Add-Type -AssemblyName System.Drawing

    $installed = Get-InstalledPrinters
    if ($installed -notcontains $PrinterName) {
        throw "A impressora '$PrinterName' nao foi encontrada no Windows."
    }

    $document = New-Object System.Drawing.Printing.PrintDocument
    $document.PrinterSettings.PrinterName = $PrinterName
    $document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
    $document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(2, 2, 2, 2)

    # Papel de 80 mm com altura calculada conforme a quantidade de linhas.
    # Isso evita que a impressora avance uma folha longa depois da comanda.
    $estimatedHeight = [Math]::Max(120, 20 + ($Lines.Count * 12))
    $document.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize(
        "Comanda 80mm compacta",
        315,
        [int]$estimatedHeight
    )

    $fontNormal = New-Object System.Drawing.Font("Consolas", 7.5, [System.Drawing.FontStyle]::Regular)
    $fontBold = New-Object System.Drawing.Font("Consolas", 8.0, [System.Drawing.FontStyle]::Bold)
    $brush = [System.Drawing.Brushes]::Black

    $handler = [System.Drawing.Printing.PrintPageEventHandler]{
        param($sender, $e)

        $y = 1.0
        $pageWidth = [single]$e.MarginBounds.Width

        foreach ($line in $Lines) {
            $font = if ($line.Bold) { $fontBold } else { $fontNormal }
            $text = [string]$line.Text

            if ($line.Center) {
                $size = $e.Graphics.MeasureString($text, $font)
                $x = [Math]::Max(0, ($pageWidth - $size.Width) / 2)
            }
            else {
                $x = 0
            }

            $e.Graphics.DrawString($text, $font, $brush, [single]$x, [single]$y)
            $y += if ($line.Bold) { 12.0 } else { 11.0 }
        }

        $e.HasMorePages = $false
    }

    try {
        $document.add_PrintPage($handler)
        $document.Print()
    }
    finally {
        $document.remove_PrintPage($handler)
        $fontNormal.Dispose()
        $fontBold.Dispose()
        $document.Dispose()
    }
}

function Confirm-Printed {
    param($Job, $Config)

    $number = [uri]::EscapeDataString([string]$Job.order.number)
    $body = @{ type = [string]$Job.type }
    [void](Invoke-MrApi -Method "POST" -Path "/api/orders/$number/printed" -Body $body -Config $Config)
}

function Print-TestPage {
    param($Config)

    $lines = New-Object System.Collections.ArrayList
    Add-Line $lines "MR PIZZARIA" $true $true
    Add-Line $lines "TESTE DE IMPRESSAO" $true $true
    Add-Line $lines ("-" * 42)
    Add-Line $lines ("IMPRESSORA: {0}" -f $Config.PrinterName)
    Add-Line $lines ("DATA: {0}" -f (Get-Date -Format "dd/MM/yyyy HH:mm:ss"))
    Add-Line $lines "CONEXAO COM O SISTEMA: OK"
    Add-Line $lines ""
    Add-Line $lines ""
    Print-Lines -Lines $lines -PrinterName $Config.PrinterName
}

try {
    $config = Read-Config
    $localPrinted = Load-LocalState

    Write-Log "Conector iniciado. Impressora: $($config.PrinterName)."

    # Teste de autenticacao e comunicacao com o servidor.
    $health = Invoke-MrApi -Method "GET" -Path "/api/print-queue" -Config $config
    Write-Log "Conexao com o servidor confirmada."

    if ($TestPrint) {
        Print-TestPage -Config $config
        Write-Log "Pagina de teste enviada para a impressora."
        exit 0
    }

    while ($true) {
        try {
            $queue = Invoke-MrApi -Method "GET" -Path "/api/print-queue" -Config $config
            $jobs = @($queue.jobs)

            foreach ($job in $jobs) {
                $key = "{0}:{1}" -f $job.order.number, $job.type

                if ($localPrinted.Contains($key)) {
                    try {
                        Confirm-Printed -Job $job -Config $config
                        [void]$localPrinted.Remove($key)
                        Save-LocalState $localPrinted
                        Write-Log "Confirmacao pendente enviada: $key."
                    }
                    catch {
                        Write-Log "A comanda $key ja foi impressa localmente, mas a confirmacao ao servidor falhou: $($_.Exception.Message)" "WARN"
                    }
                    continue
                }

                try {
                    $lines = Build-ReceiptLines -Job $job
                    Print-Lines -Lines $lines -PrinterName $config.PrinterName

                    # Marca localmente antes da confirmacao remota, evitando impressao duplicada
                    # caso a internet caia logo depois da impressao.
                    [void]$localPrinted.Add($key)
                    Save-LocalState $localPrinted
                    Write-Log "Comanda impressa: $key."

                    Confirm-Printed -Job $job -Config $config
                    [void]$localPrinted.Remove($key)
                    Save-LocalState $localPrinted
                    Write-Log "Comanda confirmada no servidor: $key."
                }
                catch {
                    Write-Log ("Erro ao processar a comanda {0}: {1}" -f $key, $_.Exception.Message) "ERROR"
                }
            }
        }
        catch {
            Write-Log "Falha ao consultar a fila: $($_.Exception.Message)" "ERROR"
        }

        if ($Once) { break }
        Start-Sleep -Seconds $config.PollSeconds
    }
}
catch {
    Write-Log $_.Exception.Message "FATAL"
    Write-Host ""
    Write-Host "Pressione ENTER para fechar."
    [void](Read-Host)
    exit 1
}
