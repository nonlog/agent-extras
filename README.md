# agent-extras

Extensions and scripts for coding agents, kept in one place: Pi extensions (installable from a single source) and standalone status bar scripts for Claude Code and Droid CLI.

```bash
pi install git:github.com/nonlog/agent-extras
```

The root `package.json` declares every Pi extension under `pi.extensions`, so one install brings all of them. The scripts under `packages/statuslines` are not Pi extensions and are copied by hand.

## Packages

| Package | What it does | Origin |
|---|---|---|
| [`packages/pi-polish`](./packages/pi-polish) | Claude Code-style output: tool rows fold into one line, edits render as colored diffs, `❯`/`●` markers, orange status line, custom two-line footer with model brand icons | Patched fork of [`pringled/pi-extensions`](https://github.com/pringled/pi-extensions/tree/main/packages/pi-polish) (MIT, Thomas van Dongen) |
| [`packages/pi-spinner-verbs`](./packages/pi-spinner-verbs) | Themed spinner verbs (13 packs) with `/verbs` and `/verb-status`; verbs rotate per model turn instead of on a 3-second timer | Patched fork of [`@robhowley/pi-spinner-verbs`](https://github.com/robhowley/pi-userland/tree/main/packages/pi-spinner-verbs) (MIT, Rob Howley) |
| [`packages/pi-bar-cursor`](./packages/pi-bar-cursor) | Replaces Pi's reverse-video block caret with an accent-colored blinking hardware bar cursor | [`nonlog/pi-bar-cursor`](https://github.com/nonlog/pi-bar-cursor) (MIT, nonlog) |
| [`packages/pi-model-prompts`](./packages/pi-model-prompts) | Selects a local private instruction section by exact provider/model ID while retaining Pi's runtime instructions | nonlog |
| [`packages/statuslines`](./packages/statuslines) | The same two-line status bar for Claude Code and Droid CLI, as standalone Node scripts (the Pi version lives in pi-polish) | nonlog |
| [`fonts/HerdrAgentIconsMax-Regular.ttf`](./fonts/HerdrAgentIconsMax-Regular.ttf) | Private-use icon font (`U+E1A0`–`U+E1BB`) carrying the model and agent brand logos used by the status bars | [`hhdebb/herdr-radar`](https://github.com/qintmb/herdr-icon-agent-ui) ([notices](./fonts/THIRD_PARTY_NOTICES.md)) |

### pi-polish patches

Four changes on top of upstream `0.1.2`, fixing conflicts with [`pi-open-tui`](https://github.com/OldSuns/pi-open-tui) and [`@robhowley/pi-spinner-verbs`](https://www.npmjs.com/package/@robhowley/pi-spinner-verbs). Details in [packages/pi-polish/README.md](./packages/pi-polish/README.md#local-patches).

1. `❯` marker renders inside pi-open-tui's framed editor (the frame's `│` rail broke the original match).
2. The status line renders the verb published by pi-spinner-verbs instead of overwriting it every second.
3. The thinking block is left intact, so pi-open-tui's thinking peek has a label row to rewrite.
4. `outputPad` stays at 2, which patch 1 requires.

### Custom footer

`extensions/footer.ts` replaces `FooterComponent.render` with a two-line layout matching Droid CLI statusline:

```
 D:\Workspace\General |  DeepSeek V4.1 Flash  high |  [████████████▒▒▒▒] 300k/400k
󰭹 Verify Droid skills and MCP setup |  main [↕1/2]
```

- Line 1: `[cwd] | [model + thinking] | [context bar + tokens]`
  - Folder icon `` and full cwd path in warm gold `#d7af00`.
  - Brand logo and model name in official brand color, followed by `` and thinking level in Tailwind-styled effort color (supports `dynamic`).
  - Storage icon ``, 16-cell context bar `[████▒▒▒▒]` with smooth LERP color interpolation (green → amber → danger red), and token usage `used/limit`.
- Line 2: `[session title] | [git branch] [upstream divergence] [runtime]`
  - Session title icon ``, pi's own brand glyph (Herdr Agent Icons Max `U+E1A9`, glyph name `pi`) and the title itself share one color: pi.dev's accent blue `#6a9fcc` (`--color-accent-blue` / `--accent` in [pi.dev/style.css](https://pi.dev/style.css)), the same blue the site uses for links and the "yours" highlight.
  - Git branch icon `` with branch name in vibrant light green `#afff5f`.
  - **Upstream divergence** in dim brackets, nothing when the branch is level with its upstream: `[↑n]` ahead, `[↓n]` behind, `[↕a/b]` diverged. Parsed from the `## branch...upstream [ahead N, behind M]` line of `git status --porcelain=v1 --branch`; the file-level counts pi-open-tui also shows were dropped on request.
  - **Runtime** devicon only, and only inside a git repository — outside one the separator would hang off the session title with just an icon after it. From the detection table ported from pi-open-tui's `runtime.ts`: bun, node, rust, go, python, ruby, java, swift, kotlin, cpp, deno, php, haskell, julia, lua, elixir, erlang, gleam, crystal, dart, nim, zig, ocaml, clojure, scala, perl, elm, haxe, terraform, helm, gradle, cmake, meson, nix, conda, pixi, pulumi, typst, buf, dotnet. First match wins, so a `bun.lock` beats the `package.json` beside it. Detection is pure `existsSync`, so it needs no process and no background refresh.
- The git divergence spawns a process, so it does not run inside `render`: the cached value is drawn and a background refresh starts when it goes stale (5 s). pi re-renders on keystrokes and streamed output, so the value is fresh while working; while idle it can sit one refresh behind, and the first frame after a cwd change shows the branch and title only.
- `export default` installs the latest replacement on every load instead of guarding on a one-shot marker: `/reload` re-imports this module, so a one-shot guard would bail out and leave the previous closure installed, which is why edits used to need a full restart.
- Separators ` | ` in low-contrast neutral gray `#5f5f5f`.
- All text styles prefixed with `\x1b[22;1;` (cancels dim, enables bold highlight).
- Extension statuses are no longer drawn: `ctx.ui.setStatus()` output is dropped, so the footer is always exactly two lines.

Model brand logos are drawn from [**Herdr Agent Icons Max**](./fonts/HerdrAgentIconsMax-Regular.ttf) (`U+E1A0`–`U+E1BB`). Install `fonts/HerdrAgentIconsMax-Regular.ttf` and list `Herdr Agent Icons Max` as a terminal fallback — that font carries those codepoints and nothing else, so without it every icon renders as tofu:

```toml
[terminal]
family = "CaskaydiaCove Nerd Font"
fallback = ["Herdr Agent Icons Max", "Symbols Nerd Font Mono"]
```

Brands with an icon: deepseek, claude, gemini, gpt, grok, glm, muse. Anything else falls back to a generic chip glyph from CaskaydiaCove NF.

### pi-spinner-verbs patches

One change on top of upstream `3.7.0`: verbs no longer rotate on a clock.

Upstream ran `setInterval(tick, 3000)`, so the word changed every 3 seconds regardless of what the agent was doing. This fork picks a verb on `turn_start` and holds it for the whole turn — the same way Claude Code behaves, where a long single thought keeps one word and the word changes when the work moves on. There is no timer at all; `/verbs (default)` and `/verb-status` now track the active verb list instead of the interval handle.

### pi-bar-cursor patches

One local fix on top of upstream `0.1.1`: the caret no longer dies after `/reload`.

`handleReloadCommand` emits `session_start` and only then calls `applyRuntimeSettings()`, which runs `ui.setShowHardwareCursor(settings.showHardwareCursor)`. With `showHardwareCursor: false` in settings, that write landed *after* the extension had turned the cursor on, and `ensureHardwareCursorVisible` memoised per `(tui, generation)` so it never retried — the caret stayed hidden until pi was fully restarted. The guard now reads the live TUI state instead of the memo, so the next render re-asserts it.

It also overlaps with `pi-open-tui`, which owns the caret too:

- pi-open-tui writes DECSCUSR `\x1b[6 q` (steady bar) and manages the hardware cursor itself
- pi-bar-cursor writes `\x1b[5 q` (blinking bar) plus an `OSC 12` accent color

Both write the same cursor sequence, so the shape and color can flip depending on which wrote last. If you run pi-open-tui, either drop pi-bar-cursor or expect the two to fight over the caret.

## License

MIT. Each package keeps its own `LICENSE` file with its original copyright holder; the root [LICENSE](./LICENSE) covers the repository as a whole.
