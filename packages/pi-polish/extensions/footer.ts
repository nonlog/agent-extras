import { execFile } from "node:child_process";
import { appendFileSync, readdirSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, FooterComponent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const RESET = "\x1b[0m";
type Rgb = [number, number, number];

// \x1b[22;1; cancels outer dim (22) and turns on bold (1) for vibrant statusline colors
const fg = (c: Rgb) => `\x1b[22;1;38;2;${c[0]};${c[1]};${c[2]}m`;

// Unicode Icons (Nerd Font & standard Block Elements)
const FOLDER = "\uf07b"; // U+F07B Nerd Font (FontAwesome)
const BRANCH_ICON = "\ue725"; // U+E725 Nerd Font (devicons)
const DISK = "\uf1c0"; // U+F1C0 Nerd Font (FontAwesome)
const THINKING = "\uec10"; // U+EC10 Nerd Font (cod-sparkle)
const SOLID = "\u2588"; // U+2588 solid fill block
const SHADE = "\u2592"; // U+2592 medium shade block
const DIRTY_MARK = "\u25cf"; // U+25CF black circle: uncommitted changes
const AHEAD_MARK = "\u2191"; // U+2191 up arrow
const BEHIND_MARK = "\u2193"; // U+2193 down arrow

// Functional Palette (ANSI 256 / 24-bit Truecolor)
const CWD_COLOR: Rgb = [215, 175, 0]; // #d7af00 (ANSI 178) warm gold
// Session title: pi's own brand glyph (Herdr Agent Icons Max U+E1A9, glyph name "pi") and the
// title share one color, pi.dev's accent blue #6a9fcc (--color-accent-blue / --accent in
// https://pi.dev/style.css), the same blue the site uses for links and the "yours" highlight.
// shortcut: hardcoded to pi — pi-polish only loads inside pi; if it ever runs under another
// agent, key this off process.env.AI_AGENT (pi sets it to "pi").
const AGENT_ICON = "\ue1a9";
const AGENT_COLOR: Rgb = [106, 159, 204]; // #6a9fcc
const BRANCH_COLOR: Rgb = [175, 255, 95]; // #afff5f (ANSI 155) vibrant light green
const DIRTY_COLOR: Rgb = [230, 190, 90]; // #e6be5a amber: uncommitted changes, ahead/behind
const SEP_COLOR: Rgb = [95, 95, 95]; // #5f5f5f (ANSI 59) low-contrast neutral gray

// Brand logos (Herdr Agent Icons Max PUA U+E1A0..U+E1BB) & Official Brand Colors
type Brand = { prefix: string; icon: string; label: string; rgb: Rgb };
const BRANDS: Brand[] = [
	{ prefix: "deepseek", icon: "\ue1ad", label: "DeepSeek", rgb: [77, 107, 254] }, // #4d6bfe
	{ prefix: "claude", icon: "\ue1a0", label: "Claude", rgb: [217, 119, 87] }, // #d97757
	{ prefix: "codex", icon: "\ue1a1", label: "Codex", rgb: [16, 163, 127] }, // #10a37f
	{ prefix: "gpt", icon: "\ue1af", label: "GPT", rgb: [16, 163, 127] }, // #10a37f
	{ prefix: "openai", icon: "\ue1af", label: "OpenAI", rgb: [16, 163, 127] }, // #10a37f
	{ prefix: "gemini", icon: "\ue1ae", label: "Gemini", rgb: [66, 133, 244] }, // #4285f4
	{ prefix: "glm", icon: "\ue1b7", label: "GLM", rgb: [59, 110, 245] }, // #3b6ef5
	{ prefix: "muse", icon: "\ue1b9", label: "Muse", rgb: [0, 130, 251] }, // #0082fb
	{ prefix: "kimi", icon: "\ue1a6", label: "Kimi", rgb: [23, 131, 255] }, // #1783ff
	{ prefix: "qwen", icon: "\ue1b0", label: "Qwen", rgb: [97, 92, 237] }, // #615ced
	{ prefix: "grok", icon: "\ue1b1", label: "Grok", rgb: [201, 201, 209] }, // #c9c9d1
];
const FALLBACK_BRAND: Brand = { prefix: "", icon: "\u{F09D1}", label: "", rgb: [156, 163, 175] }; // U+F09D1 md-brain #9ca3af

// Tech stack of the working directory, from top-level marker files. Glyphs are Nerd Font devicons
// (CaskaydiaCove NF); colors are the vendors' published brand colors. Same table as
// ~/.claude/statusline.js and ~/.factory/statusline.js so all three status lines agree.
type Stack = { icon: string; rgb: Rgb; file: string[]; ext: string[] };
const STACKS: Stack[] = [
	{ icon: "\ue738", rgb: [248, 152, 32], file: ["pom.xml", "build.gradle"], ext: [".java"] },
	{ icon: "\ue634", rgb: [127, 82, 255], file: ["build.gradle.kts", "settings.gradle.kts", "androidmanifest.xml"], ext: [".kt", ".kts"] },
	{ icon: "\ue606", rgb: [55, 118, 171], file: ["pyproject.toml", "requirements.txt", "setup.py", "pipfile"], ext: [".py"] },
	{ icon: "\ue628", rgb: [49, 120, 198], file: ["tsconfig.json"], ext: [".ts", ".tsx"] },
	{ icon: "\ue718", rgb: [95, 160, 78], file: ["package.json"], ext: [] },
	{ icon: "\ue627", rgb: [0, 173, 216], file: ["go.mod"], ext: [".go"] },
	{ icon: "\ue7a8", rgb: [222, 165, 132], file: ["cargo.toml"], ext: [".rs"] },
	{ icon: "\ue77f", rgb: [81, 43, 212], file: [], ext: [".csproj", ".sln", ".fsproj"] },
	{ icon: "\ue61d", rgb: [0, 89, 156], file: ["cmakelists.txt"], ext: [".cpp", ".cc", ".hpp"] },
	{ icon: "\ue755", rgb: [240, 81, 56], file: ["package.swift"], ext: [".swift"] },
	{ icon: "\ue798", rgb: [1, 117, 194], file: ["pubspec.yaml"], ext: [".dart"] },
	{ icon: "\ue739", rgb: [204, 52, 45], file: ["gemfile"], ext: [".rb"] },
	{ icon: "\ue73d", rgb: [119, 123, 180], file: ["composer.json"], ext: [".php"] },
	{ icon: "\uf0844", rgb: [79, 192, 141], file: ["vue.config.js"], ext: [".vue"] },
	{ icon: "\ue736", rgb: [227, 79, 38], file: ["index.html"], ext: [".html"] },
	{ icon: "\uf308", rgb: [36, 150, 237], file: ["dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml"], ext: [] },
	{ icon: "\uf489", rgb: [137, 224, 81], file: [], ext: [".sh", ".bash"] },
	{ icon: "\uf0a0a", rgb: [83, 145, 254], file: [], ext: [".ps1", ".psm1"] },
];

// Sources live in standard roots, not next to the manifest: an Android module's .kt files sit under
// app/src/main/java, a TypeScript package's under src or lib. A whole-tree walk was tried in the
// Claude Code statusline and dropped — reaching Android needs depth 4+, and it is slow and noisy
// (one vendored .go file misreports the stack). So: descend only when a manifest says there is
// something to find, and only into the roots below.
const SOURCE_ROOTS = [
	"app/src/main/java",
	"app/src/main/kotlin",
	"src/main/java",
	"src/main/kotlin",
	"src",
	"lib",
	"app",
	"extensions",
	"packages",
];
const JVM_MARKERS = ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"];
const SKIP_DIRS = new Set([
	"node_modules",
	"build",
	"dist",
	"out",
	"target",
	".git",
	".gradle",
	".idea",
	"__pycache__",
	"venv",
	".venv",
	"vendor",
]);

function sourceExts(cwd: string, maxDepth = 8, maxEntries = 3000): Set<string> {
	const exts = new Set<string>();
	const stack: Array<[string, number]> = SOURCE_ROOTS.map((rel) => [join(cwd, rel), 0]);
	let seen = 0;
	while (stack.length > 0 && seen < maxEntries) {
		const [dir, depth] = stack.pop()!;
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			if (++seen > maxEntries) break;
			if (e.isFile()) {
				const dot = e.name.lastIndexOf(".");
				if (dot > 0) exts.add(e.name.slice(dot).toLowerCase());
			} else if (depth < maxDepth && !SKIP_DIRS.has(e.name.toLowerCase())) {
				stack.push([join(dir, e.name), depth + 1]);
			}
		}
	}
	return exts;
}

