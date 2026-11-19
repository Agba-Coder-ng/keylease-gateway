/** A CLI usage, configuration or validation error with a stable code. */
export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(message: string, code = 'usage_error', exitCode = 2) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = exitCode;
  }
}
