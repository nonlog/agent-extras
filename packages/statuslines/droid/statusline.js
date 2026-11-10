#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Palette copied from ~/.config/ccstatusline/settings.json (colorLevel 2 = ansi256).
// ccstatusline's own ANSI codes: yellow 178, brightGreen 155, separator 59.
// 22; explicitly clears Droid's outer `dim` attribute (\x1b[2m) without applying bold,
// restoring true color saturation and brightness at regular font weight.
const B = '\x1b[22;';
const C = {
  reset: '\x1b[0m',
  dir: B + '38;5;178m',
  title: B + '38;2;238;238;238m', // Factory Droid 规范白 #eeeeee (dark surface 标配，标题与图标同色)
  git: B + '38;5;155m',
  sep: '\x1b[22;38;5;59m',
  ok: B + '38;2;74;222;128m',   // #4ade80 ahead
  warn: B + '38;2;251;191;36m', // #fbbf24 behind / diverged
};

const ICON = {
  folder: '\u{f07b}',
  git: '\ue725',
  ctx: '\u{f1c0}',
  agent: '\ue1bb',     // Factory Droid  (Herdr Agent Icons Max U+E1BB)
  effort: '\uec10',    // cod-sparkle 
};

function normEffort(level) {
  const key = String(level || '').toLowerCase().replace(/[_\s-]/g, '');
  const alias = {
    extrahigh: 'xhigh', extra: 'xhigh', maximum: 'max', minimum: 'minimal',
  };
  return alias[key] || key;
}

// Truecolor foreground from a #rrggbb string. Herdr is a GPU terminal, so
// 24-bit color is safe; it lets each brand keep its own exact hue instead of
// snapping to the nearest xterm-256 slot.
function fg(hex) {
  const h = String(hex).replace('#', '');
  return B + '38;2;' + parseInt(h.slice(0, 2), 16) + ';' +
    parseInt(h.slice(2, 4), 16) + ';' + parseInt(h.slice(4, 6), 16) + 'm';
}

// Brand logos from "Herdr Agent Icons Max" (U+E1A0..U+E1BB). Colors follow
// herdr-radar's own rules where it has one (claude, gemini, deepseek, qwen,
// kimi, muse), otherwise the vendor's published brand color.
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

// Unknown brands fall back to the Nerd Font brain glyph in a neutral tone.
function brandOf(modelId, displayName) {
  const hay = (modelId || '') + ' ' + (displayName || '');
  for (const [re, glyph, color] of BRAND) if (re.test(hay)) return { glyph, color };
  return { glyph: '\u{f09d1}', color: '#9ca3af' };
}

// Droid's reasoningEffort enum is
// none | dynamic | off | minimal | low | medium | high | xhigh | max.
// Cool to hot, so the level is readable at a glance.
const EFFORT_COLOR = {
  none: '#6b7280',
  off: '#6b7280',
  dynamic: '#22d3ee',
  minimal: '#38bdf8',
  low: '#4ade80',
  medium: '#d7af00', // ccstatusline warm gold #d7af00 (not glaring)
  high: '#fb923c',
  xhigh: '#f87171',
  max: '#c084fc',
};

function effortColor(level) {
  const norm = normEffort(level);
  return EFFORT_COLOR[norm] || EFFORT_COLOR.medium;
}

// Mirrors ccstatusline's formatTokens(count, {}, 0): integer k, M above 1e6.
function fmtTokens(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';
  if (n >= 1e6) return Math.round(n / 1e6) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}

