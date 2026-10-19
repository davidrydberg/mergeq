import type { PrAnalysis, RepoAnalysis } from "./analyze.js";
import { age } from "./format.js";
import type { CheckCounts, Checks } from "./hosts/host.js";
import type { OrderItem } from "./order.js";
import { GLYPH, padVisible, painter, stripAnsi, truncate, type Painter, type Style } from "./style.js";

export type Hint = [command: string, description: string];

const MAX_FILES = 20;

export function renderStatus(analyses: RepoAnalysis[], hints: Hint[], style: Style, now: Date): string {
  const p = painter(style);
  const blocks = analyses.map((analysis) => repoBlock(analysis, style, p, now));
  return [...blocks, nextSection(hints, p, style)].join("\n\n");
}

export function renderPr(analysis: RepoAnalysis, pr: PrAnalysis, hints: Hint[], style: Style, now: Date): string {
  const p = painter(style);
  const placed = analysis.order.find((item) => item.number === pr.number);
  const blocked = analysis.blocked.find((item) => item.number === pr.number);
  const lines: string[] = [];

  lines.push(p.bold(truncate(`#${pr.number}  ${pr.title}`, style.width)));
  lines.push(p.dim(truncate(pr.url, style.width)));
  lines.push(...flow([pr.author, p.dim(`opened ${age(pr.createdAt, now)} ago`), p.dim(`updated ${age(pr.updatedAt, now)} ago`), `${pr.headRef} -> ${p.bold(pr.base)}`], "", style.width));
  lines.push("");
  const field = (name: string, ...parts: string[]) => {
    const [first = "", ...rest] = flow(parts, "", style.width - 11);
    lines.push(`  ${padVisible(p.dim(name), 8)} ${first}`, ...rest.map((line) => `${" ".repeat(11)}${line}`));
  };
  field("checks", checksText(pr.checks, pr.checkCounts, p));
  field("review", reviewText(pr.review, p));
  field("size", `${sizeText(pr.additions, pr.deletions, p)} in ${pr.files.length} ${pr.files.length === 1 ? "file" : "files"}`);
  if (pr.draft) field("draft", p.yellow("yes"));
  if (placed) {
    field("order", p.bold(`${placed.position} of ${analysis.order.length}`), conflictNote(placed, analysis, pr, p));
    field("", p.dim(placed.why));
  } else {
    field("order", p.red(`blocked: ${blocked?.reason ?? "unknown"}`));
  }

  lines.push("", p.bold("CONFLICTS"));
  const baseLabel = `base ${pr.base}`;
  const partners = analysis.pairs.filter((pair) => pair.a === pr.number || pair.b === pr.number);
  const labelWidth = Math.max(baseLabel.length, ...partners.map((pair) => `#${pair.a === pr.number ? pair.b : pair.a}`.length));
  lines.push(
    `  ${padVisible(baseLabel, labelWidth)}  ${pr.conflictsBase ? p.red(`${GLYPH.fail} ${files(pr.baseConflictFiles, style.width - labelWidth - 6)}`) : p.green(`${GLYPH.ok} merges cleanly`)}`,
  );
  for (const pair of partners) {
    const other = pair.a === pr.number ? pair.b : pair.a;
    lines.push(`  ${padVisible(`#${other}`, labelWidth)}  ${p.yellow(`${GLYPH.warn} ${files(pair.files, style.width - labelWidth - 6)}`)}`);
  }
  if (partners.length === 0) {
    lines.push(`  ${padVisible("other PRs", labelWidth)}  ${p.green(`${GLYPH.ok} none`)}`);
  }

  lines.push("", p.bold(`FILES (${pr.fileStats.length})`));
  const shown = pr.fileStats.slice(0, MAX_FILES);
  const addWidth = Math.max(2, ...shown.map((file) => `+${file.additions}`.length));
  const delWidth = Math.max(2, ...shown.map((file) => `-${file.deletions}`.length));
  for (const file of shown) {
    const pathWidth = style.width - addWidth - delWidth - 6;
    lines.push(
      `  ${padVisible(p.green(`+${file.additions}`), addWidth, "right")} ${padVisible(p.red(`-${file.deletions}`), delWidth, "right")}  ${truncateStart(file.path, pathWidth)}`,
    );
  }
  if (pr.fileStats.length > MAX_FILES) {
    lines.push(p.dim(`  and ${pr.fileStats.length - MAX_FILES} more`));
  }

  return [lines.join("\n"), nextSection(hints, p, style)].join("\n\n");
}

export interface HomeView {
  repo: string;
  open: number;
  okCount?: number;
  conflicting?: number;
  analysisAge?: string;
  changed?: number;
  cached: boolean;
  next: OrderItem[];
}

export function renderHome(view: HomeView, hints: Hint[], style: Style): string {
  const p = painter(style);
  const lines = [`${p.bold(view.repo)}  ${view.open} open ${view.open === 1 ? "PR" : "PRs"}`];
  const facts: string[] = [];
  if (view.okCount !== undefined) facts.push(p.green(`${view.okCount} with checks and review ok`));
  if (view.conflicting !== undefined) facts.push(view.conflicting > 0 ? p.yellow(`${view.conflicting} conflicting`) : p.green("no conflicts"));
  if (view.analysisAge !== undefined) {
    const changed = view.changed ? p.yellow(`, ${view.changed} PRs changed since`) : "";
    facts.push(p.dim(`analysis ${view.analysisAge} ago`) + changed);
  }
  if (view.cached) facts.push(p.yellow("GitHub did not answer, showing cache"));
  if (facts.length > 0) lines.push(...flow(facts, "", style.width));
  if (view.next.length > 0) {
    lines.push("", p.bold("NEXT TO MERGE"));
    lines.push(...orderHeadlines(view.next, style, p));
  }
  return [lines.join("\n"), nextSection(hints, p, style)].join("\n\n");
}

export function renderErrorHuman(message: string, code: string, suggestions: string[], style: Style): string {
  const p = painter(style);
  const lines = [`${p.red(`${GLYPH.fail} ${message}`)} ${p.dim(`(${code})`)}`];
  for (const suggestion of suggestions) {
    lines.push(`  ${suggestion}`);
  }
  return lines.join("\n");
}

export function renderHelp(sections: Array<[title: string, rows: Array<[string, string] | string>]>, intro: string, style: Style): string {
  const p = painter(style);
  const out = [intro];
  for (const [title, rows] of sections) {
    const pairs = rows.filter((row): row is [string, string] => Array.isArray(row));
    const keyWidth = Math.min(48, Math.max(0, ...pairs.map(([key]) => key.length)));
    const body = rows.map((row) =>
      Array.isArray(row) ? `  ${row[1] ? padVisible(p.cyan(row[0]), keyWidth) + "  " + row[1] : p.cyan(row[0])}` : `  ${row}`,
    );
    out.push(`${p.bold(title)}\n${body.join("\n")}`);
  }
  return out.join("\n\n");
}

function repoBlock(analysis: RepoAnalysis, style: Style, p: Painter, now: Date): string {
  const lines: string[] = [];
  const shown = analysis.prs.length;
  const count = analysis.total > shown ? `showing ${shown} of ${analysis.total} open PRs` : `${shown} open ${shown === 1 ? "PR" : "PRs"}`;
  lines.push(`${p.bold(shortRepo(analysis.repo))}  ${count}${analysis.base ? p.dim(`  base ${analysis.base}`) : ""}`);
  if (shown === 0) {
    lines.push(p.dim("nothing to merge"));
    return lines.join("\n");
  }
  const ready = analysis.order.filter((item) => item.note.startsWith("ready")).length;
  const waiting = analysis.order.length - ready;
  const summary = [p.green(`${ready} ready`)];
  if (waiting > 0) summary.push(p.yellow(`${waiting} waiting`));
  summary.push(analysis.blocked.length > 0 ? p.red(`${analysis.blocked.length} blocked`) : p.dim("0 blocked"));
  const pairs = analysis.pairs.length;
  summary.push(pairs > 0 ? p.yellow(`${pairs} conflict ${pairs === 1 ? "pair" : "pairs"}`) : p.dim("no conflicts"));
  lines.push(...flow(summary, "", style.width));

  if (analysis.order.length > 0) {
    lines.push("", p.bold("MERGE ORDER"));
    const byNumber = new Map(analysis.prs.map((pr) => [pr.number, pr]));
    const layout = rowLayout(analysis.order.map((item) => byNumber.get(item.number)).filter(isDefined), style);
    for (const item of analysis.order) {
      const pr = byNumber.get(item.number);
      if (!pr) continue;
      lines.push(prRow(String(item.position), pr, layout, p, now));
      lines.push(
        ...flow(
          [checksText(pr.checks, pr.checkCounts, p), `${p.dim("review")} ${reviewText(pr.review, p)}`, p.dim(`base ${pr.base}`), p.dim(`updated ${age(pr.updatedAt, now)} ago`)],
          layout.indent,
          style.width,
        ),
      );
      lines.push(...flow([conflictNote(item, analysis, pr, p), p.dim(item.why)], layout.indent, style.width));
    }
  }

  if (analysis.blocked.length > 0) {
    lines.push("", p.bold("BLOCKED"));
    const byNumber = new Map(analysis.prs.map((pr) => [pr.number, pr]));
    const layout = rowLayout(analysis.blocked.map((item) => byNumber.get(item.number)).filter(isDefined), style);
    for (const item of analysis.blocked) {
      const pr = byNumber.get(item.number);
      if (!pr) continue;
      lines.push(prRow("", pr, layout, p, now));
      const details = [p.red(`${GLYPH.fail} ${item.reason}`)];
      if (pr.checks === "failing") details.push(checksText(pr.checks, pr.checkCounts, p));
      lines.push(...flow(details, layout.indent, style.width));
      if (pr.conflictsBase) {
        lines.push(`${layout.indent}${p.dim("files:")} ${files(pr.baseConflictFiles, style.width - layout.indent.length - 7)}`);
      }
    }
  }

  if (analysis.pairs.length > 0) {
    lines.push("", p.bold("CONFLICTS"));
    const labels = analysis.pairs.map((pair) => `#${pair.a} <-> #${pair.b}`);
    const width = Math.max(...labels.map((label) => label.length));
    analysis.pairs.forEach((pair, index) => {
      lines.push(`  ${padVisible(p.yellow(labels[index] ?? ""), width)}   ${files(pair.files, style.width - width - 5)}`);
    });
  }
  return lines.join("\n");
}

interface RowLayout {
  labelWidth: number;
  numberWidth: number;
  titleWidth: number;
  sizeWidth: number;
  authorWidth: number;
  indent: string;
}

function rowLayout(prs: PrAnalysis[], style: Style): RowLayout {
  const labelWidth = 2;
  const numberWidth = Math.max(...prs.map((pr) => `#${pr.number}`.length));
  const sizeWidth = Math.max(...prs.map((pr) => `+${pr.additions} -${pr.deletions}`.length));
  const authorWidth = Math.min(16, Math.max(...prs.map((pr) => pr.author.length)));
  const fixed = 2 + labelWidth + 2 + numberWidth + 2 + 2 + sizeWidth + 2 + 3 + 2 + authorWidth;
  return {
    labelWidth,
    numberWidth,
    sizeWidth,
    authorWidth,
    titleWidth: Math.max(16, style.width - fixed),
    indent: " ".repeat(2 + labelWidth + 2 + numberWidth + 2),
  };
}

function prRow(label: string, pr: PrAnalysis, layout: RowLayout, p: Painter, now: Date): string {
  const size = `${p.green(`+${pr.additions}`)} ${p.red(`-${pr.deletions}`)}`;
  return [
    "  ",
    padVisible(label, layout.labelWidth, "right"),
    "  ",
    padVisible(p.bold(`#${pr.number}`), layout.numberWidth),
    "  ",
    padVisible(truncate(pr.title, layout.titleWidth), layout.titleWidth),
    "  ",
    padVisible(size, layout.sizeWidth, "right"),
    "  ",
    padVisible(p.dim(age(pr.createdAt, now)), 3, "right"),
    "  ",
    p.dim(truncate(pr.author, layout.authorWidth)),
  ].join("");
}

function orderHeadlines(items: OrderItem[], style: Style, p: Painter): string[] {
  const numberWidth = Math.max(...items.map((item) => `#${item.number}`.length));
  return items.map((item) => {
    const note = item.note.startsWith("ready") && item.rebaseAfter.length === 0 ? p.green(item.note) : p.yellow(item.note);
    const titleWidth = Math.max(16, style.width - numberWidth - item.note.length - 12);
    return `  ${padVisible(String(item.position), 2, "right")}  ${padVisible(p.bold(`#${item.number}`), numberWidth)}  ${padVisible(truncate(item.title, titleWidth), titleWidth)}  ${note}`;
  });
}

function conflictNote(item: OrderItem, analysis: RepoAnalysis, pr: PrAnalysis, p: Painter): string {
  if (item.rebaseAfter.length > 0) {
    const shared = analysis.pairs
      .filter((pair) => item.rebaseAfter.some((other) => (pair.a === other && pair.b === pr.number) || (pair.b === other && pair.a === pr.number)))
      .flatMap((pair) => pair.files);
    const names = [...new Set(shared.map(basename))];
    const both = names.length > 0 ? ` (both touch ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""})` : "";
    return p.yellow(`${GLYPH.warn} rebase after ${item.rebaseAfter.map((n) => `#${n}`).join(" ")}${both}`);
  }
  if (pr.conflictsWith.length > 0) {
    const later = pr.conflictsWith.map((n) => `#${n}`).join(" ");
    return p.yellow(`${GLYPH.warn} conflicts with ${later}, which ${pr.conflictsWith.length === 1 ? "merges" : "merge"} later`);
  }
  return p.green(`${GLYPH.ok} no conflicts`);
}

function checksText(checks: Checks, counts: CheckCounts, p: Painter): string {
  const parts: string[] = [];
  if (counts.failing > 0) parts.push(p.red(`${GLYPH.fail} ${counts.failing} failing`));
  if (counts.pending > 0) parts.push(p.yellow(`${GLYPH.dot} ${counts.pending} pending`));
  if (counts.passing > 0) parts.push(p.green(`${GLYPH.ok} ${counts.passing} passing`));
  if (counts.skipped > 0) parts.push(p.dim(`${counts.skipped} skipped`));
  if (parts.length > 0) return parts.join(" ");
  switch (checks) {
    case "passing":
      return p.green(`${GLYPH.ok} checks passing`);
    case "failing":
      return p.red(`${GLYPH.fail} checks failing`);
    case "pending":
      return p.yellow(`${GLYPH.dot} checks pending`);
    default:
      return p.dim("no checks");
  }
}

function reviewText(review: string, p: Painter): string {
  switch (review) {
    case "approved":
      return p.green("approved");
    case "changes":
      return p.red("changes requested");
    case "required":
      return p.yellow("required");
    default:
      return p.dim("none");
  }
}

function sizeText(additions: number, deletions: number, p: Painter): string {
  return `${p.green(`+${additions}`)} ${p.red(`-${deletions}`)}`;
}

function nextSection(hints: Hint[], p: Painter, style: Style): string {
  const width = Math.max(...hints.map(([command]) => command.length));
  return [
    p.bold("NEXT"),
    ...hints.map(([command, description]) => `  ${padVisible(p.cyan(command), width)}  ${p.dim(truncate(description, Math.max(10, style.width - width - 4)))}`),
  ].join("\n");
}

// Joins parts with two spaces and wraps onto indented lines instead of running past the terminal width.
function flow(parts: string[], indent: string, width: number): string[] {
  const room = Math.max(10, width - indent.length);
  const lines: string[] = [];
  let current = "";
  for (const raw of parts) {
    const part = stripAnsi(raw).length > room ? truncate(stripAnsi(raw), room) : raw;
    const candidate = current ? `${current}  ${part}` : part;
    if (current && stripAnsi(candidate).length > room) {
      lines.push(indent + current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(indent + current);
  return lines;
}

function files(list: string[], width: number): string {
  if (list.length === 0) return "";
  const joined = list.join(" ");
  if (joined.length <= width) return joined;
  const shown: string[] = [];
  let used = 0;
  for (const file of list) {
    const suffix = ` (+${list.length - shown.length - 1} more)`;
    if (used + file.length + 1 + suffix.length > width && shown.length > 0) break;
    shown.push(file);
    used += file.length + 1;
  }
  const rest = list.length - shown.length;
  return rest > 0 ? `${truncate(shown.join(" "), width - 12)} (+${rest} more)` : truncate(shown.join(" "), width);
}

function truncateStart(text: string, max: number): string {
  return text.length > max && max > 3 ? `...${text.slice(text.length - max + 3)}` : text;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function shortRepo(slug: string): string {
  return slug.startsWith("github.com/") ? slug.slice("github.com/".length) : slug;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
