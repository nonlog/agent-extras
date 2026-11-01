import { type ExtensionAPI, FooterComponent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const RESET = "\x1b[0m";
type Rgb = [number, number, number];
const fg = (c: Rgb) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;

// Decoration comes from CaskaydiaCove NF, the terminal's primary face.
const FOLDER = "\uf07b"; // nf-fa-folder
const COMMENT = "\uf075"; // nf-fa-comment
const DISK = "\uf1c0"; // nf-fa-database
const THINKING = "\u25c9"; // ◉
const SOLID = "\u2588"; // █
const SHADE = ["\u2593", "\u2592", "\u2591"]; // ▓ ▒ ░ — the ramp behind the fill

const CWD: Rgb = [110, 170, 225];
const FOLDER_COLOR: Rgb = [217, 175, 87];
const BRANCH: Rgb = [150, 175, 120];
const TITLE: Rgb = [205, 205, 205];
const MUTED: Rgb = [130, 130, 130];
const FAINT: Rgb = [85, 85, 85];

// Brand logos live in Herdr Agent Icons Max, reachable only through the terminal's fallback
// chain (CaskaydiaCove NF carries no U+E1A0..U+E1BB). See herdr config-gpui.local.toml [terminal].
type Brand = { prefix: string; icon: string; label: string; rgb: Rgb };
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

const LEVEL_COLORS: Record<string, Rgb> = {
	off: [115, 115, 115],
	minimal: [125, 160, 195],
	low: [120, 200, 140],
	medium: [110, 190, 225],
	high: [230, 190, 90],
	xhigh: [235, 150, 90],
	max: [200, 120, 220],
};

const patched = Symbol.for("pi-polish.footer");

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

/** Keeps the left column, gives the remaining space to the right one and truncates it. */
function placeRight(left: string, right: string, width: number): string {
	if (!right) return truncateToWidth(left, width, "...");
	const leftWidth = visibleWidth(left);
	const room = width - leftWidth - 1;
	if (room <= 4) return truncateToWidth(left, width, "...");
	const shown = visibleWidth(right) <= room ? right : truncateToWidth(right, room, "...");
	return left + " ".repeat(Math.max(1, width - leftWidth - visibleWidth(shown))) + shown;
}

/** Keeps the right column whole and truncates the left one. */
function placeLeft(left: string, right: string, width: number): string {
	const rightWidth = visibleWidth(right);
	const room = width - rightWidth - 1;
	const shown = visibleWidth(left) <= room ? left : room > 4 ? truncateToWidth(left, room, "...") : "";
	return shown + " ".repeat(Math.max(1, width - visibleWidth(shown) - rightWidth)) + right;
}

/** Solid fill with a three-cell shade ramp, so the leading edge fades instead of stopping hard. */
function renderBar(cells: number, percent: number, color: Rgb): string {
	const filled = Math.floor((Math.max(0, Math.min(100, percent)) / 100) * cells);
	let out = filled > 0 ? `${fg(color)}${SOLID.repeat(filled)}${RESET}` : "";
	for (let i = filled; i < cells; i++) {
		const step = i - filled;
		out += `${fg(step === 0 ? color : step === 1 ? MUTED : FAINT)}${SHADE[Math.min(step, SHADE.length - 1)]}${RESET}`;
	}
	return out;
}

function build(footer: any, width: number): string[] {
	const state = footer.session.state;
	const manager = footer.session.sessionManager;
	const model = state.model;

	const home = process.env.HOME || process.env.USERPROFILE || "";
	const rawCwd = String(manager.getCwd());
	const cwd = home && rawCwd.toLowerCase().startsWith(home.toLowerCase()) ? `~${rawCwd.slice(home.length)}` : rawCwd;
	const branch = footer.footerData.getGitBranch?.();
	const sessionName = manager.getSessionName();

	const left = `${fg(FOLDER_COLOR)}${FOLDER}${RESET} ${fg(CWD)}${cwd}${RESET}${branch ? ` ${fg(BRANCH)}(${branch})${RESET}` : ""}`;
	const title = sessionName ? `${fg(MUTED)}${COMMENT}${RESET} ${fg(TITLE)}${sessionName}${RESET}` : "";
	const first = placeRight(left, title, width);

	const id = model?.id ?? "no-model";
	const brand = BRANDS.find((b) => id.toLowerCase().startsWith(b.prefix)) ?? FALLBACK;
	let modelInfo = `${fg(brand.rgb)}${brand.icon}${RESET} ${fg(brand.rgb)}${displayName(id)}${RESET}`;
	if (model?.reasoning) {
		const level = state.thinkingLevel || "off";
		const levelColor = LEVEL_COLORS[level] ?? MUTED;
		modelInfo += ` ${fg(levelColor)}${THINKING} ${level}${RESET}`;
	}

	const usage = footer.getSessionStats().contextUsage;
	const used = usage?.tokens ?? 0;
	const window = usage?.contextWindow ?? model?.contextWindow ?? 0;
	const percent = usage?.percent ?? null;
	const pressure: Rgb = percent !== null && percent >= 85 ? [240, 110, 110] : percent !== null && percent >= 60 ? [230, 190, 90] : [140, 200, 120];

	const cells = width >= 60 ? 16 : width >= 40 ? 10 : 0;
	const bar = percent === null || cells === 0 ? "" : `${renderBar(cells, percent, pressure)} `;
	const percentText = percent === null ? "?" : `${Math.round(percent)}%`;
	const contextInfo = `${fg(pressure)}${DISK}${RESET} ${bar}${fg(pressure)}${formatTokens(used)}/${formatTokens(window)} (${percentText})${RESET}`;

	return [first, placeLeft(modelInfo, contextInfo, width)];
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
