#!/usr/bin/env node
'use strict';

// Claude Code statusLine. Same design as ~/.factory/statusline.js (Droid) and
// pi-extensions/packages/pi-polish/extensions/footer.ts (Pi), adapted to the
// Claude Code statusLine payload.
//
//   📁 D:\Workspace\General | <brand> DeepSeek V4.1 Flash ✦ max | 🗄 [██████▒▒▒▒▒▒▒▒▒▒] 148k/400k
//   💬 检查 pi 插件冲突 |  main [↕1/2]
//
// ccstatusline cannot express this: its model widget takes one flat color (no
// per-brand hue), its bar glyphs are hardcoded `[█░]`, and its colors are fixed
// per widget — it has no percentage-driven gradient. Hence a script.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const B = '\x1b[22;'; // normal intensity: cancel any inherited bold/dim, keep true color saturated
const RESET = '\x1b[0m';

function fg(hex) {
  const h = String(hex).replace('#', '');
  return B + '38;2;' + parseInt(h.slice(0, 2), 16) + ';' +
    parseInt(h.slice(2, 4), 16) + ';' + parseInt(h.slice(4, 6), 16) + 'm';
}

const C = {
  dir: fg('#d7af00'),    // warm gold
  git: fg('#afff5f'),    // vibrant light green
  sep: fg('#5f5f5f'),    // low-contrast neutral gray
  ok: fg('#4ade80'),     // #4ade80 ahead
  warn: fg('#fbbf24'),   // #fbbf24 behind / diverged
};

const ICON = {
  folder: '\u{f07b}',
  git: '\ue725',
  ctx: '\u{f1c0}',
  effort: '\uec10',   // cod-sparkle
};

// The agent running this statusline. This file is wired into Claude Code only
// (~/.claude/settings.json), so the agent is always Claude Code: the Claude
// logo from "Herdr Agent Icons Max" in Anthropic's brand orange. Droid and Pi
// have their own copies of this design.
const AGENT = { glyph: '\u{e1a0}', color: '#d97757' };

// Brand logos from "Herdr Agent Icons Max" (PUA U+E1A0..U+E1BB), in the
// vendor's published brand color.
const BRAND = [
  [/deepseek/i, '\u{e1ad}', '#4d6bfe'],
  [/claude|opus|sonnet|haiku|anthropic/i, '\u{e1a0}', '#d97757'],
  [/gemini|google/i, '\u{e1ae}', '#4285f4'],
  [/grok|\bxai\b/i, '\u{e1b1}', '#c9c9d1'],
  [/glm|zhipu/i, '\u{e1b7}', '#3b6ef5'],
  [/muse/i, '\u{e1b9}', '#0082fb'],
  [/qwen/i, '\u{e1b0}', '#615ced'],
  [/kimi/i, '\u{e1a6}', '#1783ff'],
  [/gpt|openai|\bo[0-9]/i, '\u{e1af}', '#10a37f'],
  [/codex/i, '\u{e1a1}', '#10a37f'],
];
const BRAND_FALLBACK = { glyph: '\u{f09d1}', color: '#9ca3af' }; // md-brain

function brandOf(modelId, displayName) {
  const hay = (modelId || '') + ' ' + (displayName || '');
  for (const [re, glyph, color] of BRAND) if (re.test(hay)) return { glyph, color };
  return BRAND_FALLBACK;
}

// Cool to hot, so the level reads at a glance.
const EFFORT_COLOR = {
  none: '#6b7280', off: '#6b7280', dynamic: '#22d3ee', minimal: '#38bdf8',
  low: '#4ade80', medium: '#d7af00', high: '#fb923c', xhigh: '#f87171', max: '#c084fc',
};

function effortColor(level) {
  const key = String(level || '').toLowerCase().replace(/[_\s-]/g, '');
  const alias = { extrahigh: 'xhigh', extra: 'xhigh', maximum: 'max', minimum: 'minimal' };
  return EFFORT_COLOR[alias[key] || key] || EFFORT_COLOR.medium;
}

