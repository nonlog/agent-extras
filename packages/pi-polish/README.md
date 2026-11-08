# pi-polish (patched fork)

Makes [Pi](https://pi.dev)'s output look like Claude Code's: tool calls fold into short summary lines, and edits show as colored diffs.

This is a **patched fork** of [`pi-polish`](https://github.com/pringled/pi-extensions/tree/main/packages/pi-polish) by Thomas van Dongen. Upstream is MIT licensed; this fork keeps that license and adds the patches described under [Local patches](#local-patches).

```bash
pi install git:github.com/nonlog/agent-extras
```

## Features

- Shell commands, file reads and searches in a row fold into one line that updates while they run (`Running 2 shell commands… · 5s`) and then sums them up (`Ran 3 shell commands, read 2 files`). `ctrl+o` shows the full output.
- Edits and new files show as diffs with syntax highlighting and the changed words marked, in colors that follow your Pi theme, dark or light.
- A dot on each tool row shows its status: orange while running, green when done, red if it failed.
- An orange status line shows what Pi is doing, how long it has been at it and how many tokens it has written.
- `❯` marks your messages and `●` marks Pi's replies.
- A short instruction to the model to change files with Pi's edit and write tools instead of shell commands like `sed -i`, so you see the changes as diffs.

## Local patches

Four changes on top of upstream `0.1.2`, each fixing a conflict with [`pi-open-tui`](https://github.com/OldSuns/pi-open-tui) or [`@robhowley/pi-spinner-verbs`](https://www.npmjs.com/package/@robhowley/pi-spinner-verbs).

### 1. `❯` marker inside a framed editor

`pi-open-tui` replaces the editor with `OpenTuiEditor extends CustomEditor`, which wraps every content line in a `│ … │` frame. Upstream `markFirstLine` required the line to start with two spaces, which a framed line never does, so the `❯` marker silently never appeared.

`LEADING_ESCAPES` now also accepts an optional leading rail (and its ANSI wrapping) before the two padding spaces.

### 2. Spinner verbs instead of a competing status line

`pi-spinner-verbs` writes its verb with `ctx.ui.setWorkingMessage(...)` on a 3 s timer; upstream pi-polish wrote its phase + elapsed + token line to the same slot on a 1 s timer, so the verb was overwritten within a second and effectively invisible.

pi-polish now registers itself as the working-line owner (`globalThis[Symbol.for("pi-spinner-verbs.verb.consumer")]`) and renders the verb pi-spinner-verbs publishes (`Symbol.for("pi-spinner-verbs.verb")`) inside its own line:

```
I know kung fu… (5s · ↓ 1.2k tokens)
```

When pi-spinner-verbs is absent, or publishes no verb yet, the phase text is used as before.

> pi-spinner-verbs needs a matching 3-line change (publish the verb, skip its own write when a consumer registered). That change lives in the installed package, not here.

### 3. Thinking block left intact

Upstream dropped the `thinking` content parts from the message before rendering, to avoid a `Thinking…` row plus spacers. `pi-open-tui`'s thinking peek works by rewriting that row's label, so removing it left the peek with nothing to display.

`updateContent` now passes the message through unchanged.

### 4. Editor padding kept at 2

`outputPad` is raised to 2 so reply text lines up behind the `●` marker. This is required by patch 1: the marker replaces exactly two padding columns, and a framed line with `paddingX = 0` has none.

Note this interacts with `pi-open-tui`'s hidden-thinking label width budget: Pi renders that label as `Text(label, outputPad, 0)`, and `Text` pads **both** sides, so the usable width is `width - 2*outputPad`. With `outputPad = 2` the budget must reserve 4 columns, not 2. See the corresponding change in pi-open-tui.

## Compatibility

pi-polish only changes how Pi's built-in tools are drawn; the tools themselves run exactly as before. The chat styling (the markers and the status line) reaches into Pi's internal UI, so a new Pi release can break that part of the look until pi-polish is updated. Your sessions are never affected. Tested with Pi 1.4.

## License

MIT — original work Copyright (c) Thomas van Dongen. See [LICENSE](./LICENSE).
