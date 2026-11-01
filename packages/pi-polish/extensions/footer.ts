import { type ExtensionAPI, FooterComponent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const fg = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;

// Decoration comes from CaskaydiaCove NF (the terminal's primary face).
const FOLDER = "\uf07b"; // nf-fa-folder
const THINKING = "\u25c9"; // ◉
const FILLED = "\u2588"; // █
const EMPTY = "\u2591"; // ░

// Brand logos live in Herdr Agent Icons Max, reachable only through the terminal's fallback
// chain (CaskaydiaCove NF carries no U+E1A0..E1BB). See herdr config-gpui.local.toml [terminal].
type Brand = { prefix: string; icon: string; label: string; rgb: [number, number, number] };
const BRANDS: Brand[] = [
	{ prefix: "deepseek", icon: "\ue1ad", label: "DeepSeek", rgb: [79, 172, 254] },
	{ prefix: "claude", icon: "\ue1a0", label: "Claude", rgb: [217, 119, 87] },
	{ prefix: "gemini", icon: "\ue1ae", label: "Gemini", rgb: [138, 180, 255] },
	{ prefix: "gpt", icon: "\ue1af", label: "GPT", rgb: [116, 192, 163] },
	{ prefix: "grok", icon: "\ue1b1", label: "Grok", rgb: [214, 214, 214] },
	{ prefix: "glm", icon: "\ue1b7", label: "GLM", rgb: [150, 200, 120] },
	{ prefix: "muse", icon: "\ue1b9", label: "Muse", rgb: [226, 186, 96] },
];
const FALLBACK: Brand = { prefix: "", icon: "\uf2db", label: "", rgb: [150, 150, 150] }; // nf-fa-microchip

const patched = Symbol.for("pi-polish.footer");

/** Compact token counts, matching pi's own footer formatting. */
function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

/** deepseek-v4.1-flash → DeepSeek V4.1 Flash, claude-sonnet-5-5 → Claude Sonnet 5.5 */
function displayName(id: string): string {
	const brand = BRANDS.find((b) => id.toLowerCase().startsWith(b.prefix));
	const rest = (brand ? id.slice(brand.prefix.length) : id).replace(/^[-_]/, "");
	const words: string[] = [];
	for (const raw of rest.split(/[-_]/).filter(Boolean)) {
		const previous = words[words.length - 1] ?? "";
		// sonnet-5-5 → "5.5", not "5 5"
		if (/^\d+$/.test(raw) && /^\d+$/.test(previous)) words[words.length - 1] = `${previous}.${raw}`;
		else words.push(raw[0].toUpperCase() + raw.slice(1));
	}
	return [brand?.label, ...words].filter(Boolean).join(" ");
}

/** Left column truncated if needed, right column always kept whole. */
function twoColumns(left: string, right: string, width: number): string {
	const rightWidth = visibleWidth(right);
	const room = width - rightWidth - 1;
	const shown = visibleWidth(left) <= room ? left : room > 4 ? truncateToWidth(left, room, "...") : "";
	return shown + " ".repeat(Math.max(1, width - visibleWidth(shown) - rightWidth)) + right;
}

function build(footer: any, width: number): string[] {
	const state = footer.session.state;
	const manager = footer.session.sessionManager;
	const model = state.model;

	const home = process.env.HOME || process.env.USERPROFILE || "";
	const rawCwd = String(manager.getCwd());
	const cwd = home && rawCwd.toLowerCase().startsWith(home.toLowerCase()) ? `~${rawCwd.slice(home.length)}` : rawCwd;
	const branch = footer.footerData.getGitBranch();
	const sessionName = manager.getSessionName();

	let first = `${fg(217, 175, 87)}${FOLDER}${RESET} ${cwd}`;
	if (branch) first += `${DIM} (${branch})${RESET}`;
	if (sessionName) first += `${DIM} •${RESET} ${sessionName}`;

	const id = model?.id ?? "no-model";
	const brand = BRANDS.find((b) => id.toLowerCase().startsWith(b.prefix)) ?? FALLBACK;
	let left = `${fg(...brand.rgb)}${brand.icon}${RESET} ${displayName(id)}`;
	if (model?.reasoning) {
		const level = state.thinkingLevel || "off";
		left += ` ${fg(198, 120, 221)}${THINKING}${RESET} ${fg(198, 120, 221)}${level}${RESET}`;
	}

	const usage = footer.getSessionStats().contextUsage;
	const used = usage?.tokens ?? 0;
	const window = usage?.contextWindow ?? model?.contextWindow ?? 0;
	const percent = usage?.percent ?? null;
	const percentText = percent === null ? "?" : `${Math.round(percent)}%`;
	const barWidth = width >= 60 ? 16 : width >= 40 ? 8 : 0;
	const filledCount = percent === null || barWidth === 0 ? 0 : Math.round((percent / 100) * barWidth);
	const barColor = percent !== null && percent >= 85 ? [240, 110, 110] : percent !== null && percent >= 60 ? [230, 190, 90] : [140, 200, 120];
	const bar =
		barWidth === 0
			? ""
			: `${fg(...barColor)}${FILLED.repeat(filledCount)}${RESET}${DIM}${EMPTY.repeat(barWidth - filledCount)}${RESET} `;
	const right = `${bar}${formatTokens(used)}/${formatTokens(window)} (${percentText})`;

	const lines = [truncateToWidth(first, width, "..."), twoColumns(left, right, width)];

	// Extension statuses keep pi's own behaviour: one row, sorted by key.
	const statuses = footer.footerData.getExtensionStatuses?.();
	if (statuses && statuses.size > 0) {
		const row = Array.from(statuses.entries())
			.sort(([a], [b]) => String(a).localeCompare(String(b)))
			.map(([, text]) => String(text).replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
			.join(" ");
		lines.push(truncateToWidth(row, width, "..."));
	}
	return lines;
}

export default function (_pi: ExtensionAPI) {
	try {
		const proto: any = FooterComponent.prototype;
		if (typeof proto.render !== "function" || proto.render[patched]) return;
		const original = proto.render;
		const replacement: any = function (this: any, width: number) {
			try {
				return build(this, width);
			} catch {
				return original.call(this, width); // a broken footer must never blank the screen
			}
		};
		replacement[patched] = true;
		proto.render = replacement;
	} catch (err) {
		console.error(`[pi-polish] could not patch the footer: ${(err as Error).message}`);
	}
}