function fmtTokens(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';
  if (n >= 1e6) return Math.round(n / 1e6) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}

function num(v) {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null;
}

// Session title: the transcript is JSONL; /rename appends {"type":"custom-title",
// "customTitle":...}, and Claude Code's automatic title is {"type":"ai-title",
// "aiTitle":...}. Custom wins; otherwise the first automatic title. One forward
// pass with a substring pre-filter — parsing every line of a multi-MB transcript
// on each redraw would be the expensive part.
// ponytail: full-file scan per redraw; add an mtime-keyed cache file if large transcripts get slow.
function sessionTitle(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return '';
  let custom = '';
  let auto = '';
  try {
    const text = fs.readFileSync(transcriptPath, 'utf8');
    for (const line of text.split('\n')) {
      let rec;
      if (line.includes('"custom-title"')) {
        rec = tryJson(line);
        if (rec && typeof rec.customTitle === 'string' && rec.customTitle.trim()) custom = rec.customTitle.trim();
      } else if (!auto && line.includes('"ai-title"')) {
        rec = tryJson(line);
        if (rec && typeof rec.aiTitle === 'string' && rec.aiTitle.trim()) auto = rec.aiTitle.trim();
      }
    }
  } catch (_) {
    // Missing or unreadable transcript: no title.
  }
  return custom || auto;
}

function tryJson(line) {
  try { return JSON.parse(line); } catch (_) { return null; }
}

