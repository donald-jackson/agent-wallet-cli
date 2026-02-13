import type { Command } from 'commander';
import { revokeSession } from '../core/session.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';

export function registerLockCommand(program: Command): void {
  program
    .command('lock')
    .description('Revoke session token (lock wallet)')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        await revokeSession(walletDir, opts.name);
        outputSuccess({ message: `Wallet "${opts.name}" locked` }, format, quiet);
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
