import { execFile } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
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

// ---------------------------------------------------------------------------
// Runtime + git status, ported from pi-open-tui (extensions/open-tui/runtime.ts
// and git.ts) so the footer carries the same information it used to show.
// Both spawn processes, so neither runs inside render: a cached value is drawn
// and a background refresh is kicked off when it goes stale.
// shortcut: the drawn value is one render behind the refresh. pi re-renders on
// keystrokes and streamed output, so it is fresh while working but can sit stale
// while idle. Upgrade by registering ctx.ui.setFooter and calling tui.requestRender
// from the refresh callback if a live idle update is ever needed.
// ---------------------------------------------------------------------------

const SUCCESS_COLOR: Rgb = [74, 222, 128]; // #4ade80
const WARNING_COLOR: Rgb = [251, 191, 36]; // #fbbf24
const ERROR_COLOR: Rgb = [248, 113, 113]; // #f87171
const MUTED_COLOR: Rgb = [107, 114, 128]; // #6b7280

interface RuntimeDef {
	name: string;
	files: readonly string[];
	folders?: readonly string[];
	env?: string;
	versionCommand?: { cmd: string; args?: string[]; pattern?: RegExp };
}

// Detection order is significant: the first match wins, so a bun lockfile beats
// the package.json that usually sits next to it.
const RUNTIMES: readonly RuntimeDef[] = [
	{ name: "bun", files: ["bun.lock", "bun.lockb"], versionCommand: { cmd: "bun", args: ["--version"], pattern: /(\d+\.\d+\.\d+)/ } },
	{ name: "nodejs", files: ["package.json", ".nvmrc", ".node-version"], versionCommand: { cmd: "node", args: ["--version"], pattern: /v(\d+\.\d+\.\d+)/ } },
	{ name: "rust", files: ["Cargo.toml"], versionCommand: { cmd: "rustc", args: ["--version"], pattern: /rustc\s+(\d+\.\d+\.\d+)/ } },
	{ name: "go", files: ["go.mod"], versionCommand: { cmd: "go", args: ["version"], pattern: /go(\d+\.\d+\.\d+)/ } },
	{ name: "python", files: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile", ".python-version"], versionCommand: { cmd: "python3", args: ["--version"], pattern: /Python\s+(\d+\.\d+\.\d+)/ } },
	{ name: "ruby", files: ["Gemfile", ".ruby-version"], versionCommand: { cmd: "ruby", args: ["--version"], pattern: /ruby\s+(\d+\.\d+\.\d+)/ } },
	{ name: "java", files: ["pom.xml", "build.gradle", "build.gradle.kts", ".java-version"], versionCommand: { cmd: "java", args: ["-version"], pattern: /version\s+"(\d+\.\d+[\.\d]*)"/ } },
	{ name: "swift", files: ["Package.swift"], versionCommand: { cmd: "swift", args: ["--version"], pattern: /Swift\s+(\d+\.\d+)/ } },
	{ name: "kotlin", files: ["build.gradle.kts", "settings.gradle.kts"] },
	{ name: "cpp", files: ["CMakeLists.txt", "Makefile"] },
	{ name: "deno", files: ["deno.json", "deno.jsonc", "deno.lock"], versionCommand: { cmd: "deno", args: ["--version"], pattern: /deno\s+(\d+\.\d+\.\d+)/ } },
	{ name: "php", files: ["composer.json"], versionCommand: { cmd: "php", args: ["--version"], pattern: /PHP\s+(\d+\.\d+\.\d+)/ } },
	{ name: "haskell", files: ["stack.yaml", "cabal.project"], versionCommand: { cmd: "ghc", args: ["--version"], pattern: /(\d+\.\d+\.\d+)/ } },
	{ name: "julia", files: ["Project.toml", "Manifest.toml"], versionCommand: { cmd: "julia", args: ["--version"], pattern: /julia\s+(\d+\.\d+\.\d+)/ } },
	{ name: "lua", files: ["stylua.toml", ".luarc.json"], versionCommand: { cmd: "lua", args: ["-v"], pattern: /Lua\s+(\d+\.\d+)/ } },
	{ name: "elixir", files: ["mix.exs"], versionCommand: { cmd: "elixir", args: ["--version"], pattern: /Elixir\s+(\d+\.\d+\.\d+)/ } },
	{ name: "erlang", files: ["rebar.config", "erlang.mk"] },
	{ name: "gleam", files: ["gleam.toml"], versionCommand: { cmd: "gleam", args: ["--version"], pattern: /gleam\s+(\d+\.\d+\.\d+)/ } },
	{ name: "crystal", files: ["shard.yml"], versionCommand: { cmd: "crystal", args: ["--version"], pattern: /Crystal\s+(\d+\.\d+\.\d+)/ } },
	{ name: "dart", files: ["pubspec.yaml"], versionCommand: { cmd: "dart", args: ["--version"], pattern: /Dart\s+SDK\s+version:\s+(\d+\.\d+\.\d+)/ } },
	{ name: "nim", files: ["nim.cfg"] },
	{ name: "zig", files: ["build.zig"], versionCommand: { cmd: "zig", args: ["version"], pattern: /(\d+\.\d+\.\d+)/ } },
	{ name: "ocaml", files: ["dune", "dune-project"] },
	{ name: "clojure", files: ["project.clj", "deps.edn"] },
	{ name: "scala", files: ["build.sbt", ".metals"] },
	{ name: "perl", files: ["Makefile.PL", "cpanfile"] },
	{ name: "elm", files: ["elm.json"] },
	{ name: "haxe", files: ["haxelib.json", ".haxerc"] },
	{ name: "terraform", files: ["main.tf", "variables.tf"], folders: [".terraform"] },
	{ name: "helm", files: ["Chart.yaml", "helmfile.yaml"] },
	{ name: "gradle", files: ["build.gradle", "build.gradle.kts"], folders: ["gradle"] },
	{ name: "cmake", files: ["CMakeLists.txt", "CMakeCache.txt"] },
	{ name: "meson", files: ["meson.build"], env: "MESON_DEVENV" },
	{ name: "nix", files: ["flake.nix", "shell.nix"], env: "IN_NIX_SHELL" },
	{ name: "conda", files: [], env: "CONDA_DEFAULT_ENV" },
	{ name: "pixi", files: ["pixi.toml", "pixi.lock"], env: "PIXI_ENVIRONMENT_NAME" },
	{ name: "pulumi", files: ["Pulumi.yaml", "Pulumi.yml"] },
	{ name: "typst", files: ["template.typ"] },
	{ name: "buf", files: ["buf.yaml", "buf.gen.yaml", "buf.work.yaml"] },
	{ name: "dotnet", files: ["global.json", "Directory.Build.props"] },
];

// Nerd Font devicons, same codepoints pi-open-tui uses.
const RUNTIME_ICONS: Record<string, string> = {
	nodejs: "\ue718",
	rust: "\ue7a8",
	go: "\ue626",
	python: "\ue73c",
	ruby: "\ue739",
	java: "\ue256",
	cpp: "\ue61d",
	swift: "\ue755",
	kotlin: "\ue634",
	deno: "\ue7fb",
	bun: "\ue76f",
	php: "\ue73d",
	haskell: "\ue777",
	julia: "\ue624",
	lua: "\ue620",
	elixir: "\ue62b",
	erlang: "\ue7b1",
	gleam: "\ue6b4",
	crystal: "\ue62f",
	dart: "\ue7c0",
	nim: "\ue677",
	zig: "\ue6a9",
	ocaml: "\ue67a",
	clojure: "\ue76a",
	scala: "\ue747",
	perl: "\ue769",
	elm: "\ue62c",
	haxe: "\ue7b7",
	terraform: "\ue1a5",
};

interface GitStatus {
	modified: number;
	untracked: number;
	staged: number;
	stashed: number;
	conflicted: number;
	renamed: number;
	deleted: number;
	ahead: number;
	behind: number;
}

const NO_GIT: GitStatus = { modified: 0, untracked: 0, staged: 0, stashed: 0, conflicted: 0, renamed: 0, deleted: 0, ahead: 0, behind: 0 };

const RUNTIME_TTL_MS = 30_000;
const GIT_TTL_MS = 5_000;

let runtimeCache: { cwd: string; at: number; info: { name: string; version?: string } | null } | null = null;
let runtimeBusy = false;
let gitCache: { cwd: string; at: number; status: GitStatus } | null = null;
let gitBusy = false;

function matchesRuntime(cwd: string, def: RuntimeDef): boolean {
	if (def.env && process.env[def.env]) return true;
	if (def.files.some((f) => existsSync(join(cwd, f)))) return true;
	return def.folders?.some((f) => existsSync(join(cwd, f))) ?? false;
}

function refreshRuntime(cwd: string): void {
	const def = RUNTIMES.find((d) => matchesRuntime(cwd, d));
	if (!def) {
		runtimeCache = { cwd, at: Date.now(), info: null };
		return;
	}
	const cmd = def.versionCommand;
	if (!cmd) {
		runtimeCache = { cwd, at: Date.now(), info: { name: def.name } };
		return;
	}
	runtimeBusy = true;
	// java prints its version on stderr, so both streams are matched.
	execFile(cmd.cmd, cmd.args ?? [], { cwd, timeout: 2500, windowsHide: true, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
		runtimeBusy = false;
		const output = `${stdout}\n${stderr}`;
		const matched = cmd.pattern?.exec(output)?.[1];
		const version = err && !output.trim() ? undefined : (matched ?? output.trim()) || undefined;
		runtimeCache = { cwd, at: Date.now(), info: { name: def.name, version } };
	});
}

function runtimeFor(cwd: string): { name: string; version?: string } | null {
	const now = Date.now();
	const fresh = runtimeCache && runtimeCache.cwd === cwd && now - runtimeCache.at < RUNTIME_TTL_MS;
	if (!fresh && !runtimeBusy) refreshRuntime(cwd);
	return runtimeCache && runtimeCache.cwd === cwd ? runtimeCache.info : null;
}

function parseGitStatus(out: string): GitStatus {
	const status: GitStatus = { ...NO_GIT };
	for (const line of out.split("\n")) {
		if (line.startsWith("## ")) {
			const rest = line.slice(3);
			if (!rest.startsWith("HEAD (no branch)")) {
				const m = /^\S+?\.\.\.\S+?(?:\s+\[(.*)\])?$/.exec(rest);
				const ahead = m?.[1]?.match(/\bahead (\d+)\b/);
				const behind = m?.[1]?.match(/\bbehind (\d+)\b/);
				if (ahead) status.ahead = Number(ahead[1]);
				if (behind) status.behind = Number(behind[1]);
			}
			continue;
		}
		if (line.length < 3) continue;
		const x = line[0];
		const y = line[1];
		if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) status.conflicted++;
		else if (x === "?" && y === "?") status.untracked++;
		else if (x === "R") {
			status.renamed++;
			if (y === "M") status.modified++;
			else if (y === "D") status.deleted++;
		} else if (x === "D" || y === "D") status.deleted++;
		else {
			if (x !== " " && x !== "?") status.staged++;
			if (y === "M" || y === "D") status.modified++;
		}
	}
	return status;
}

