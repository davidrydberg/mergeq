import type { Result } from "../output.js";
import type { Style } from "../style.js";

export interface CommandResult extends Result {
  json?: unknown;
  pretty?: (style: Style) => string;
}
