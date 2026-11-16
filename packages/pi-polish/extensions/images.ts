import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

const EXTENSION = /\.(png|jpe?g|gif|webp|bmp)$/i;
const IMAGE_PATH = /(?<![\w:/\\])(?:"(?:[A-Za-z]:[\\/]|\/|\\\\)[^"\r\n]+\.(?:png|jpe?g|gif|webp|bmp)"|'(?:[A-Za-z]:[\\/]|\/|\\\\)[^'\r\n]+\.(?:png|jpe?g|gif|webp|bmp)'|(?:[A-Za-z]:[\\/]|\/|\\\\)[^\s"'<>]+?\.(?:png|jpe?g|gif|webp|bmp)(?=$|[\s),;!?，。]))/gi;
const MARKER = /\[(image\d+)\]/g;
const PATCHED = Symbol.for("pi-polish.image-pastes");

type Match = { raw: string; index: number };
function imagePaths(text: string, requireFile: boolean): Match[] {
	const raw = text.trim();
	const path = raw.replace(/^(["'])(.*)\1$/, "$2");
	if (requireFile && isAbsolute(path) && EXTENSION.test(path) && existsSync(path)) {
		return [{ raw, index: text.indexOf(raw) }];
	}
	return [...text.matchAll(IMAGE_PATH)].filter((match) =>
		!requireFile || existsSync(match[0].replace(/^(["'])(.*)\1$/, "$2")),
	).map((match) => ({ raw: match[0], index: match.index }));
}

function replacePaths(text: string, matches: Match[], replace: (raw: string) => string): string {
	let output = "";
	let end = 0;
	for (const match of matches) {
		output += text.slice(end, match.index) + replace(match.raw);
		end = match.index + match.raw.length;
	}
	return output + text.slice(end);
}

// Transcript-only transformation: the stored message and model input retain their original paths.
export function compactImagePaths(text: string): string {
	let index = 0;
	return replacePaths(text, imagePaths(text, false), () => `[image${++index}]`);
}

export function decorateImagePastes(editor: any): void {
	if (editor[PATCHED] || !(editor.pastes instanceof Map) || typeof editor.expandPasteMarkers !== "function") return;
	editor[PATCHED] = true;
	const compact = (text: string, matches = imagePaths(text, true)) => replacePaths(text, matches, (raw) => {
		let index = 1;
		while (editor.pastes.has(`image${index}`)) index++;
		const key = `image${index}`;
		editor.pastes.set(key, raw);
		return `[${key}]`;
	});

	// Reuse Pi's paste registry so submit, external editing, undo and draft restoration share one source of truth.
	for (const method of ["insertTextAtCursor", "handlePaste"]) {
		const original = editor[method];
		editor[method] = function (text: string) {
			const matches = imagePaths(text, true);
			if (!matches.length) return original.call(this, text);
			this.cancelAutocomplete();
			this.pushUndoSnapshot();
			this.lastAction = null;
			this.exitHistoryBrowsing();
			this.insertTextAtCursorInternal(compact(text, matches));
		};
	}
	const setText = editor.setTextInternal;
	editor.setTextInternal = function (text: string, ...rest: any[]) {
		return setText.call(this, compact(text), ...rest);
	};
	const expand = editor.expandPasteMarkers;
	editor.expandPasteMarkers = function (text: string) {
		let result = "";
		let end = 0;
		for (const match of text.matchAll(MARKER)) {
			if (!this.pastes.has(match[1])) continue;
			result += expand.call(this, text.slice(end, match.index)) + this.pastes.get(match[1]);
			end = match.index + match[0].length;
		}
		return result + expand.call(this, text.slice(end));
	};
	const segment = editor.segment;
	editor.segment = function (text: string, mode: string) {
		const markers = [...text.matchAll(MARKER)].filter((match) => this.pastes.has(match[1]));
		return [...segment.call(this, text, mode)].flatMap((part: { segment: string; index: number }) => {
			const match = markers.find((marker) => part.index >= marker.index && part.index < marker.index + marker[0].length);
			if (!match) return [part];
			return part.index === match.index ? [{ ...part, segment: match[0] }] : [];
		});
	};
	const handleInput = editor.handleInput;
	editor.handleInput = function (data: string) {
		const result = handleInput.call(this, data);
		if (this.historyIndex === -1) {
			for (const key of this.pastes.keys()) {
				if (typeof key === "string" && /^image\d+$/.test(key) && !this.getText().includes(`[${key}]`)) this.pastes.delete(key);
			}
		}
		return result;
	};
}