function refreshGit(cwd: string): void {
	gitBusy = true;
	execFile("git", ["--no-optional-locks", "status", "--porcelain=v1", "--branch"], { cwd, timeout: 4000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
		const status = err ? { ...NO_GIT } : parseGitStatus(String(stdout));
		execFile("git", ["--no-optional-locks", "stash", "list", "--format=%H"], { cwd, timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024 }, (stashErr, stashOut) => {
			gitBusy = false;
			if (!stashErr) status.stashed = String(stashOut).split("\n").filter((l) => l.trim() !== "").length;
			gitCache = { cwd, at: Date.now(), status };
		});
	});
}

function gitFor(cwd: string): GitStatus {
	const now = Date.now();
	const fresh = gitCache && gitCache.cwd === cwd && now - gitCache.at < GIT_TTL_MS;
	if (!fresh && !gitBusy) refreshGit(cwd);
	return gitCache && gitCache.cwd === cwd ? gitCache.status : NO_GIT;
}

/** `[!1 x2 +1 ?3 $1 ↑2 ↓1]` — counts only, wrapped in dim brackets like pi-open-tui. */
function gitStatusText(g: GitStatus): string {
	const parts: string[] = [];
	const add = (n: number, glyph: string, color: Rgb) => {
		if (n > 0) parts.push(`${fg(color)}${glyph}${n}${RESET}`);
	};
	add(g.conflicted, "=", ERROR_COLOR);
	add(g.deleted, "\uf00d", ERROR_COLOR); // U+F00D fa-times; U+2718 (open-tui's ✘) is absent from CaskaydiaCove NF
	add(g.modified, "!", WARNING_COLOR);
	add(g.renamed, "\u00bb", WARNING_COLOR);
	add(g.staged, "+", SUCCESS_COLOR);
	add(g.untracked, "?", MUTED_COLOR);
	add(g.stashed, "$", MUTED_COLOR);
	if (g.ahead > 0 && g.behind > 0) parts.push(`${fg(WARNING_COLOR)}\u2195${g.ahead}/${g.behind}${RESET}`); // U+2195; U+21D5 is absent
	else if (g.ahead > 0) parts.push(`${fg(SUCCESS_COLOR)}\u2191${g.ahead}${RESET}`);
	else if (g.behind > 0) parts.push(`${fg(WARNING_COLOR)}\u2193${g.behind}${RESET}`);
	return parts.length > 0 ? `${fg(SEP_COLOR)}[${RESET}${parts.join(" ")}${fg(SEP_COLOR)}]${RESET}` : "";
}

