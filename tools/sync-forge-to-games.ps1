# Model 1 forks only: requires the Forge upstream remote. Shared-source Model 2
# projects such as Ridgebound must use their own tools/forge.mjs commands instead.
param(
  [string]$ForgeDir = "C:\Users\emret\Desktop\Forge",
  [string]$GamesDir = "C:\Users\emret\Desktop\Games",
  [string[]]$Projects = @(),
  [switch]$DryRun,
  [switch]$SkipGamePush
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Git {
  param(
    [string]$WorkingDirectory,
    [string[]]$GitArgs,
    [switch]$Capture
  )

  Push-Location -LiteralPath $WorkingDirectory
  try {
    if ($Capture) {
      $output = & git @GitArgs 2>&1
      if ($LASTEXITCODE -ne 0) {
        throw "git $($GitArgs -join ' ') failed in $WorkingDirectory`n$output"
      }
      return $output
    }

    & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
      throw "git $($GitArgs -join ' ') failed in $WorkingDirectory"
    }
  }
  finally {
    Pop-Location
  }
}

function Assert-GitRepo {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath (Join-Path $Path ".git"))) {
    throw "Not a git repository: $Path"
  }
}

function Get-CurrentBranch {
  param([string]$Repo)
  $branch = Invoke-Git $Repo @("rev-parse", "--abbrev-ref", "HEAD") -Capture
  return ($branch | Select-Object -First 1).Trim()
}

function Get-DirtyStatus {
  param([string]$Repo)
  return @(Invoke-Git $Repo @("status", "--porcelain") -Capture)
}

function Get-RemoteUrl {
  param(
    [string]$Repo,
    [string]$Remote
  )

  $url = Invoke-Git $Repo @("remote", "get-url", $Remote) -Capture
  return ($url | Select-Object -First 1).Trim()
}

function Test-Ancestor {
  param(
    [string]$Repo,
    [string]$Ancestor,
    [string]$Descendant
  )

  Push-Location -LiteralPath $Repo
  try {
    & git merge-base --is-ancestor $Ancestor $Descendant
    return $LASTEXITCODE -eq 0
  }
  finally {
    Pop-Location
  }
}

function Sync-ForgeMain {
  param([string]$Repo)

  Write-Step "Checking Forge"
  Assert-GitRepo $Repo

  $branch = Get-CurrentBranch $Repo
  if ($branch -ne "main") {
    throw "Forge must be on main before syncing. Current branch: $branch"
  }

  $dirty = @(Get-DirtyStatus $Repo)
  if ($dirty.Count -gt 0) {
    throw "Forge has uncommitted changes. Commit or stash them first:`n$($dirty -join "`n")"
  }

  Invoke-Git $Repo @("fetch", "origin")

  $local = (Invoke-Git $Repo @("rev-parse", "main") -Capture | Select-Object -First 1).Trim()
  $remote = (Invoke-Git $Repo @("rev-parse", "origin/main") -Capture | Select-Object -First 1).Trim()

  if ($local -eq $remote) {
    Write-Host "Forge main is already in sync with origin/main: $local"
    return
  }

  $remoteIsAncestor = Test-Ancestor $Repo "origin/main" "main"
  $localIsAncestor = Test-Ancestor $Repo "main" "origin/main"

  if ($remoteIsAncestor -and -not $localIsAncestor) {
    if ($DryRun) {
      Write-Host "[dry-run] Would push Forge main to origin/main."
      return
    }

    Write-Host "Pushing Forge main to origin/main..."
    Invoke-Git $Repo @("push", "origin", "main")
    return
  }

  if ($localIsAncestor -and -not $remoteIsAncestor) {
    throw "Forge local main is behind origin/main. Pull/rebase Forge first, then rerun."
  }

  throw "Forge main and origin/main have diverged. Resolve Forge history first, then rerun."
}

function Get-GameRepos {
  param(
    [string]$Root,
    [string[]]$Names
  )

  if ($Names.Count -gt 0) {
    return $Names | ForEach-Object { Join-Path $Root $_ }
  }

  if (-not (Test-Path -LiteralPath $Root)) {
    throw "Games directory does not exist: $Root"
  }

  return Get-ChildItem -LiteralPath $Root -Directory | ForEach-Object { $_.FullName }
}

function Sync-GameRepo {
  param(
    [string]$Repo,
    [string]$ExpectedUpstreamUrl
  )

  if (-not (Test-Path -LiteralPath (Join-Path $Repo ".git"))) {
    Write-Host "Skipping non-git folder: $Repo" -ForegroundColor DarkYellow
    return
  }

  Write-Step "Syncing $Repo"

  $branch = Get-CurrentBranch $Repo
  if ($branch -ne "main") {
    throw "$Repo must be on main before syncing. Current branch: $branch"
  }

  $dirty = @(Get-DirtyStatus $Repo)
  if ($dirty.Count -gt 0) {
    throw "$Repo has uncommitted changes. Commit or stash them first:`n$($dirty -join "`n")"
  }

  $upstreamUrl = Get-RemoteUrl $Repo "upstream"
  if ($upstreamUrl -ne $ExpectedUpstreamUrl) {
    throw "$Repo upstream is '$upstreamUrl', expected '$ExpectedUpstreamUrl'"
  }

  Invoke-Git $Repo @("fetch", "origin")
  Invoke-Git $Repo @("fetch", "upstream")

  if ($DryRun) {
    Write-Host "[dry-run] Would merge upstream/main into $Repo."
    if (-not $SkipGamePush) {
      Write-Host "[dry-run] Would push $Repo main to origin/main."
    }
    return
  }

  Invoke-Git $Repo @("merge", "--no-edit", "upstream/main")

  if ($SkipGamePush) {
    Write-Host "Skipped game push by request."
    return
  }

  Invoke-Git $Repo @("push", "origin", "main")
}

Write-Host "Forge -> Games sync"
Write-Host "Forge: $ForgeDir"
Write-Host "Games: $GamesDir"
if ($Projects.Count -gt 0) {
  Write-Host "Projects: $($Projects -join ', ')"
}
if ($DryRun) {
  Write-Host "Mode: dry-run"
}

$expectedUpstreamUrl = Get-RemoteUrl $ForgeDir "origin"
Sync-ForgeMain $ForgeDir

$gameRepos = Get-GameRepos $GamesDir $Projects
foreach ($gameRepo in $gameRepos) {
  Sync-GameRepo $gameRepo $expectedUpstreamUrl
}

Write-Step "Done"
