# pi-extensions

Pi extensions kept in one place so they can be installed from a single source.

```bash
pi install git:github.com/nonlog/pi-extensions
```

The root `package.json` declares every extension under `pi.extensions`, so one install brings all of them.

## Packages

| Package | What it does | Origin |
|---|---|---|
| [`packages/pi-polish`](./packages/pi-polish) | Claude Code-style output: tool rows fold into one line, edits render as colored diffs, `❯`/`●` markers, orange status line | Patched fork of [`pringled/pi-extensions`](https://github.com/pringled/pi-extensions/tree/main/packages/pi-polish) (MIT, Thomas van Dongen) |
| [`packages/pi-bar-cursor`](./packages/pi-bar-cursor) | Replaces Pi's reverse-video block caret with an accent-colored blinking hardware bar cursor | [`nonlog/pi-bar-cursor`](https://github.com/nonlog/pi-bar-cursor) (MIT, nonlog) |

### pi-polish patches

Four changes on top of upstream `0.1.2`, fixing conflicts with [`pi-open-tui`](https://github.com/OldSuns/pi-open-tui) and [`@robhowley/pi-spinner-verbs`](https://www.npmjs.com/package/@robhowley/pi-spinner-verbs). Details in [packages/pi-polish/README.md](./packages/pi-polish/README.md#local-patches).

1. `❯` marker renders inside pi-open-tui's framed editor (the frame's `│` rail broke the original match).
2. The status line renders the verb published by pi-spinner-verbs instead of overwriting it every second.
3. The thinking block is left intact, so pi-open-tui's thinking peek has a label row to rewrite.
4. `outputPad` stays at 2, which patch 1 requires.

### pi-bar-cursor is unmodified

It is copied here as-is. Note it overlaps with `pi-open-tui`, which also owns the caret:

- pi-open-tui writes DECSCUSR `\x1b[6 q` (steady bar) and manages the hardware cursor itself
- pi-bar-cursor writes `\x1b[5 q` (blinking bar) plus an `OSC 12` accent color

Both write the same cursor sequence, so the shape and color can flip depending on which wrote last. If you run pi-open-tui, either drop pi-bar-cursor or expect the two to fight over the caret.

## License

MIT. Each package keeps its own `LICENSE` file with its original copyright holder; the root [LICENSE](./LICENSE) covers the repository as a whole.
