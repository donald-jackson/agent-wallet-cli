import { WalletError, type ErrorCode } from './errors.js';

export type OutputFormat = 'json' | 'text';

export interface SuccessResult {
  ok: true;
  [key: string]: unknown;
}

export interface ErrorResult {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
  };
}

export type Result = SuccessResult | ErrorResult;

function formatTextOutput(data: Record<string, unknown>, indent = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);
  for (const [key, value] of Object.entries(data)) {
    if (key === 'ok') continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${prefix}${key}:`);
      lines.push(formatTextOutput(value as Record<string, unknown>, indent + 1));
    } else if (Array.isArray(value)) {
      lines.push(`${prefix}${key}:`);
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          lines.push(formatTextOutput(item as Record<string, unknown>, indent + 1));
          lines.push('');
        } else {
          lines.push(`${prefix}  - ${item}`);
        }
      }
    } else {
      lines.push(`${prefix}${key}: ${value}`);
    }
  }
  return lines.join('\n');
}

export function outputSuccess(data: Record<string, unknown>, format: OutputFormat, quiet = false): void {
  if (quiet) return;
  const result: SuccessResult = { ok: true, ...data };
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatTextOutput(result));
  }
}

export function outputError(error: unknown, format: OutputFormat, quiet = false): void {
  let code: ErrorCode = 'ERR_INTERNAL';
  let message = 'An unexpected error occurred';

  if (error instanceof WalletError) {
    code = error.code;
    message = error.message;
  } else if (error instanceof Error) {
    message = error.message;
  }

  const result: ErrorResult = {
    ok: false,
    error: { code, message },
  };

  if (format === 'json') {
    console.error(JSON.stringify(result, null, 2));
  } else {
    if (!quiet) {
      console.error(`Error [${code}]: ${message}`);
    }
  }

  process.exitCode = 1;
}