// ponytail: two readdir passes per repo change, not per render — detectStacks is memoised below.
function detectStacks(cwd: string): Stack[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(cwd, { withFileTypes: true });
	} catch {
		return [];
	}
	const files = new Set<string>();
	const exts = new Set<string>();
	for (const e of entries) {
		if (!e.isFile()) continue;
		files.add(e.name.toLowerCase());
		const dot = e.name.lastIndexOf(".");
		if (dot > 0) exts.add(e.name.slice(dot).toLowerCase());
	}
	if (files.has("package.json") || JVM_MARKERS.some((m) => files.has(m))) {
		for (const x of sourceExts(cwd)) exts.add(x);
	}

	const out: Stack[] = [];
	for (const s of STACKS) {
		if (s.file.some((f) => files.has(f)) || s.ext.some((x) => exts.has(x))) {
			out.push(s);
			if (out.length === 6) break;
		}
	}
	return out;
}

// detectStacks walks directories, so it must not run on every render: cache per cwd for
// STACK_TTL_MS. A new marker file shows up within that window.
const STACK_TTL_MS = 10_000;
let stackCache: { cwd: string; at: number; stacks: Stack[] } | null = null;
function stacksFor(cwd: string): Stack[] {
	const now = Date.now();
	if (stackCache && stackCache.cwd === cwd && now - stackCache.at < STACK_TTL_MS) return stackCache.stacks;
	const stacks = detectStacks(cwd);
	stackCache = { cwd, at: now, stacks };
	return stacks;
}