function readJson(p) {
  if (!p) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function settingsPath() {
  return path.join(os.homedir(), '.factory', 'settings.json');
}

function slugify(name) {
  return String(name || '').replace(/\s+/g, '-');
}

// The payload carries the compaction limit but not the model's context window,
// so look the window up in settings.json customModels.
function contextWindowFor(modelId, settings) {
  if (!modelId || !settings) return null;
  const models = Array.isArray(settings.customModels) ? settings.customModels : [];
  const customSlug = modelId.startsWith('custom:')
    ? modelId.slice('custom:'.length).replace(/-\d+$/, '')
    : null;

  for (const m of models) {
    const matchesCustom = customSlug !== null && customSlug === slugify(m.displayName);
    const matchesPlain = modelId === m.model;
    if (!matchesCustom && !matchesPlain) continue;
    if (typeof m.maxContextLimit === 'number' && m.maxContextLimit > 0) {
      return m.maxContextLimit;
    }
  }
  return null;
}

// Brand logos from "Herdr Agent Icons Max" (U+E1A0..U+E1BB). Colors follow
// herdr-radar's own rules where it has one (claude, gemini, deepseek, qwen,
// kimi, muse), otherwise the vendor's published brand color.

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
    if (matched) return C.ok + (RUNTIME_ICONS[name] ?? '\uf120') + C.reset;
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
    seg = C.git + ICON.git + ' detached' + C.reset;
  } else {
    // A repository with no commits yet reports "No commits yet on <branch>" instead of a ref.
    const noCommits = /^No commits yet on (\S+?)(?:\.\.\.|\s|$)/.exec(rest);
    if (noCommits) {
      seg = C.git + ICON.git + ' ' + noCommits[1] + C.reset;
    } else {
      const m = /^\S+?\.\.\.\S+?(?:\s+\[(.*)\])?$/.exec(rest);
      const branch = m ? rest.slice(0, rest.indexOf('...')) : rest.split(' ')[0];
      seg = C.git + ICON.git + ' ' + branch + C.reset;
      const ahead = Number(m?.[1]?.match(/\bahead (\d+)\b/)?.[1] ?? 0);
      const behind = Number(m?.[1]?.match(/\bbehind (\d+)\b/)?.[1] ?? 0);
      if (ahead > 0 && behind > 0) seg += ' ' + C.sep + '[' + C.reset + C.warn + '\u2195' + ahead + '/' + behind + C.reset + C.sep + ']' + C.reset;
      else if (ahead > 0) seg += ' ' + C.sep + '[' + C.reset + C.ok + '\u2191' + ahead + C.reset + C.sep + ']' + C.reset;
      else if (behind > 0) seg += ' ' + C.sep + '[' + C.reset + C.warn + '\u2193' + behind + C.reset + C.sep + ']' + C.reset;
    }
  }
  // The runtime only appears where there is a branch for it to sit next to.
  const runtime = runtimeSegment(cwd);
  return runtime ? seg + ' ' + runtime : seg;
}


// The session title lives in the transcript's first line, as a
// {"type":"session_start","title":"..."} record. Read only the head of the
// file: transcripts grow to megabytes and this runs on every redraw.
function sessionTitle(j) {
  const p = j.transcript_path;
  if (typeof p !== 'string' || !p) return '';
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(8192);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const head = buf.subarray(0, n).toString('utf8');
      const line = head.split('\n', 1)[0];
      const rec = JSON.parse(line);
      if (rec && typeof rec.title === 'string' && rec.title.trim()) {
        return rec.title.trim();
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    // Missing, truncated, or non-JSON head: fall through to no title.
  }
  return '';
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// Smooth gradient: 0~40% ccstatusline green (#5faf00), 40~70% warm gold yellow (#d7af00), 70~100% danger red
function contextColor(pct) {
  const p = Math.max(0, Math.min(100, pct));
  const cGreen = [95, 175, 0];    // ccstatusline ANSI 70 (#5faf00)
  const cYellow = [215, 175, 0];  // ccstatusline ANSI 178 warm gold (#d7af00)
  const cRed = [240, 110, 110];

  let r, g, b;
  if (p <= 40) {
    [r, g, b] = cGreen;
  } else if (p <= 70) {
    const t = (p - 40) / 30;
    r = lerp(cGreen[0], cYellow[0], t);
    g = lerp(cGreen[1], cYellow[1], t);
    b = lerp(cGreen[2], cYellow[2], t);
  } else {
    const t = Math.min(1, (p - 70) / 30);
    r = lerp(cYellow[0], cRed[0], t);
    g = lerp(cYellow[1], cRed[1], t);
    b = lerp(cYellow[2], cRed[2], t);
  }
  return B + '38;2;' + r + ';' + g + ';' + b + 'm';
}

function charWidth(cp) {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (
    cp >= 0x1100 && (
      cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0x3247 && cp !== 0x303f) ||
      (cp >= 0x3250 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0xa4c6) ||
      (cp >= 0xa960 && cp <= 0xa97c) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6b) ||
      (cp >= 0xff01 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x20000 && cp <= 0x3fffd)
    )
  ) return 2;
  return 1;
}

function visibleWidth(str) {
  const plain = String(str).replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of plain) w += charWidth(ch.codePointAt(0));
  return w;
}

function truncatePath(p, maxCols) {
  const s = String(p);
  if (visibleWidth(s) <= maxCols) return s;
  if (maxCols <= 1) return '\u2026';
  const m = /^[A-Za-z]:[\\/]/.exec(s);
  const drive = m ? m[0] : '';
  const budget = maxCols - visibleWidth(drive) - 1;
  if (budget <= 0) {
    let acc = '';
    let w = 0;
    for (const ch of Array.from(s).reverse()) {
      const cw = charWidth(ch.codePointAt(0));
      if (w + cw > maxCols - 1) break;
      acc = ch + acc;
      w += cw;
    }
    return '\u2026' + acc;
  }
  const rest = s.slice(drive.length);
  const sep = s[2] || '\\';
  const parts = rest.split(/[\\/]/).filter(Boolean);
  let tail = '';
  let w = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = sep + parts[i];
    const pw = visibleWidth(seg);
    if (w + pw > budget) break;
    tail = seg + tail;
    w += pw;
  }
  if (!tail) {
    for (const ch of Array.from(rest).reverse()) {
      const cw = charWidth(ch.codePointAt(0));
      if (w + cw > budget) break;
      tail = ch + tail;
      w += cw;
    }
  }
  return drive + '\u2026' + tail;
}

