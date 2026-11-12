[CmdletBinding()]
param(
    [string]$InstallRoot,
    [switch]$SkipCodex,
    [switch]$SkipClaude,
    [switch]$SkipDroid,
    [switch]$SkipPi
)

$ErrorActionPreference = 'Stop'
$userHome = [Environment]::GetFolderPath('UserProfile')
if ([string]::IsNullOrWhiteSpace($userHome)) { throw 'Cannot resolve the Windows user profile.' }
if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    $InstallRoot = Join-Path $userHome '.agent-hooks\windows-notify'
}

function Backup-File([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Copy-Item -LiteralPath $Path -Destination "$Path.bak-windows-notify-$stamp" -Force
}

function Get-JsonHashtable([string]$Path, $Default) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $Default }
    return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable)
}

function Save-JsonHashtable([string]$Path, $Value) {
    $parent = Split-Path -Parent $Path
    $null = New-Item -ItemType Directory -Path $parent -Force
    $Value | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Test-HookCommand($Groups, [string]$Command) {
    foreach ($group in @($Groups)) {
        if ($null -eq $group -or -not $group.ContainsKey('hooks')) { continue }
        foreach ($handler in @($group.hooks)) {
            if ($null -eq $handler) { continue }
            if (($handler.ContainsKey('commandWindows') -and [string]$handler.commandWindows -eq $Command) -or
                ($handler.ContainsKey('command') -and [string]$handler.command -eq $Command)) { return $true }
        }
    }
    return $false
}

$null = New-Item -ItemType Directory -Path $InstallRoot -Force
foreach ($name in @('shared', 'adapters')) {
    $source = Join-Path $PSScriptRoot $name
    $dest = Join-Path $InstallRoot $name
    $null = New-Item -ItemType Directory -Path $dest -Force
    Copy-Item -Path (Join-Path $source '*') -Destination $dest -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'notify-config.json') -Destination (Join-Path $InstallRoot 'notify-config.json') -Force

if (-not $SkipCodex) {
    $hooksPath = Join-Path $userHome '.codex\hooks.json'
    $doc = Get-JsonHashtable -Path $hooksPath -Default ([ordered]@{ hooks = [ordered]@{} })
    if (-not $doc.ContainsKey('hooks') -or $null -eq $doc.hooks) { $doc.hooks = [ordered]@{} }
    $changed = $false

    if (-not $doc.hooks.ContainsKey('Stop')) { $doc.hooks.Stop = @() }
    $stopCommand = 'cmd.exe /d /c ' + (Join-Path $InstallRoot 'adapters\codex-stop.cmd')
    if (-not (Test-HookCommand -Groups $doc.hooks.Stop -Command $stopCommand)) {
        $doc.hooks.Stop = @($doc.hooks.Stop) + @([ordered]@{
            hooks = @([ordered]@{
                type = 'command'
                command = $stopCommand
                commandWindows = $stopCommand
                timeout = 15
            })
        })
        $changed = $true
    }

    # v0.2.1+: Codex has precise native TUI notifications for real user
    # questions and approval UI. Remove the old hook-based attention adapter,
    # which could notify for PermissionRequest events never shown to the user.
    $attentionCommand = 'cmd.exe /d /c ' + (Join-Path $InstallRoot 'adapters\codex-attention.cmd')
    foreach ($eventName in @('PreToolUse', 'PermissionRequest')) {
        if (-not $doc.hooks.ContainsKey($eventName)) { continue }
        $newGroups = @()
        foreach ($group in @($doc.hooks[$eventName])) {
            if ($null -eq $group -or -not $group.ContainsKey('hooks')) {
                $newGroups += $group
                continue
            }
            $newHandlers = @()
            foreach ($handler in @($group.hooks)) {
                $isAttention = $false
                if ($null -ne $handler) {
                    if ($handler.ContainsKey('command') -and [string]$handler.command -eq $attentionCommand) { $isAttention = $true }
                    if ($handler.ContainsKey('commandWindows') -and [string]$handler.commandWindows -eq $attentionCommand) { $isAttention = $true }
                }
                if (-not $isAttention) { $newHandlers += $handler }
            }
            $originalHandlerCount = @($group.hooks).Count
            if ($newHandlers.Count -gt 0) {
                if ($newHandlers.Count -ne $originalHandlerCount) { $changed = $true }
                $group.hooks = $newHandlers
                $newGroups += $group
            } elseif ($originalHandlerCount -gt 0) {
                $changed = $true
            }
        }
        if ($newGroups.Count -gt 0) {
            $doc.hooks[$eventName] = $newGroups
        } else {
            $doc.hooks.Remove($eventName)
        }
    }

    if ($changed) {
        Backup-File $hooksPath
        Save-JsonHashtable -Path $hooksPath -Value $doc
    }

    # Native TUI notifications fire only when Codex actually reaches a
    # user-facing approval or async-question prompt. Keep completion on the
    # custom Stop adapter so synthetic/background Stop events can be filtered.
    $codexConfigPath = Join-Path $userHome '.codex\config.toml'
    if (Test-Path -LiteralPath $codexConfigPath -PathType Leaf) {
        $configText = [IO.File]::ReadAllText($codexConfigPath)
        $newConfigText = $configText
        $sectionPattern = '(?ms)^\[tui\]\r?\n(?<body>.*?)(?=^\[|\z)'
        $sectionMatch = [regex]::Match($newConfigText, $sectionPattern)
        $managedLines = @(
            'notifications = ["approval-requested", "async-question"]'
            'notification_method = "osc9"'
            'notification_condition = "always"'
        )
        if ($sectionMatch.Success) {
            $body = [string]$sectionMatch.Groups['body'].Value
            $body = [regex]::Replace($body, '(?m)^notifications\s*=.*\r?\n?', '')
            $body = [regex]::Replace($body, '(?m)^notification_method\s*=.*\r?\n?', '')
            $body = [regex]::Replace($body, '(?m)^notification_condition\s*=.*\r?\n?', '')
            $replacement = "[tui]`r`n" + ($managedLines -join "`r`n") + "`r`n" + $body
            $newConfigText = $newConfigText.Substring(0, $sectionMatch.Index) + $replacement + $newConfigText.Substring($sectionMatch.Index + $sectionMatch.Length)
        } else {
            if (-not $newConfigText.EndsWith("`n")) { $newConfigText += "`r`n" }
            $newConfigText += "`r`n[tui]`r`n" + ($managedLines -join "`r`n") + "`r`n"
        }
        if ($newConfigText -ne $configText) {
            Backup-File $codexConfigPath
            [IO.File]::WriteAllText($codexConfigPath, $newConfigText, (New-Object Text.UTF8Encoding($false)))
        }
    }

    Remove-Item -LiteralPath (Join-Path $InstallRoot 'adapters\codex-attention.cmd') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $InstallRoot 'adapters\codex-attention.ps1') -Force -ErrorAction SilentlyContinue
}

