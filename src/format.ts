export function countLine(shown: number, total: number): number | string {
  return total > shown ? `${shown} of ${total} total` : shown;
}

export function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

export function size(additions: number, deletions: number): string {
  return `+${additions}/-${deletions}`;
}

export function prList(numbers: number[]): string {
  return numbers.length === 0 ? "none" : numbers.map((n) => `#${n}`).join(" ");
}

export function fileList(files: string[], max = 5): string {
  const shown = files.slice(0, max).join(" ");
  return files.length > max ? `${shown} (+${files.length - max} more)` : shown;
}

export function age(from: string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(from).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}
