# Veryfront CLI Installer for Windows
#
# Usage:
#   irm https://veryfront.com/install.ps1 | iex
#   irm https://veryfront.com/install.ps1 | iex -Version 0.0.75
#
# Options:
#   -Version VERSION   Install a specific version (default: latest)
#   -Dir DIR          Install to a custom directory (default: ~/.veryfront/bin)

param(
    [string]$Version = "latest",
    [string]$Dir = "$env:USERPROFILE\.veryfront\bin"
)

$ErrorActionPreference = "Stop"

$Repo = "veryfront/veryfront"

function Write-ColorOutput {
    param([string]$Color, [string]$Message)
    $prevColor = $Host.UI.RawUI.ForegroundColor
    $Host.UI.RawUI.ForegroundColor = $Color
    Write-Output $Message
    $Host.UI.RawUI.ForegroundColor = $prevColor
}

function Get-LatestVersion {
    $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing
    return $response.tag_name -replace '^v', ''
}

function Get-Platform {
    $arch = [System.Environment]::GetEnvironmentVariable("PROCESSOR_ARCHITECTURE")
    switch ($arch) {
        "AMD64" { return "windows-x64" }
        "ARM64" { return "windows-arm64" }
        default {
            throw "Unsupported architecture: $arch"
        }
    }
}

function Install-Veryfront {
    Write-ColorOutput "Cyan" "Veryfront CLI Installer"
    Write-Output ""

    # Detect platform
    $platform = Get-Platform
    Write-Output "  Platform: $platform"

    # Get version
    if ($Version -eq "latest") {
        Write-Output "  Fetching latest version..."
        $Version = Get-LatestVersion
        if (-not $Version) {
            throw "Failed to fetch latest version"
        }
    }
    Write-Output "  Version: $Version"

    # Build download URL
    $binaryName = "veryfront-$platform.exe"
    $downloadUrl = "https://github.com/$Repo/releases/download/v$Version/$binaryName"

    # Create install directory
    if (-not (Test-Path $Dir)) {
        New-Item -ItemType Directory -Path $Dir -Force | Out-Null
    }

    # Download binary
    $binaryPath = Join-Path $Dir "veryfront.exe"
    Write-Output ""
    Write-Output "  Downloading $downloadUrl..."

    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $binaryPath -UseBasicParsing
    }
    catch {
        throw "Failed to download binary: $_"
    }

    Write-Output ""
    Write-ColorOutput "Green" "Veryfront CLI installed successfully!"
    Write-Output ""
    Write-Output "  Binary: $binaryPath"
    Write-Output ""

    # Check if install dir is in PATH
    $userPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath -notlike "*$Dir*") {
        Write-ColorOutput "Yellow" "Add Veryfront to your PATH:"
        Write-Output ""
        Write-Output "  `$env:PATH = `"$Dir;`$env:PATH`""
        Write-Output ""
        Write-Output "  # Or permanently (requires restart):"
        Write-Output "  [System.Environment]::SetEnvironmentVariable('PATH', `"$Dir;`$env:PATH`", 'User')"
        Write-Output ""

        # Offer to add to PATH
        $addToPath = Read-Host "Add to PATH now? (y/N)"
        if ($addToPath -eq "y" -or $addToPath -eq "Y") {
            $newPath = "$Dir;$userPath"
            [System.Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
            $env:PATH = "$Dir;$env:PATH"
            Write-ColorOutput "Green" "Added to PATH. Restart your terminal for changes to take effect."
        }
    }
    else {
        Write-Output "Run 'veryfront --help' to get started."
    }
}

Install-Veryfront