// Git state beyond the branch name: dirty worktree and ahead/behind the upstream. One
// `git status --porcelain=v2 --branch` answers all three, but it is a process spawn, so it runs
// asynchronously and the render always uses the last known value. Nothing blocks the UI.
const GIT_STATUS_TTL_MS = 5_000;
let gitCache: { cwd: string; at: number; dirty: boolean; ahead: number; behind: number } | null = null;
let gitInFlight = false;

function gitStatus(cwd: string): { dirty: boolean; ahead: number; behind: number } {
	const now = Date.now();
	const fresh = gitCache && gitCache.cwd === cwd && now - gitCache.at <= GIT_STATUS_TTL_MS;
	if (!fresh && !gitInFlight) {
		gitInFlight = true;
		const previous = gitCache && gitCache.cwd === cwd ? gitCache : null;
		execFile(
			"git",
			["-C", cwd, "--no-optional-locks", "status", "--porcelain=v2", "--branch", "--untracked-files=normal"],
			{ timeout: 4000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
			(err, stdout) => {
				gitInFlight = false;
				// A failure (timeout, git missing) is cached too: retrying on every render would spawn
				// a process per frame. The last known value survives, or clean on a first failure.
				gitCache = err
					? { cwd, at: Date.now(), dirty: previous?.dirty ?? false, ahead: previous?.ahead ?? 0, behind: previous?.behind ?? 0 }
					: { cwd, at: Date.now(), ...parseGitStatus(String(stdout)) };
			},
		);
	}
	// First render in a new directory has no answer yet: report clean rather than stale.
	if (!gitCache || gitCache.cwd !== cwd) return { dirty: false, ahead: 0, behind: 0 };
	return gitCache;
}

function parseGitStatus(out: string): { dirty: boolean; ahead: number; behind: number } {
	let dirty = false;
	let ahead = 0;
	let behind = 0;
	for (const line of out.split("\n")) {
		if (line.startsWith("# branch.ab ")) {
			const m = /\+(\d+)\s+-(\d+)/.exec(line);
			if (m) {
				ahead = Number(m[1]);
				behind = Number(m[2]);
			}
		} else if (line !== "" && !line.startsWith("# ")) {
			dirty = true;
		}
	}
	return { dirty, ahead, behind };
}

// Reasoning Effort Colors (Tailwind-based Truecolor)
const LEVEL_COLORS: Record<string, Rgb> = {
	none: [107, 114, 128], // #6b7280
	off: [107, 114, 128], // #6b7280
	dynamic: [34, 211, 238], // #22d3ee
	minimal: [56, 189, 248], // #38bdf8
	low: [74, 222, 128], // #4ade80
	medium: [251, 191, 36], // #fbbf24
	high: [251, 146, 60], // #fb923c
	xhigh: [248, 113, 113], // #f87171
	max: [192, 132, 252], // #c084fc
};

const patched = Symbol.for("pi-polish.footer");

let reportedFailure = false;
function reportFailure(err: unknown): void {
	if (reportedFailure) return;
	reportedFailure = true;
	try {
		appendFileSync(
			join(homedir(), ".pi", "agent", "pi-polish-footer-error.log"),
			`${new Date().toISOString()} ${(err as Error)?.stack ?? String(err)}\n`,
		);
	} catch {
		// reporting must never break rendering
	}
}

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
		if (/^\d+$/.test(raw) && /^\d+$/.test(previous)) words[words.length - 1] = `${previous}.${raw}`;
		else words.push(raw[0].toUpperCase() + raw.slice(1));
	}
	return [brand?.label, ...words].filter(Boolean).join(" ");
}