function runtimeText(runtime: { name: string; version?: string } | null): string {
	if (!runtime) return "";
	const icon = `${fg(SUCCESS_COLOR)}${RUNTIME_ICONS[runtime.name] ?? "\uf120"}${RESET}`;
	return runtime.version ? `${icon} ${fg(MUTED_COLOR)}${runtime.version}${RESET}` : icon;
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

	// Line 2: [pi 图标 会话标题] | [分支图标 分支名] [git 状态] [运行时图标 版本]
	const titlePart = sessionName
		? `${fg(AGENT_COLOR)}${AGENT_ICON} ${sessionName}${RESET}`
		: "";
	const gitPart = branch ? `${fg(BRANCH_COLOR)}${BRANCH_ICON} ${branch}${RESET}` : "";
	const statusPart = branch ? gitStatusText(gitFor(cwd)) : "";
	const runtimePart = runtimeText(runtimeFor(cwd));
	const rightBlock = [gitPart, statusPart, runtimePart].filter(Boolean).join(" ");

	let line2 = "";
	if (titlePart && rightBlock) {
		const rightWidth = visibleWidth(rightBlock);
		const availableForTitle = width - rightWidth - SEP_WIDTH;
		if (availableForTitle > 4) {
			const truncatedTitle =
				visibleWidth(titlePart) <= availableForTitle
					? titlePart
					: truncateToWidth(titlePart, availableForTitle, "...");
			line2 = `${truncatedTitle}${SEP}${rightBlock}`;
		} else {
			line2 = truncateToWidth(`${titlePart}${SEP}${rightBlock}`, width, "...");
		}
	} else if (titlePart) {
		line2 = truncateToWidth(titlePart, width, "...");
	} else if (rightBlock) {
		line2 = truncateToWidth(rightBlock, width, "...");
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