if (-not $SkipClaude) {
    $settingsPath = Join-Path $userHome '.claude\settings.json'
    $doc = Get-JsonHashtable -Path $settingsPath -Default ([ordered]@{})
    if (-not $doc.ContainsKey('hooks') -or $null -eq $doc.hooks) { $doc.hooks = [ordered]@{} }
    if (-not $doc.hooks.ContainsKey('Stop')) { $doc.hooks.Stop = @() }

    # Claude Code 2.1.x supports exec-form command hooks. Use it on Windows so the
    # Stop JSON goes directly to PowerShell stdin instead of passing through a nested
    # cmd.exe shell, which can consume the JSON as interactive command input.
    $powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $scriptPath = Join-Path $InstallRoot 'adapters\claude-stop.ps1'
    $legacyCommand = 'cmd.exe /d /c ' + (Join-Path $InstallRoot 'adapters\claude-stop.cmd')
    $handler = [ordered]@{
        type = 'command'
        command = $powershellExe
        args = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $scriptPath)
        timeout = 15
    }

    $found = $false
    $changed = $false
    foreach ($group in @($doc.hooks.Stop)) {
        if ($null -eq $group -or -not $group.ContainsKey('hooks')) { continue }
        for ($i = 0; $i -lt @($group.hooks).Count; $i++) {
            $existing = @($group.hooks)[$i]
            if ($null -eq $existing -or -not $existing.ContainsKey('command')) { continue }
            $existingCommand = [string]$existing.command
            $existingArgs = if ($existing.ContainsKey('args')) { @($existing.args) } else { @() }
            $isLegacy = $existingCommand -eq $legacyCommand
            $argsMatch = ($existingArgs.Count -eq $handler.args.Count) -and (($existingArgs -join "`0") -eq (@($handler.args) -join "`0"))
            $isExec = ($existingCommand -eq $powershellExe) -and $argsMatch
            $isRelatedExec = ($existingCommand -eq $powershellExe) -and ($existingArgs -contains $scriptPath)
            if (-not ($isLegacy -or $isExec -or $isRelatedExec)) { continue }

            if (-not $isExec -or $existing.timeout -ne 15) {
                $group.hooks[$i] = $handler
                $changed = $true
            }
            $found = $true
        }
    }

    if (-not $found) {
        $doc.hooks.Stop = @($doc.hooks.Stop) + @([ordered]@{ hooks = @($handler) })
        $changed = $true
    }

    $attentionScriptPath = Join-Path $InstallRoot 'adapters\claude-attention.ps1'
    $attentionArgs = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $attentionScriptPath)
    $attentionSpecs = @(
        [ordered]@{ event = 'PreToolUse'; matcher = 'AskUserQuestion' },
        [ordered]@{ event = 'Notification'; matcher = 'permission_prompt' },
        [ordered]@{ event = 'Notification'; matcher = 'elicitation_dialog' },
        [ordered]@{ event = 'Notification'; matcher = 'agent_needs_input' }
    )

    foreach ($spec in $attentionSpecs) {
        $eventName = [string]$spec.event
        $matcher = [string]$spec.matcher
        if (-not $doc.hooks.ContainsKey($eventName)) { $doc.hooks[$eventName] = @() }

        $exists = $false
        foreach ($group in @($doc.hooks[$eventName])) {
            if ($null -eq $group -or [string]$group.matcher -ne $matcher -or -not $group.ContainsKey('hooks')) { continue }
            foreach ($existing in @($group.hooks)) {
                if ($null -eq $existing -or -not $existing.ContainsKey('command')) { continue }
                $existingArgs = if ($existing.ContainsKey('args')) { @($existing.args) } else { @() }
                $argsMatch = ($existingArgs.Count -eq $attentionArgs.Count) -and (($existingArgs -join "`0") -eq ($attentionArgs -join "`0"))
                if ([string]$existing.command -eq $powershellExe -and $argsMatch) {
                    $exists = $true
                    break
                }
            }
            if ($exists) { break }
        }

        if (-not $exists) {
            $doc.hooks[$eventName] = @($doc.hooks[$eventName]) + @([ordered]@{
                matcher = $matcher
                hooks = @([ordered]@{
                    type = 'command'
                    command = $powershellExe
                    args = $attentionArgs
                    timeout = 15
                })
            })
            $changed = $true
        }
    }

    if ($changed) {
        Backup-File $settingsPath
        Save-JsonHashtable -Path $settingsPath -Value $doc
    }
}

