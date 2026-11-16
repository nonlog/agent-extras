import { keyHint, keyText, rawKeyHint, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { foregroundAnsi, rgbColor, truncateToWidth } from "@earendil-works/pi-tui";

// Claude Code's mascot, sampled from the 17x5 pixel grid it draws: block body, one-pixel eye
// gaps, side arms and four legs. Each character holds a 2x2 block of that grid.
const CRAB = [" █▜███▜▌ ", "▀██████▛▘", " ▘▘   ▘▘ "];
const CORAL = rgbColor(217, 119, 87);
const RESET = "\x1b[0m";

export default function (pi: ExtensionAPI) {
	// Pi's own header is expandable (ctrl+o shows the full key list) and its logo is clickable;
	// PI_POLISH_LOGO=pi keeps it, because a custom header replaces both.
	if (process.env.PI_POLISH_LOGO === "pi") return;

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader((_tui, theme) => {
			const hints = () => [
				keyHint("app.interrupt", "interrupt"),
				rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
				rawKeyHint("/", "commands"),
				rawKeyHint("!", "bash"),
			].join(theme.fg("muted", " · "));
			// The custom header has no expandable help or clickable logo.
			return {
				invalidate() {},
				render(width: number) {
					const crab = CRAB.map((line) => `${foregroundAnsi(CORAL, theme.getColorMode())}${line}${RESET}`);
					const version = `${theme.fg("text", "Pi")} ${theme.fg("dim", `v${VERSION}`)}`;
					return [`${crab[0]} ${version}`, `${crab[1]} ${hints()}`, crab[2]]
						.map((line) => truncateToWidth(` ${line}`, width));
				},
			};
		});
	});
}
