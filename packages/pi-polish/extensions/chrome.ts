import { AssistantMessageComponent, CustomEditor, type ExtensionAPI, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";

const PROMPT = "❯";
const REPLY = "●";
const ORANGE = "\x1b[38;2;217;119;87m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
// ✱ rather than ✳, which Windows Terminal draws as a green emoji
const SPINNER = ["·", "✢", "✱", "✶", "✻", "✽", "✻", "✶", "✱", "✢"].map((f) => `${ORANGE}${f}${RESET}`);
// pi-open-tui frames the editor, so the first content line starts behind a "│ " rail
const ESCAPE = "(?:\\x1b\\[[0-9;]*m|\\x1b\\][^\\x07]*\\x07)";
const LEADING_ESCAPES = new RegExp(`^(((?:${ESCAPE})*│(?:${ESCAPE})* )?(?:${ESCAPE})*) {2}`);
const SPINNER_VERB = Symbol.for("pi-spinner-verbs.verb");
const SPINNER_VERB_CONSUMER = Symbol.for("pi-spinner-verbs.verb.consumer");
const OSC133_START = "\x1b]133;A\x07";
const OSC133_END = "\x1b]133;B\x07\x1b]133;C\x07";
const patched = Symbol.for("pi-polish.patched");

function markFirstLine(line: string, marker: string): string {
	return line.replace(LEADING_ESCAPES, (_m, esc: string) => `${esc}${marker} `);
}

function patchOnce(proto: any, method: string, wrap: (original: (...args: any[]) => any) => (...args: any[]) => any) {
	if (!proto || typeof proto[method] !== "function" || proto[method][patched]) return;
	const replacement: any = wrap(proto[method]);
	replacement[patched] = true;
	proto[method] = replacement;
}

export default function (pi: ExtensionAPI) {
	try {
		// pi-open-tui's thinking peek rewrites pi's hidden-thinking label row, so that row must survive:
		// stripping the thinking parts removes it and leaves the peek with nothing to show
		patchOnce(AssistantMessageComponent.prototype, "updateContent", (original) =>
			function (this: any, message: any, ...rest: any[]) {
				// Two columns of padding so reply text lines up behind the ● marker, like tool rows
				this.outputPad = Math.max(this.outputPad ?? 1, 2);
				original.call(this, message, ...rest);
				// Text blocks are the Markdown children without a default style; thinking blocks carry one
				for (const child of this.contentContainer?.children ?? []) {
					if (!(child instanceof Markdown) || (child as any).defaultTextStyle !== undefined || (child as any)[patched]) continue;
					const render = child.render.bind(child);
					child.render = (width: number) => {
						const lines: string[] = render(width);
						const first = lines.findIndex((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim());
						if (first >= 0) lines[first] = markFirstLine(lines[first], REPLY);
						return lines;
					};
					(child as any)[patched] = true;
				}
			},
		);

		// Past prompts: one highlighted line with the ❯ marker instead of a padded three-line box
		patchOnce(UserMessageComponent.prototype, "rebuild", (original) =>
			function (this: any) {
				this.outputPad = Math.max(this.outputPad ?? 1, 2);
				return original.call(this);
			},
		);
		patchOnce(UserMessageComponent.prototype, "render", (original) =>
			function (this: any, width: number) {
				const lines: string[] = original.call(this, width);
				if (lines.length < 3) return lines;
				const strip = (l: string) => l.replace(OSC133_START, "").replace(OSC133_END, "");
				const body = lines.slice(1, -1).map(strip);
				body[0] = OSC133_START + markFirstLine(body[0], `${DIM}${PROMPT}\x1b[22m`);
				body[body.length - 1] = body[body.length - 1] + OSC133_END;
				return body;
			},
		);
	} catch (err) {
		console.error(`[pi-polish] could not patch message components: ${(err as Error).message}`);
	}

	// Orange working line: what pi is doing now, elapsed time and output tokens for this run
	let started = 0;
	let tokens = 0;
	let streamed = 0;
	let phase = "Thinking";
	let timer: NodeJS.Timeout | undefined;
	const fmtTokens = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);
	const show = (ctx: any) => {
		const secs = Math.round((Date.now() - started) / 1000);
		const stats = `(${secs}s · ↓ ${fmtTokens(tokens + Math.round(streamed / 4))} tokens)`;
		// pi-spinner-verbs publishes its current verb; prefer it over the phase when present
		const verb = (globalThis as any)[SPINNER_VERB] as string | undefined;
		ctx.ui.setWorkingMessage(`${ORANGE}${verb ? `${verb}…` : `${phase}…`}${RESET} ${DIM}${stats}${RESET}`);
	};
	const toolPhase = (name: string, args: any) => {
		const path = String(args?.path ?? "").split("/").pop();
		switch (name) {
			case "bash":
				return `Running ${String(args?.command ?? "").split("\n")[0].slice(0, 60)}`;
			case "read":
				return `Reading ${path}`;
			case "edit":
				return `Editing ${path}`;
			case "write":
				return `Writing ${path}`;
			case "grep":
			case "find":
				return `Searching for ${String(args?.pattern ?? "").slice(0, 40)}`;
			case "bg_run":
				return "Starting a background job";
			case "questionnaire":
				return "Waiting for your answer";
			default:
				return `Running ${name}`;
		}
	};
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		// This extension owns the working line: tell pi-spinner-verbs to publish its verb instead of writing it
		(globalThis as any)[SPINNER_VERB_CONSUMER] = true;
		ctx.ui.setWorkingIndicator({ frames: SPINNER, intervalMs: 120 });
	});
	pi.on("agent_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		started = Date.now();
		tokens = 0;
		streamed = 0;
		phase = "Thinking";
		show(ctx);
		clearInterval(timer);
		timer = setInterval(() => show(ctx), 1000);
	});
	pi.on("message_update", async (event, ctx) => {
		if (!ctx.hasUI || event.message.role !== "assistant") return;
		const parts = (event.message as any).content ?? [];
		const last = parts[parts.length - 1];
		phase = last?.type === "text" ? "Responding" : last?.type === "toolCall" ? "Preparing a tool call" : "Thinking";
		streamed = parts.reduce((n: number, c: any) => n + (c.text?.length ?? c.thinking?.length ?? 0), 0);
	});
	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;
		tokens += (event.message as any).usage?.output ?? 0;
		streamed = 0;
	});
	pi.on("tool_execution_start", async (event, ctx) => {
		if (!ctx.hasUI) return;
		phase = toolPhase(event.toolName, event.args);
		show(ctx);
	});
	pi.on("tool_execution_end", async () => {
		phase = "Thinking";
	});
	pi.on("agent_end", async (_event, ctx) => {
		clearInterval(timer);
		timer = undefined;
		if (ctx.hasUI) ctx.ui.setWorkingMessage();
	});
	pi.on("session_shutdown", async () => {
		clearInterval(timer);
		delete (globalThis as any)[SPINNER_VERB_CONSUMER];
	});

	// ❯ before the input: two columns of editor padding, with the marker drawn into the first content line
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const previous = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor: any = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
			const render = editor.render.bind(editor);
			editor.render = (width: number) => {
				// Set on every render because pi may apply its own editor padding setting after creation
				editor.paddingX = 2;
				const lines: string[] = render(width);
				if (lines.length > 1) lines[1] = markFirstLine(lines[1], PROMPT);
				return lines;
			};
			return editor;
		});
	});
}