/**
 * LERP smooth color interpolation for context progress bar:
 *  0% ~ 40%:  pure healthy green rgb(74, 222, 128) (#4ade80)
 * 40% ~ 70%:  smooth transition to amber gold rgb(251, 191, 36) (#fbbf24)
 * 70% ~ 100%: smooth transition to danger red rgb(248, 113, 113) (#f87171)
 */
function lerpPressureColor(percent: number): Rgb {
	const p = Math.max(0, Math.min(100, percent));
	const cGreen: Rgb = [74, 222, 128];
	const cYellow: Rgb = [251, 191, 36];
	const cRed: Rgb = [248, 113, 113];

	if (p <= 40) return cGreen;
	if (p <= 70) {
		const t = (p - 40) / 30;
		return [
			Math.round(cGreen[0] + (cYellow[0] - cGreen[0]) * t),
			Math.round(cGreen[1] + (cYellow[1] - cGreen[1]) * t),
			Math.round(cGreen[2] + (cYellow[2] - cGreen[2]) * t),
		];
	}
	const t = (p - 70) / 30;
	return [
		Math.round(cYellow[0] + (cRed[0] - cYellow[0]) * t),
		Math.round(cYellow[1] + (cRed[1] - cYellow[1]) * t),
		Math.round(cYellow[2] + (cRed[2] - cYellow[2]) * t),
	];
}

/** 16-cell bar with solid fill █ and medium shade ▒ inside brackets [████████▒▒▒▒▒▒▒▒] */
function renderBar(cells: number, percent: number, color: Rgb): string {
	const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * cells);
	const empty = cells - filled;
	const barFilled = filled > 0 ? `${fg(color)}${SOLID.repeat(filled)}${RESET}` : "";
	const barEmpty = empty > 0 ? `${fg(SEP_COLOR)}${SHADE.repeat(empty)}${RESET}` : "";
	return `${fg(SEP_COLOR)}[${RESET}${barFilled}${barEmpty}${fg(SEP_COLOR)}]${RESET}`;
}

