import type { Command } from 'commander';
import { decryptKeystore } from '../core/keystore.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';

export function registerExportCommand(program: Command): void {
  program
    .command('export')
    .description('Export mnemonic (requires password, not just session token)')
    .option('--password <password>', 'Wallet password')
    .option('--name <name>', 'Wallet name', 'default')
    .option('--confirm', 'Confirm export (required)')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        if (!opts.password) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Password is required (--password)');
        }
        if (!opts.confirm) {
          throw new WalletError(
            ErrorCodes.ERR_EXPORT_NOT_CONFIRMED,
            'Export requires --confirm flag. This will display your mnemonic phrase.',
          );
        }

        const mnemonic = await decryptKeystore(walletDir, opts.name, opts.password);

        outputSuccess(
          {
            name: opts.name,
            mnemonic,
            warning: 'Keep your mnemonic safe. Anyone with access to it can control your funds.',
          },
          format,
          quiet,
        );
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
