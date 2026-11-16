import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AssistantMessageComponent, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Markdown, MouseRegion, replaceControlCharacters, Spacer, stripTerminalSequences, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

const MODES = ["single", "multi", "off"] as const;
type Mode = (typeof MODES)[number];
const LABELS: Record<Mode, string> = { single: "单行预览", multi: "最近 3 行", off: "关闭" };
const ORIGINAL = Symbol.for("pi-polish.thinking.original");
const PATCHED = Symbol.for("pi-polish.patched");

function readConfig(path: string): Record<string, unknown> {
	try {
		const data = JSON.parse(readFileSync(path, "utf8"));
		if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid pi-polish config");
		return data;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

function saveMode(path: string, mode: Mode): void {
	const config = { ...readConfig(path), thinking: mode };
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function thinkingRuns(message: any): string[] {
	const runs: string[] = [];
	let parts: string[] = [];
	for (const part of [...message.content, { type: "end" }]) {
		if (part.type === "thinking") {
			if (part.thinking.trim()) parts.push(part.thinking.trim());
		} else if (parts.length) {
			runs.push(parts.join("\n\n"));
			parts = [];
		}
	}
	return runs;
}

export default function registerThinking(pi: ExtensionAPI, configPath = join(getAgentDir(), "pi-polish.json")) {
	let mode: Mode = "single";
	let ui: ExtensionContext["ui"] | undefined;
	try {
		const saved = readConfig(configPath).thinking;
		if (saved !== undefined && !MODES.includes(saved as Mode)) throw new Error("Invalid thinking mode");
		mode = (saved as Mode | undefined) ?? "single";
	} catch {
		console.error("[pi-polish] Invalid pi-polish.json; using single-line thinking preview.");
	}

	const applyLabel = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		ui = ctx.ui;
		ctx.ui.setHiddenThinkingLabel(mode === "off" ? "" : "Thinking…");
	};

	const proto: any = AssistantMessageComponent.prototype;
	proto[ORIGINAL] ??= proto.updateContent;
	const original = proto[ORIGINAL];
	const replacement: any = function (this: any, message: any, ...rest: any[]) {
		original.call(this, message, ...rest);
		if (mode === "off") {
			const kept: Component[] = [];
			for (const child of this.contentContainer.children) {
				if (child instanceof MouseRegion) {
					if (kept.at(-1) instanceof Spacer) kept.pop();
				} else kept.push(child);
			}
			this.contentContainer.children = kept;
			return;
		}
		const runs = thinkingRuns(message).map((text, index) => ({
			text,
			hidden: this.thinkingVisibilityOverrides?.get(index) ?? this.hideThinkingBlock,
		})).filter((run) => !run.hidden || this.hiddenThinkingLabel.trim());
		let index = 0;
		// Pi 1.5 wraps each visible thinking run in a MouseRegion; keep its native click-to-expand handler.
		for (const child of this.contentContainer.children) {
			if (!(child instanceof MouseRegion)) continue;
			const run = runs[index++];
			if (!run?.hidden) continue;
			const lines = stripTerminalSequences(run.text).split(/\r?\n/)
				.map((line) => replaceControlCharacters(line).trim()).filter(Boolean);
			const rows = mode === "single" ? lines.slice(-1) : lines.slice(-3);
			const previews = rows.map((row) => ({
				width: visibleWidth(row),
				markdown: new Markdown(row, 0, 0, this.markdownTheme, {
					color: (text) => ui?.theme.fg("thinkingText", text) ?? text,
					italic: true,
				}),
			}));
			const invalidate = child.invalidate.bind(child);
			child.invalidate = () => {
				invalidate();
				for (const preview of previews) preview.markdown.invalidate();
			};
			const padding = this.outputPad;
			child.render = (width: number) => {
				const available = Math.max(0, width - 2 * padding);
				if (!available) return [];
				return previews.map((preview) => {
					// Render formatting before clipping, so truncation never exposes Markdown delimiters.
					const row = preview.markdown.render(Math.max(available, preview.width))
						.filter((line) => stripTerminalSequences(line).trim()).join(" ");
					return " ".repeat(padding) + truncateToWidth(row, available) + " ".repeat(padding);
				});
			};
		}
	};
	// Chrome's one-shot patch must recognize this wrapper on /reload; the true original is retained above.
	replacement[PATCHED] = true;
	proto.updateContent = replacement;

	pi.on("session_start", (_event, ctx) => applyLabel(ctx));
	pi.registerCommand("polish-thinking", {
		description: "折叠思考预览：single 单行 / multi 多行 / off 关闭",
		getArgumentCompletions: (prefix) => MODES.filter((value) => value.startsWith(prefix))
			.map((value) => ({ value, label: `${value}: ${LABELS[value]}` })),
		handler: async (args, ctx) => {
			const choice = args.trim() || (await ctx.ui.select("折叠思考显示", MODES.map((value) => `${value}: ${LABELS[value]}`)))?.split(":")[0];
			if (!choice) return;
			if (!MODES.includes(choice as Mode)) {
				ctx.ui.notify("用法：/polish-thinking single|multi|off", "error");
				return;
			}
			try {
				saveMode(configPath, choice as Mode);
			} catch {
				ctx.ui.notify("无法保存思考选项；请检查 pi-polish.json 的格式和写入权限。原配置未被覆盖。", "error");
				return;
			}
			mode = choice as Mode;
			applyLabel(ctx);
			ctx.ui.notify(`折叠思考：${LABELS[mode]}（已保存）`, "info");
		},
	});
}