if (-not $SkipDroid) {
    $droidHooksPath = Join-Path $userHome '.factory\hooks.json'
    if (Test-Path -LiteralPath (Split-Path -Parent $droidHooksPath)) {
        $doc = Get-JsonHashtable -Path $droidHooksPath -Default ([ordered]@{})
        $changed = $false

        $droidStopCmd = 'powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $InstallRoot 'adapters\droid-stop.ps1') + '"'
        $droidAttnCmd = 'powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $InstallRoot 'adapters\droid-attention.ps1') + '"'

        if (-not $doc.ContainsKey('Stop')) { $doc.Stop = @() }
        if (-not (Test-HookCommand -Groups $doc.Stop -Command $droidStopCmd)) {
            $doc.Stop = @($doc.Stop) + @([ordered]@{
                hooks = @([ordered]@{ type = 'command'; command = $droidStopCmd; timeout = 15 })
            })
            $changed = $true
        }

        if (-not $doc.ContainsKey('Notification')) { $doc.Notification = @() }
        if (-not (Test-HookCommand -Groups $doc.Notification -Command $droidAttnCmd)) {
            $doc.Notification = @($doc.Notification) + @([ordered]@{
                hooks = @([ordered]@{ type = 'command'; command = $droidAttnCmd; timeout = 15 })
            })
            $changed = $true
        }

        if (-not $doc.ContainsKey('PreToolUse')) { $doc.PreToolUse = @() }
        $hasAskHook = $false
        foreach ($group in @($doc.PreToolUse)) {
            if ($null -ne $group -and [string]$group.matcher -eq 'AskUserQuestion' -and $group.ContainsKey('hooks')) {
                foreach ($h in @($group.hooks)) {
                    if ($null -ne $h -and [string]$h.command -eq $droidAttnCmd) { $hasAskHook = $true; break }
                }
            }
            if ($hasAskHook) { break }
        }
        if (-not $hasAskHook) {
            $doc.PreToolUse = @($doc.PreToolUse) + @([ordered]@{
                matcher = 'AskUserQuestion'
                hooks = @([ordered]@{ type = 'command'; command = $droidAttnCmd; timeout = 15 })
            })
            $changed = $true
        }

        if ($changed) {
            Backup-File $droidHooksPath
            Save-JsonHashtable -Path $droidHooksPath -Value $doc
        }
    }
}

