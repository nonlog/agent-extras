# statuslines

The Claude Code and Droid CLI copies of the two-line status bar that [`pi-polish`](../pi-polish/extensions/footer.ts) draws in Pi. All three share one layout, colors and icon set:

```
 D:\Workspace\General |  DeepSeek V4.1 Flash ✦ max |  [██████▒▒▒▒▒▒▒▒▒▒] 148k/400k
 session title |  main [↕1/2] 
```

Line 1 is `cwd | model + thinking level | context bar`. Line 2 is `session title | branch [divergence from upstream] runtime icon`. The divergence bracket is `[↑n]` ahead, `[↓n]` behind, `[↕a/b]` diverged, and is absent when in sync. The runtime icon appears only inside a git repository.

These are standalone Node scripts (no dependencies), not Pi extensions, so they are not listed in the root `package.json`.

| Script | Host | Notes |
|---|---|---|
| [`claude-code/statusline.js`](./claude-code/statusline.js) | Claude Code | Reads the statusLine JSON payload from stdin |
| [`droid/statusline.js`](./droid/statusline.js) | Droid CLI | Looks up the model's context window in `~/.factory/settings.json` `customModels` |

## Install

Copy the script, then point the host at it.

Claude Code, `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "node /path/to/.claude/statusline.js" }
```

Droid, `~/.factory/settings.json`:

```json
"statusLine": { "type": "command", "command": "node /path/to/.factory/statusline.js", "maxRows": 2 }
```

## Font requirements

The terminal needs a Nerd Font plus the **Herdr Agent Icons Max** font (U+E1A0..U+E1BB) for the model brand logos. Without it the brand glyph is blank; everything else still renders.