function build(footer: any, width: number): string[] {
	const state = footer.session.state;
	const manager = footer.session.sessionManager;
	const model = state.model;

	const cwd = String(manager.getCwd());
	const branch = footer.footerData.getGitBranch?.();
	const sessionName = manager.getSessionName();

	const SEP = `${fg(SEP_COLOR)} | ${RESET}`;
	const SEP_WIDTH = 3;

	// Line 1: [目录图标 完整工作目录] | [品牌图标 模型显示名  思考等级] | [存储图标 16格阴影进度条 已用/上限]
	const cwdText = `${fg(CWD_COLOR)}${FOLDER} ${cwd}${RESET}`;

	const id = model?.id ?? "no-model";
	const brand = BRANDS.find((b) => id.toLowerCase().startsWith(b.prefix)) ?? FALLBACK_BRAND;
	let modelText = `${fg(brand.rgb)}${brand.icon} ${displayName(id)}${RESET}`;
	if (model?.reasoning) {
		const level = state.thinkingLevel || "off";
		const levelColor = LEVEL_COLORS[level] ?? LEVEL_COLORS.off;
		modelText += ` ${fg(levelColor)}${THINKING} ${level}${RESET}`;
	}

	const usage = footer.getSessionStats().contextUsage;
	const used = usage?.tokens ?? 0;
	const window = usage?.contextWindow ?? model?.contextWindow ?? 0;
	const percent = usage?.percent ?? (window > 0 ? (used / window) * 100 : 0);
	const pressureColor = lerpPressureColor(percent);

	// Adaptive bar width based on line width (16 cells default, downscales if tight)
	const fixedWidth = visibleWidth(cwdText) + SEP_WIDTH + visibleWidth(modelText) + SEP_WIDTH + 18;
	let cells = 16;
	if (width < fixedWidth + 16) {
		cells = Math.max(0, Math.floor(width - fixedWidth));
	}

	const bar = cells > 0 ? `${renderBar(cells, percent, pressureColor)} ` : "";
	const progressText = `${fg(pressureColor)}${DISK}${RESET} ${bar}${fg(pressureColor)}${formatTokens(used)}/${formatTokens(window)}${RESET}`;

	let line1 = `${cwdText}${SEP}${modelText}${SEP}${progressText}`;
	if (visibleWidth(line1) > width) {
		line1 = truncateToWidth(line1, width, "...");
	}

	// Line 2: [pi 图标 会话标题] | [分支图标 分支名 ●↑2↓1] [技术栈图标]
	const titlePart = sessionName
		? `${fg(AGENT_COLOR)}${AGENT_ICON} ${sessionName}${RESET}`
		: "";
	let gitPart = branch ? `${fg(BRANCH_COLOR)}${BRANCH_ICON} ${branch}${RESET}` : "";
	if (branch) {
		const status = gitStatus(cwd);
		if (status.dirty) gitPart += ` ${fg(DIRTY_COLOR)}${DIRTY_MARK}${RESET}`;
		if (status.ahead > 0) gitPart += ` ${fg(DIRTY_COLOR)}${AHEAD_MARK}${status.ahead}${RESET}`;
		if (status.behind > 0) gitPart += ` ${fg(DIRTY_COLOR)}${BEHIND_MARK}${status.behind}${RESET}`;
	}
	const stackPart = stacksFor(cwd)
		.map((s) => `${fg(s.rgb)}${s.icon}${RESET}`)
		.join(" ");
	gitPart = [gitPart, stackPart].filter(Boolean).join(" ");

	let line2 = "";
	if (titlePart && gitPart) {
		const gitWidth = visibleWidth(gitPart);
		const availableForTitle = width - gitWidth - SEP_WIDTH;
		if (availableForTitle > 4) {
			const truncatedTitle =
				visibleWidth(titlePart) <= availableForTitle
					? titlePart
					: truncateToWidth(titlePart, availableForTitle, "...");
			line2 = `${truncatedTitle}${SEP}${gitPart}`;
		} else {
			line2 = truncateToWidth(`${titlePart}${SEP}${gitPart}`, width, "...");
		}
	} else if (titlePart) {
		line2 = truncateToWidth(titlePart, width, "...");
	} else if (gitPart) {
		line2 = truncateToWidth(gitPart, width, "...");
	}

	return [line1, line2];
}

export default function (_pi: ExtensionAPI) {
	try {
		const proto: any = FooterComponent.prototype;
		if (typeof proto.render !== "function" || proto.render[patched]) return;
		const original = proto.render;
		const replacement: any = function (this: any, width: number) {
			try {
				return build(this, width);
			} catch (err) {
				reportFailure(err);
				return original.call(this, width);
			}
		};
		replacement[patched] = true;
		proto.render = replacement;
	} catch (err) {
		console.error(`[pi-polish] could not patch the footer: ${(err as Error).message}`);
	}
}
