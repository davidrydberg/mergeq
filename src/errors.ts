export class CliError extends Error {
  readonly code: string;
  readonly suggestions: string[];

  constructor(message: string, code: string, suggestions: string[] = []) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.suggestions = suggestions;
  }
}

export function exitCodeFor(error: unknown): number {
  return error instanceof CliError && error.code === "VALIDATION_ERROR" ? 2 : 1;
}
