# pi-extensions

Pi extensions kept in one place so they can be installed from a single source.

```bash
pi install git:github.com/nonlog/pi-extensions
```

The root `package.json` declares every extension under `pi.extensions`, so one install brings all of them.

## Packages

| Package | What it does | Origin |
|---|---|---|
| [`packages/pi-polish`](./packages/pi-polish) | Claude Code-style output: tool rows fold into one line, edits render as colored diffs, `❯`/`●` markers, orange status line, custom two-line footer with model brand icons | Patched fork of [`pringled/pi-extensions`](https://github.com/pringled/pi-extensions/tree/main/packages/pi-polish) (MIT, Thomas van Dongen) |
| [`packages/pi-bar-cursor`](./packages/pi-bar-cursor) | Replaces Pi's reverse-video block caret with an accent-colored blinking hardware bar cursor | [`nonlog/pi-bar-cursor`](https://github.com/nonlog/pi-bar-cursor) (MIT, nonlog) |

### pi-polish patches

Four changes on top of upstream `0.1.2`, fixing conflicts with [`pi-open-tui`](https://github.com/OldSuns/pi-open-tui) and [`@robhowley/pi-spinner-verbs`](https://www.npmjs.com/package/@robhowley/pi-spinner-verbs). Details in [packages/pi-polish/README.md](./packages/pi-polish/README.md#local-patches).

1. `❯` marker renders inside pi-open-tui's framed editor (the frame's `│` rail broke the original match).
2. The status line renders the verb published by pi-spinner-verbs instead of overwriting it every second.
3. The thinking block is left intact, so pi-open-tui's thinking peek has a label row to rewrite.
4. `outputPad` stays at 2, which patch 1 requires.

### Custom footer

`extensions/footer.ts` replaces `FooterComponent.render` with a clean two-line layout:

```
 D:\Workspace\General |  Gemini 3.8 Flash  high |  [███████▓▒░░░] 254k/400k (64%)
 检查 pi 插件冲突：verb、polish、cursor 等 |  main
```

- Line 1: `cwd | model | progress`
  - Folder icon and cwd path share the same warm-gold color.
  - Brand logo and model display name in matching brand color, followed by a sparkle glyph `` and thinking level in a per-level color.
  - Context progress bar in brackets `[███▓▒░░░]` with shade ramp, database icon, and token usage count.
- Line 2: `session title | git info`
  - Refined outline comment icon `` followed by the session title.
  - Git branch behind branch icon ``.
- Extension statuses are no longer drawn: `ctx.ui.setStatus()` output is dropped, so the footer is always exactly two lines.

Model brand logos are drawn from **Herdr Agent Icons Max** (`U+E1A0`–`U+E1BB`). That font carries those codepoints and nothing else, so the terminal must list it as a fallback or every icon renders as tofu:

```toml
[terminal]
family = "CaskaydiaCove Nerd Font"
fallback = ["Herdr Agent Icons Max", "Symbols Nerd Font Mono"]
```

Brands with an icon: deepseek, claude, gemini, gpt, grok, glm, muse. Anything else falls back to a generic chip glyph from CaskaydiaCove NF.

### pi-bar-cursor patches

One local fix on top of upstream `0.1.1`: the caret no longer dies after `/reload`.

`handleReloadCommand` emits `session_start` and only then calls `applyRuntimeSettings()`, which runs `ui.setShowHardwareCursor(settings.showHardwareCursor)`. With `showHardwareCursor: false` in settings, that write landed *after* the extension had turned the cursor on, and `ensureHardwareCursorVisible` memoised per `(tui, generation)` so it never retried — the caret stayed hidden until pi was fully restarted. The guard now reads the live TUI state instead of the memo, so the next render re-asserts it.

It also overlaps with `pi-open-tui`, which owns the caret too:

- pi-open-tui writes DECSCUSR `\x1b[6 q` (steady bar) and manages the hardware cursor itself
- pi-bar-cursor writes `\x1b[5 q` (blinking bar) plus an `OSC 12` accent color

Both write the same cursor sequence, so the shape and color can flip depending on which wrote last. If you run pi-open-tui, either drop pi-bar-cursor or expect the two to fight over the caret.

## License

MIT. Each package keeps its own `LICENSE` file with its original copyright holder; the root [LICENSE](./LICENSE) covers the repository as a whole.