if (-not $SkipPi) {
    $piExtensions = Join-Path $userHome '.pi\agent\extensions'
    $piTarget = Join-Path $piExtensions 'windows-notify.ts'
    $piSource = 'git:github.com/nonlog/agent-extras'
    $piCommand = Get-Command pi -ErrorAction SilentlyContinue
    if ($null -ne $piCommand) {
        if (Test-Path -LiteralPath $piTarget -PathType Leaf) {
            Backup-File $piTarget
            Remove-Item -LiteralPath $piTarget -Force
        }
        $piList = (& pi list 2>$null | Out-String)
        if ($piList -notmatch [regex]::Escape($piSource)) {
            & pi install $piSource
            if ($LASTEXITCODE -ne 0) { throw "Pi package install failed: $piSource" }
        }
    } else {
        $null = New-Item -ItemType Directory -Path $piExtensions -Force
        Backup-File $piTarget
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'adapters\pi-windows-notify.ts') -Destination $piTarget -Force
    }
}

Write-Host "Installed shared notifier to: $InstallRoot"
if (-not $SkipCodex) { Write-Host 'Codex: completion uses the Stop hook; questions and approvals use native TUI OSC9 notifications.' }
if (-not $SkipClaude) { Write-Host 'Claude Code: completion and attention hooks merged into ~/.claude/settings.json.' }
if (-not $SkipDroid) {
    $droidHooksPath = Join-Path $userHome '.factory\hooks.json'
    if (Test-Path -LiteralPath (Split-Path -Parent $droidHooksPath)) {
        $doc = Get-JsonHashtable -Path $droidHooksPath -Default ([ordered]@{})
        $changed = $false

        $droidStopCmd = 'powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $InstallRoot 'adapters\droid-stop.ps1') + '"'
        $droidAttnCmd = 'powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $InstallRoot 'adapters\droid-attention.ps1') + '"'

        if (-not $doc.ContainsKey('Stop')) { $doc.Stop = @() }
        if (-not (Test-HookCommand -Groups $doc.Stop -Command $droidStopCmd)) {
            $doc.Stop = @($doc.Stop) + @([ordered]@{
                hooks = @([ordered]@{ type = 'command'; command = $droidStopCmd; timeout = 15 })
            })
            $changed = $true
        }

        if (-not $doc.ContainsKey('Notification')) { $doc.Notification = @() }
        if (-not (Test-HookCommand -Groups $doc.Notification -Command $droidAttnCmd)) {
            $doc.Notification = @($doc.Notification) + @([ordered]@{
                hooks = @([ordered]@{ type = 'command'; command = $droidAttnCmd; timeout = 15 })
            })
            $changed = $true
        }

        if (-not $doc.ContainsKey('PreToolUse')) { $doc.PreToolUse = @() }
        $hasAskHook = $false
        foreach ($group in @($doc.PreToolUse)) {
            if ($null -ne $group -and [string]$group.matcher -eq 'AskUserQuestion' -and $group.ContainsKey('hooks')) {
                foreach ($h in @($group.hooks)) {
                    if ($null -ne $h -and [string]$h.command -eq $droidAttnCmd) { $hasAskHook = $true; break }
                }
            }
            if ($hasAskHook) { break }
        }
        if (-not $hasAskHook) {
            $doc.PreToolUse = @($doc.PreToolUse) + @([ordered]@{
                matcher = 'AskUserQuestion'
                hooks = @([ordered]@{ type = 'command'; command = $droidAttnCmd; timeout = 15 })
            })
            $changed = $true
        }

        if ($changed) {
            Backup-File $droidHooksPath
            Save-JsonHashtable -Path $droidHooksPath -Value $doc
        }
    }
}

if (-not $SkipPi) { Write-Host 'Pi: Git package installed from nonlog/agent-extras (local-copy fallback only when pi is unavailable).' }
if (-not $SkipDroid) { Write-Host 'Factory Droid: completion and attention hooks merged into ~/.factory/hooks.json.' }