function termColumns() {
  const envCols = Number(process.env.COLUMNS);
  if (envCols > 0) return envCols;
  if (process.stdout.columns > 0) return process.stdout.columns;
  if (process.platform === 'win32') {
    try {
      const tty = require('tty');
      const fd = fs.openSync('\\\\.\\CONOUT$', 'r+');
      try {
        const cols = new tty.WriteStream(fd).columns;
        if (cols > 0) return cols;
      } finally {
        try { fs.closeSync(fd); } catch (_) {}
      }
    } catch (_) {}
  }
  return 0;
}

// Context meter: a block bar followed by the used/total token counts.
//   [█████████▒▒▒▒▒▒▒] 237k/400k
function contextSegment(ctx, modelId, settings, cells = 16) {
  if (!ctx) return '';

  const used = typeof ctx.last_call_compaction_tokens === 'number'
    ? ctx.last_call_compaction_tokens
    : null;
  const total = contextWindowFor(modelId, settings)
    ?? (typeof ctx.token_limit === 'number' && ctx.token_limit > 0 ? ctx.token_limit : null);

  if (used === null || used <= 0 || !total) return '';

  const pct = Math.max(0, Math.min(100, (used / total) * 100));
  const counts = fmtTokens(used) + '/' + fmtTokens(total);
  if (cells <= 0) {
    return contextColor(pct) + ICON.ctx + ' ' + counts + C.reset;
  }
  const filled = Math.round((pct / 100) * cells);
  const bar = '[' + '\u2588'.repeat(filled) + '\u2592'.repeat(cells - filled) + ']';
  const text = bar + ' ' + counts;

  return contextColor(pct) + ICON.ctx + ' ' + text + C.reset;
}

function render(j) {
  const cwd = j.cwd || (j.workspace && j.workspace.current_dir) || process.cwd();
  const sep = C.sep + ' | ' + C.reset;

  // Row 1: cwd | model | progress
  const m = j.model || {};
  const name = m.display_name || m.id || 'model';
  const brand = brandOf(m.id, name);
  let modelSeg = fg(brand.color) + brand.glyph + ' ' + name + C.reset;
  if (m.reasoning_effort) {
    const eff = String(m.reasoning_effort);
    modelSeg += ' ' + fg(effortColor(eff)) + ICON.effort + ' ' + eff + C.reset;
  }

  const settings = readJson(settingsPath());
  // Reserve 4 columns of margin for footer padding/gutter, shrink the 16-cell bar first,
  // then middle-truncate cwd (`D:\…\leaf`) so a deep path never crowds out model or tokens.
  const cols = termColumns();
  const width = cols > 0 ? Math.max(20, cols - 4) : 0;
  let cells = 16;
  let displayCwd = cwd;
  if (width > 0) {
    const fullCtx = contextSegment(j.context, m.id, settings, 16);
    const fullWidth = 2 + visibleWidth(cwd) + 3 + visibleWidth(modelSeg) + (fullCtx ? 3 + visibleWidth(fullCtx) : 0);
    if (fullWidth > width) {
      const overflow = fullWidth - width;
      if (fullCtx) {
        cells = Math.max(0, 16 - overflow);
        if (cells > 0 && cells < 4) cells = 0;
      }
      const nextCtx = contextSegment(j.context, m.id, settings, cells);
      const restWidth = 2 + 3 + visibleWidth(modelSeg) + (nextCtx ? 3 + visibleWidth(nextCtx) : 0);
      const maxCwd = Math.max(12, width - restWidth);
      if (visibleWidth(cwd) > maxCwd) displayCwd = truncatePath(cwd, maxCwd);
    }
  }

  const cwdSeg = C.dir + ICON.folder + ' ' + displayCwd + C.reset;
  const ctxSeg = contextSegment(j.context, m.id, settings, cells);
  const row1 = [cwdSeg, modelSeg, ctxSeg].filter(Boolean).join(sep);

  // Row 2: session title | git info + status | tech stack
  const title = sessionTitle(j);
  const titleSeg = title ? C.title + ICON.agent + ' ' + title + C.reset : '';
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
