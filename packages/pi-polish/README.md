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
- The startup header draws Claude Code's crab mascot instead of Pi's block logo.
- Tools without a custom UI, including MCP tools such as `ctx_execute`, use a compact call line and result summary instead of Pi's large background boxes. `ctrl+o` reveals the result preview. Specialized interactive renderers are preserved.
- Errors stay visible even when tools are collapsed.
- Tools start collapsed on session startup and reload.
- `codemode` also starts compact even though it has its own renderer; expanding restores its code and inner-tool details.
- Pasted image paths appear as `[image1]`, `[image2]`, etc., in the editor and user transcript; submission keeps the original paths.
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

## Compact thinking

Use `/polish-thinking` to choose how collapsed thinking is displayed, or select a mode directly. Previews show actual reasoning text rather than repeating a static `Thinking...` label; the separate working line still uses the active spinner verb.

| Command | Collapsed thinking display |
|---|---|
| `/polish-thinking single` | Latest non-empty line, clipped to the terminal width (default) |
| `/polish-thinking multi` | Latest 3 non-empty lines, each clipped to the terminal width |
| `/polish-thinking off` | Hide the entire thinking area, including when Pi's native thinking view is expanded |

Changes redraw existing messages immediately and are saved in `pi-polish.json` in Pi's agent directory (normally `~/.pi/agent/pi-polish.json`):

```json
{
  "thinking": "single"
}
```

In `single` and `multi` modes, Pi's native thinking state still controls preview versus full text: click the preview or use the thinking toggle (`alt+t` by default) to expand. Keep this in Pi's `settings.json` to start with previews:

```json
{
  "hideThinkingBlock": true
}
```

In `off` mode, choose `single` or `multi` again to restore thinking display. Reasoning remains in the session in all modes; pi-polish never removes it. The plugin does not silently rewrite Pi's settings. Malformed plugin configuration is not overwritten when saving a selection.

## Image paste markers

Clipboard image paths are displayed as `[image1]`, `[image2]`, etc. The editor uses Pi's existing paste registry, so normal submission, expanded text, external editing, history drafts, deletion and undo preserve the attachment path. Existing supported image files (PNG, JPEG, GIF, WebP and BMP) are compacted; missing files remain ordinary editor text. URLs are not converted.

The user-transcript transformation is display-only. Original paths remain in session/model input and Pi still performs the normal attachment loading. This does not create another image copy or change tool-result images.

## Startup ordering

Pi draws its native UI before running `session_start` handlers, and awaits those handlers in extension order. To avoid seeing its default banner while slower extensions initialize, put `git:github.com/nonlog/agent-extras` first in your `packages` list and set `"quietStartup": true`. The custom crab header still appears when pi-polish's handler runs. The bundled pi-bar-cursor now applies its bar shape on the first focused editor frame, without waiting for `session_start`; it writes no terminal escapes merely by being loaded in RPC/print mode.

This changes the early appearance, not the time other extensions need to initialize. If you use `PI_POLISH_LOGO=pi`, restore `"quietStartup": "header"` to show the native banner.

## Crab logo header

```text
 █▜███▜▌  Pi v1.5.2
▀██████▛▘ esc interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash
 ▘▘   ▘▘
```

Pi's built-in header is a component inside Pi, so the logo cannot be swapped on its own: the whole header is replaced (`ctx.ui.setHeader`). Two things exist only in the built-in header and are lost with it: `ctrl+o` expanding it to the full key list, and the click easter egg that animates the logo.

`PI_POLISH_LOGO=pi` keeps Pi's own header unchanged.

## Validation

With Pi installed and the repository's dependencies available, run:

```bash
node --test packages/pi-polish/tests/rendering.test.mjs
```

The tests exercise the installed Pi SDK: MCP and codemode rendering, custom-renderer preservation, error visibility, thinking modes and persistence, streaming and native expansion, image marker submission/deletion/undo/history, message markers, collapsed startup, and narrow-terminal logo rendering.

## Compatibility

pi-polish changes how tools and chat are drawn, not how tools execute. Generic MCP/extension tools get compact rendering; codemode also gets a compact default view, while other tools with their own renderers keep their custom UI. The chat styling (the markers and the status line) reaches into Pi's internal UI, so a new Pi release can break that part of the look until pi-polish is updated. Your sessions are never affected. Rendering regression tests run against Pi 1.5.2.

## License

MIT — original work Copyright (c) Thomas van Dongen. See [LICENSE](./LICENSE).
