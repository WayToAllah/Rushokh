# scripts/cf-login.ps1
# بيشغّل تسجيل دخول Cloudflare، ولما الرابط يظهر بينسخه للحافظة (Clipboard)،
# عشان تقدر تفتحه من أي جهاز تاني (الموبايل مثلاً) وتوافق من هناك.
$ErrorActionPreference = "SilentlyContinue"
$out = Join-Path $env:TEMP "rasokh-cf-login.out"
$err = Join-Path $env:TEMP "rasokh-cf-login.err"
Remove-Item $out, $err

$p = Start-Process -FilePath "cloudflared" -ArgumentList @("tunnel", "login") `
  -RedirectStandardOutput $out -RedirectStandardError $err -NoNewWindow -PassThru

$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  foreach ($f in @($out, $err)) {
    if (Test-Path $f) {
      $text = Get-Content -Raw $f
      if ($text -match 'https://dash\.cloudflare\.com/argotunnel\S+') { $url = $Matches[0] }
    }
  }
}

if ($url) {
  Set-Clipboard -Value $url
  Write-Host ""
  Write-Host "Open this link on any device (your phone works), log in, click your domain, then Authorize:"
  Write-Host ""
  Write-Host $url
  Write-Host ""
  Write-Host "(The link is also copied to the clipboard.) Waiting for you to authorize..."
} else {
  Write-Host "Could not find the login link. Take a screenshot of this window and send it."
}

$p.WaitForExit()
exit $p.ExitCode
