import { createInterface } from 'node:readline';

/**
 * Read a line from stdin with echo disabled (for passwords).
 * Falls back to normal readline if stdin is not a TTY (piped input).
 * Returns empty string if stdin closes without input.
 */
export async function readSecretFromStdin(prompt: string): Promise<string> {
  // TTY mode: disable echo for password entry
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stderr.write(prompt);
    return new Promise<string>((resolve) => {
      let input = '';
      process.stdin.setRawMode!(true);
      process.stdin.resume();
      process.stdin.on('data', function handler(chunk: Buffer) {
        const char = chunk.toString();
        if (char === '\n' || char === '\r' || char === '\u0004') {
          process.stdin.setRawMode!(false);
          process.stdin.pause();
          process.stdin.removeListener('data', handler);
          process.stderr.write('\n');
          resolve(input);
        } else if (char === '\u0003') {
          // Ctrl+C
          process.stdin.setRawMode!(false);
          process.exit(130);
        } else if (char === '\u007F' || char === '\b') {
          // Backspace
          input = input.slice(0, -1);
        } else {
          input += char;
        }
      });
    });
  }

  // Non-TTY: read a line from piped input
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: false,
  });

  return new Promise<string>((resolve) => {
    let answered = false;
    rl.question(prompt, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    rl.on('close', () => {
      if (!answered) resolve('');
    });
  });
}

/**
 * Read a line from stdin with echo enabled (for mnemonic input).
 * Returns empty string if stdin closes without input.
 */
export async function readLineFromStdin(prompt: string): Promise<string> {
  if (process.stdin.isTTY) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    return new Promise<string>((resolve) => {
      let answered = false;
      rl.question(prompt, (answer) => {
        answered = true;
        rl.close();
        resolve(answer.trim());
      });
      rl.on('close', () => {
        if (!answered) resolve('');
      });
    });
  }

  // Non-TTY: read a line from piped input
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: false,
  });

  return new Promise<string>((resolve) => {
    let answered = false;
    rl.question(prompt, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
    rl.on('close', () => {
      if (!answered) resolve('');
    });
  });
}

/**
 * Display transaction details and prompt the user for confirmation.
 * Returns true if the user confirms, false otherwise.
 * In non-TTY mode, always returns false (caller should require --yes).
 */
export async function confirmTransaction(details: Record<string, string>): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return false;
  }

  process.stderr.write('\n  Transaction Details:\n');
  for (const [key, value] of Object.entries(details)) {
    process.stderr.write(`    ${key}: ${value}\n`);
  }
  process.stderr.write('\n');

  const answer = await readLineFromStdin('  Confirm transaction? (yes/no): ');
  return answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y';
}

/**
 * Emit a security warning to stderr when secrets are passed as CLI arguments.
 */
export function warnCliArgSecret(argName: string): void {
  process.stderr.write(
    `\n⚠  WARNING: --${argName} was passed as a CLI argument. ` +
    `This is visible in shell history and process listings. ` +
    `Omit --${argName} to be prompted securely.\n\n`,
  );
}
