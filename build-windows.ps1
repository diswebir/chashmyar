<#
.SYNOPSIS
    ساخت نصب‌کننده و نسخهٔ پرتابل چشم‌یار روی ویندوز x64.
.DESCRIPTION
    پیش‌نیازها: Node.js 24 LTS، Rust stable با MSVC، ابزار C++ ویژوال استودیو و WebView2.
    خروجی‌ها: release\windows و مجموعهٔ آمادهٔ انتشار در release\staging.
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\build-windows.ps1
#>
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot
try {
    Write-Host "=== ChashmYar :: Windows x64 build ===" -ForegroundColor Cyan
    foreach ($command in @("node", "npm", "cargo", "rustup")) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "$command پیدا نشد. پیش‌نیازها را در docs\DEVELOPMENT.md ببینید."
        }
    }

    Write-Host "[1/6] بررسی هماهنگی نسخه..." -ForegroundColor Yellow
    node scripts/version.mjs check
    if ($LASTEXITCODE -ne 0) { throw "version check failed" }

    Write-Host "[2/6] نصب وابستگی‌های قفل‌شده..." -ForegroundColor Yellow
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

    Write-Host "[3/6] بررسی هدف Rust ویندوز..." -ForegroundColor Yellow
    rustup target add x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw "rustup target add failed" }

    Write-Host "[4/6] ساخت برنامه و نصب‌کننده..." -ForegroundColor Yellow
    npm run build:win
    if ($LASTEXITCODE -ne 0) { throw "Windows build failed" }

    Write-Host "[5/6] بررسی فایل‌ها و مجوز وابستگی‌ها..." -ForegroundColor Yellow
    npm run verify:exe
    if ($LASTEXITCODE -ne 0) { throw "EXE verification failed" }
    npm run licenses:generate
    if ($LASTEXITCODE -ne 0) { throw "notice generation failed" }

    Write-Host "[6/6] آماده‌سازی فایل‌های انتشار و هش‌ها..." -ForegroundColor Yellow
    npm run release:stage
    if ($LASTEXITCODE -ne 0) { throw "release staging failed" }
    Write-Host "آماده است: release\windows و release\staging" -ForegroundColor Green
    Write-Host "پیش از انتشار، آزمون‌ها و چک‌لیست docs\RELEASE_GUIDE_FA.md را انجام دهید." -ForegroundColor Cyan
} catch {
    Write-Error $_
    exit 1
} finally {
    Pop-Location
}
