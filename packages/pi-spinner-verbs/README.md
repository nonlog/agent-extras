# Spinner Verbs (patched fork)

> "Thinking..." is the most boring thing a genius could say.

A [pi](https://pi.dev) extension that customizes the spinner text while the LLM is working. Replace the default spinner verbs with something that has a little more personality.

This is a fork of [`@robhowley/pi-spinner-verbs`](https://github.com/robhowley/pi-userland/tree/main/packages/pi-spinner-verbs) maintained in [`nonlog/agent-extras`](https://github.com/nonlog/agent-extras). It drops the fixed-interval rotation and picks a new verb per model turn, matching how Claude Code behaves. See [Patches](#patches).

**Before**: "Thinking...", "Processing...", "Working..." 🥱

**After**: "Paying the iron price...", "With fire and blood..." ⚔️🐉

## Installation

Install the patched fork from the repository instead of npm:

```shell
pi install git:github.com/nonlog/agent-extras
```

That installs every package in this monorepo. To get only this one:

```shell
pi install git:github.com/nonlog/agent-extras#packages/pi-spinner-verbs
```

The extension uses Claude Code's default verb list. A configured theme or custom file is appended to that list, with duplicate verbs removed.

## Patches

- **Event-driven verb rotation.** Upstream replaced the working line every 3 seconds via `setInterval`, so the verb changed on a clock regardless of what the agent was doing. This fork picks a new verb on `turn_start` and holds it for the whole turn, which is how Claude Code behaves: a long single thought keeps one word, and the word changes when the work moves on. There is no timer at all.
- **Claude Code defaults plus your theme.** The base list contains 185 verbs identified in the locally installed Claude Code 2.1.325 Windows binary, from `Accomplishing` through `Zigzagging`. This is a bundled snapshot, not a live dependency on Claude Code. The selected theme or custom list is appended and deduplicated. With `"spinnerVerbs": "breaking-bad"`, the pool contains **258 verbs**: 185 defaults + 73 Breaking Bad entries. Each turn picks randomly from the combined pool; append order does not make it play sequentially.
- **`/verbs (default)` and `/verb-status`** use the active combined list. `(default)` selects the Claude Code base without a theme; `/verb-status` reports the combined source and deduplicated count.

### Switching Themes with `/verbs`

Change your verb list at any time during a session:

```
/verbs game-of-thrones
/verbs doc-emrick
/verbs random
/verbs (default)
```

Run `/verbs` with no argument to get an interactive picker. Use `random` to choose a theme to append, or `(default)` to use only the Claude Code defaults.

### Checking Status with `/verb-status`

Check the current session spinner settings at any time:

```
/verb-status
```

### Auto-configure via `settings.json`

Set your preferred theme once and forget about it. Pi checks both project-local (`.pi/settings.json`) and global (`~/.pi/agent/settings.json`) settings on session start.

**Randomly pick an additional theme each session (optional):**

```json
{
  "spinnerVerbs": "random"
}
```

**Use Claude Code defaults plus Breaking Bad:**

```json
{
  "spinnerVerbs": "breaking-bad"
}
```

**Point to your own custom verbs file:**

```json
{
  "spinnerVerbsFile": "~/my-verbs.json"
}
```

The path supports three forms and is resolved relative to the `settings.json` file that contains it — not relative to your working directory:

| Form | Example | Resolved as |
|------|---------|-------------|
| `~/...` | `~/my-verbs.json` | Expanded from your home directory |
| `/absolute/...` | `/etc/my-verbs.json` | Used as-is |
| `relative/...` | `../my-verbs.json` | Relative to the `settings.json` file's directory |

So if your `.pi/settings.json` contains `"spinnerVerbsFile": "../my-verbs.json"`, it resolves to `my-verbs.json` in the project root — not wherever you launched pi from.

Your custom file can be a plain JSON array:

```json
["Brewing coffee...", "Asking the oracle...", "Consulting the void..."]
```

**Priority order**: `--verbs` CLI flag → project `.pi/settings.json` → global `~/.pi/agent/settings.json`

---

## Available Themes

| Theme | Sample                                                        |
|-------|---------------------------------------------------------------|
| `claude-code` | Accomplishing..., Cogitating..., Flibbertigibbeting... |
| `breaking-bad` | Knocking..., Becoming Heisenberg..., Treading lightly... |
| `game-of-thrones` | Taking the black..., Winter is coming..., By your leave...    |
| `lord-of-the-rings` | One does not simply..., You shall not pass... So it begins... |
| `action-movie` | Yippee-ki-yay..., I'll be back..., I know kung fu...          |
| `fast-furious` | Ejecto seato, cuz..., Living a quarter mile at a time..., Granny shifting... |
| `talladega-nights` | Shaking and baking..., I wanna go fast..., Pissing excellence... |
| `game-show` | Come on down..., Survey says..., Is that your final answer... |
| `harry-potter` | Accio..., Expecto Patronum..., Wingardium Leviosa...      |
| `corporate-jargon` | Double clicking..., Pressure testing..., Closing the loop... |
| `doc-emrick` | Shunting..., Sliding..., Fiddling...                          |
| `momentum` | Making moves..., Spinning up..., Getting traction...          |
| `weird-git` | Rerereing..., Deltifying..., Cruft-packing...                |
| `weird-legalese` | Mutatis mutandis..., Res ipsa loquitur..., Ultra vires...     |

Use `"spinnerVerbs": "random"` to have a theme randomly selected from the list above at each session start.

---

## Validation

From the repository root, with Pi installed:

```shell
node --test packages/pi-spinner-verbs/tests/verbs.test.mjs
```

Checks cover the base list, Breaking Bad composition, per-turn selection, deduplication, invalid custom-file fallback, and cooperation with pi-polish.

## License

MIT. Upstream copyright (c) 2026 Rob Howley; see [LICENSE](./LICENSE). Patched fork maintained by nonlog.
