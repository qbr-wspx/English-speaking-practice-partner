param([int]$Cycles = 3)
$ErrorActionPreference = 'Stop'
if ($Cycles -lt 1 -or $Cycles -gt 5) { throw 'Cycles must be between 1 and 5.' }
$lingoProject = Split-Path -Parent $PSScriptRoot
$lingoExpectedVersion = (Get-Content -LiteralPath (Join-Path $lingoProject 'package.json') -Raw | ConvertFrom-Json).version
$lingoShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Lingo Studio.lnk'
$lingoShell = New-Object -ComObject WScript.Shell
$lingoTarget = $lingoShell.CreateShortcut($lingoShortcutPath).TargetPath
if (-not (Test-Path -LiteralPath $lingoTarget)) { throw 'The desktop shortcut target is missing.' }
$lingoExisting = Get-CimInstance Win32_Process -Filter "Name = 'Lingo Studio.exe'"
if ($lingoExisting) { throw 'Close the existing application before testing cold starts.' }
# Remove only service/test variables from this verifier process; never print their values.
Get-ChildItem Env: | Where-Object { $_.Name -match '^(DEEPSEEK_|DASHSCOPE_|LINGO_|VITE_DEV_SERVER_URL|ASR_MODEL|TTS_MODEL)' } | ForEach-Object { [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process') }
$lingoStatusFile = Join-Path $env:APPDATA 'english-speaking-companion\startup-status.json'
$lingoResults = @()
for ($lingoCycle = 1; $lingoCycle -le $Cycles; $lingoCycle++) {
    $lingoStartedAt = [DateTimeOffset]::UtcNow
    Start-Process -FilePath $lingoShortcutPath -WindowStyle Hidden
    $lingoReady = $false
    for ($lingoAttempt = 0; $lingoAttempt -lt 45; $lingoAttempt++) {
        Start-Sleep -Milliseconds 500
        try {
            $lingoStatus = Get-Content -LiteralPath $lingoStatusFile -Raw | ConvertFrom-Json
            $lingoHealth = Invoke-RestMethod 'http://127.0.0.1:18765/health' -TimeoutSec 2
            $lingoVisible = @(Get-Process -Name 'Lingo Studio' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $lingoTarget -and $_.MainWindowHandle -ne 0 }).Count -gt 0
            # PowerShell 7 may deserialize ISO timestamps to DateTime; preserve its UTC kind.
            $lingoReady = $lingoVisible -and $lingoStatus.version -eq $lingoExpectedVersion -and $lingoStatus.stage -eq 'ready' -and ([DateTimeOffset]$lingoStatus.at) -ge $lingoStartedAt -and $lingoStatus.executable -eq $lingoTarget -and $lingoHealth.deepseek_configured -and $lingoHealth.speech_configured
            if ($lingoReady) { break }
        } catch { }
    }
    if (-not $lingoReady) { throw "Cold start $lingoCycle failed; inspect startup-status.json." }
    $lingoResults += [ordered]@{ cycle=$lingoCycle; version=$lingoExpectedVersion; windowVisible=$lingoVisible; deepseek=$true; speech=$true; shortcutTarget=$lingoTarget; startupSeconds=[Math]::Round(([DateTimeOffset]::UtcNow - $lingoStartedAt).TotalSeconds, 2) }
    if ($lingoCycle -lt $Cycles) {
        # Stop only the instance this verifier just launched at the verified shortcut path.
        $lingoProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'Lingo Studio.exe'" | Where-Object { $_.ExecutablePath -eq $lingoTarget })
        $lingoProcessIds = @($lingoProcesses.ProcessId)
        foreach ($lingoProcess in $lingoProcesses) {
            if ($lingoProcess.ParentProcessId -notin $lingoProcessIds) {
                $lingoRootProcess = Get-Process -Id $lingoProcess.ProcessId
                if ($lingoRootProcess.Path -ne $lingoTarget) { throw 'Refusing to stop a different application.' }
                Stop-Process -Id $lingoRootProcess.Id -Force
                $lingoRootProcess.WaitForExit(5000) | Out-Null
            }
        }
        Start-Sleep -Milliseconds 500
    }
}
$lingoResults | ConvertTo-Json | Tee-Object -FilePath (Join-Path $lingoProject '.cache\shortcut-startup-results.json')