// Runtime of the working directory, detected from top-level marker files — the same table and
// devicons the pi footer uses, ported from pi-open-tui's runtime.ts. One devicon, no version.
// Pure existsSync, no process, so it is cheap even though this file runs on every redraw.
const RUNTIMES = [
  ['bun', ['bun.lock', 'bun.lockb']],
  ['nodejs', ['package.json', '.nvmrc', '.node-version']],
  ['rust', ['Cargo.toml']],
  ['go', ['go.mod']],
  ['python', ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', '.python-version']],
  ['ruby', ['Gemfile', '.ruby-version']],
  ['java', ['pom.xml', 'build.gradle', 'build.gradle.kts', '.java-version']],
  ['swift', ['Package.swift']],
  ['kotlin', ['build.gradle.kts', 'settings.gradle.kts']],
  ['cpp', ['CMakeLists.txt', 'Makefile']],
  ['deno', ['deno.json', 'deno.jsonc', 'deno.lock']],
  ['php', ['composer.json']],
  ['haskell', ['stack.yaml', 'cabal.project']],
  ['julia', ['Project.toml', 'Manifest.toml']],
  ['lua', ['stylua.toml', '.luarc.json']],
  ['elixir', ['mix.exs']],
  ['erlang', ['rebar.config', 'erlang.mk']],
  ['gleam', ['gleam.toml']],
  ['crystal', ['shard.yml']],
  ['dart', ['pubspec.yaml']],
  ['nim', ['nim.cfg']],
  ['zig', ['build.zig']],
  ['ocaml', ['dune', 'dune-project']],
  ['clojure', ['project.clj', 'deps.edn']],
  ['scala', ['build.sbt', '.metals']],
  ['perl', ['Makefile.PL', 'cpanfile']],
  ['elm', ['elm.json']],
  ['haxe', ['haxelib.json', '.haxerc']],
  ['terraform', ['main.tf', 'variables.tf'], { folders: ['.terraform'] }],
  ['helm', ['Chart.yaml', 'helmfile.yaml']],
  ['gradle', ['build.gradle', 'build.gradle.kts'], { folders: ['gradle'] }],
  ['cmake', ['CMakeLists.txt', 'CMakeCache.txt']],
  ['meson', ['meson.build'], { env: 'MESON_DEVENV' }],
  ['nix', ['flake.nix', 'shell.nix'], { env: 'IN_NIX_SHELL' }],
  ['conda', [], { env: 'CONDA_DEFAULT_ENV' }],
  ['pixi', ['pixi.toml', 'pixi.lock'], { env: 'PIXI_ENVIRONMENT_NAME' }],
  ['pulumi', ['Pulumi.yaml', 'Pulumi.yml']],
  ['typst', ['template.typ']],
  ['buf', ['buf.yaml', 'buf.gen.yaml', 'buf.work.yaml']],
  ['dotnet', ['global.json', 'Directory.Build.props']],
];

// Nerd Font devicons, same codepoints the pi footer uses.
const RUNTIME_ICONS = {
  nodejs: '\ue718', rust: '\ue7a8', go: '\ue626', python: '\ue73c', ruby: '\ue739',
  java: '\ue256', cpp: '\ue61d', swift: '\ue755', kotlin: '\ue634', deno: '\ue7fb',
  bun: '\ue76f', php: '\ue73d', haskell: '\ue777', julia: '\ue624', lua: '\ue620',
  elixir: '\ue62b', erlang: '\ue7b1', gleam: '\ue6b4', crystal: '\ue62f', dart: '\ue7c0',
  nim: '\ue677', zig: '\ue6a9', ocaml: '\ue67a', clojure: '\ue76a', scala: '\ue747',
  perl: '\ue769', elm: '\ue62c', haxe: '\ue7b7', terraform: '\ue1a5',
};

// First match wins, so a bun lockfile beats the package.json beside it.
function runtimeSegment(cwd) {
  for (const [name, files, extra] of RUNTIMES) {
    const matched =
      files.some((f) => fs.existsSync(path.join(cwd, f))) ||
      (extra?.folders ?? []).some((f) => fs.existsSync(path.join(cwd, f))) ||
      (extra?.env !== undefined && Boolean(process.env[extra.env]));
    if (matched) return C.ok + (RUNTIME_ICONS[name] ?? '\uf120') + RESET;
  }
  return '';
}

// One `git status --porcelain=v1 --branch` answers both the branch name and the divergence
// from its upstream, so this replaces the separate rev-parse call. A statusline runs as a
// fresh process on every redraw, so there is no cross-render cache to keep: one process total.
function gitSegment(cwd) {
  let out;
  try {
    out = execFileSync(
      'git',
      ['-C', cwd, '--no-optional-locks', 'status', '--porcelain=v1', '--branch'],
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    );
  } catch (_) {
    return '';
  }
  const head = String(out).split('\n')[0] ?? '';
  if (!head.startsWith('## ')) return '';
  const rest = head.slice(3);
  let seg;
  if (rest.startsWith('HEAD (no branch)')) {
    // Detached HEAD has no upstream to compare against.
    seg = C.git + ICON.git + ' detached' + RESET;
  } else {
    // A repository with no commits yet reports "No commits yet on <branch>" instead of a ref.
    const noCommits = /^No commits yet on (\S+?)(?:\.\.\.|\s|$)/.exec(rest);
    if (noCommits) {
      seg = C.git + ICON.git + ' ' + noCommits[1] + RESET;
    } else {
      const m = /^\S+?\.\.\.\S+?(?:\s+\[(.*)\])?$/.exec(rest);
      const branch = m ? rest.slice(0, rest.indexOf('...')) : rest.split(' ')[0];
      seg = C.git + ICON.git + ' ' + branch + RESET;
      const ahead = Number(m?.[1]?.match(/\bahead (\d+)\b/)?.[1] ?? 0);
      const behind = Number(m?.[1]?.match(/\bbehind (\d+)\b/)?.[1] ?? 0);
      if (ahead > 0 && behind > 0) seg += ' ' + C.sep + '[' + RESET + C.warn + '\u2195' + ahead + '/' + behind + RESET + C.sep + ']' + RESET;
      else if (ahead > 0) seg += ' ' + C.sep + '[' + RESET + C.ok + '\u2191' + ahead + RESET + C.sep + ']' + RESET;
      else if (behind > 0) seg += ' ' + C.sep + '[' + RESET + C.warn + '\u2193' + behind + RESET + C.sep + ']' + RESET;
    }
  }
  // The runtime only appears where there is a branch for it to sit next to.
  const runtime = runtimeSegment(cwd);
  return runtime ? seg + ' ' + runtime : seg;
}

// Claude Code sends context_window.{context_window_size, current_usage,
// used_percentage, total_input_tokens}. Prefer an explicit current_usage, then
// the percentage, then cumulative input tokens.
function contextUsage(cw) {
  if (!cw || typeof cw !== 'object') return null;
  const total = num(cw.context_window_size);
  if (!total) return null;

  let used = null;
  if (typeof cw.current_usage === 'number') {
    used = num(cw.current_usage);
  } else if (cw.current_usage && typeof cw.current_usage === 'object') {
    const u = cw.current_usage;
    const parts = [u.input_tokens, u.output_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens];
    if (parts.some((p) => typeof p === 'number')) {
      used = parts.reduce((a, p) => a + (num(p) || 0), 0);
    }
  }
  if (used === null && typeof cw.used_percentage === 'number') {
    used = (cw.used_percentage / 100) * total;
  }
  if (used === null) used = num(cw.total_input_tokens);
  if (used === null || used <= 0) return null;
  return { used, total };
}

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

// 0~40% ccstatusline green (#5faf00), 40~70% warm gold (#d7af00), 70~100% red.
function contextColor(pct) {
  const p = Math.max(0, Math.min(100, pct));
  const green = [95, 175, 0];
  const gold = [215, 175, 0];
  const red = [240, 110, 110];
  let c;
  if (p <= 40) {
    c = green;
  } else if (p <= 70) {
    const t = (p - 40) / 30;
    c = [lerp(green[0], gold[0], t), lerp(green[1], gold[1], t), lerp(green[2], gold[2], t)];
  } else {
    const t = Math.min(1, (p - 70) / 30);
    c = [lerp(gold[0], red[0], t), lerp(gold[1], red[1], t), lerp(gold[2], red[2], t)];
  }
  return B + '38;2;' + c[0] + ';' + c[1] + ';' + c[2] + 'm';
}

// [████████▒▒▒▒▒▒▒▒] 237k/400k — 16 cells, solid fill and medium shade.
function contextSegment(cw) {
  const usage = contextUsage(cw);
  if (!usage) return '';
  const pct = Math.max(0, Math.min(100, (usage.used / usage.total) * 100));
  const cells = 16;
  const filled = Math.round((pct / 100) * cells);
  const bar = '[' + '\u2588'.repeat(filled) + '\u2592'.repeat(cells - filled) + ']';
  return contextColor(pct) + ICON.ctx + ' ' + bar + ' ' +
    fmtTokens(usage.used) + '/' + fmtTokens(usage.total) + RESET;
}

function render(j) {
  const cwd = j.cwd || (j.workspace && (j.workspace.current_dir || j.workspace.project_dir)) || process.cwd();
  const sep = C.sep + ' | ' + RESET;

  // Row 1: cwd | model + effort | context
  const m = j.model || {};
  const name = m.display_name || m.id || 'model';
  const brand = brandOf(m.id, name);
  let modelSeg = fg(brand.color) + brand.glyph + ' ' + name + RESET;
  const level = j.effort && j.effort.level;
  if (level) modelSeg += ' ' + fg(effortColor(level)) + ICON.effort + ' ' + level + RESET;

  const cwdSeg = C.dir + ICON.folder + ' ' + cwd + RESET;
  const ctxSeg = contextSegment(j.context_window);
  const row1 = [cwdSeg, modelSeg, ctxSeg].filter(Boolean).join(sep);

  // Row 2: session title | git branch
  const title = sessionTitle(j.transcript_path);
  const titleSeg = title ? fg(AGENT.color) + AGENT.glyph + ' ' + title + RESET : '';
  const gitSeg = gitSegment(cwd);
  const row2 = [titleSeg, gitSeg].filter(Boolean).join(sep);

  return [row1, row2].filter(Boolean).join('\n');
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let j = {};
  try { j = JSON.parse(raw || '{}'); } catch (_) { j = {}; }
  let out = '';
  try { out = render(j); } catch (_) { out = ''; }
  process.stdout.write(out + '\n');
});
process.stdin.on('error', () => process.stdout.write('\n'));
