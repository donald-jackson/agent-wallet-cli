import type { Command } from 'commander';
import { validateMnemonic, deriveAddresses } from '../core/mnemonic.js';
import { createKeystore } from '../core/keystore.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Import wallet from mnemonic')
    .option('--password <password>', 'Encryption password')
    .option('--mnemonic <mnemonic>', 'BIP-39 mnemonic phrase')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        if (!opts.password) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Password is required (--password)');
        }
        if (!opts.mnemonic) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Mnemonic is required (--mnemonic)');
        }

        const mnemonic = opts.mnemonic.trim();
        if (!validateMnemonic(mnemonic)) {
          throw new WalletError(ErrorCodes.ERR_INVALID_MNEMONIC, 'Invalid BIP-39 mnemonic');
        }

        const keystore = await createKeystore(walletDir, opts.name, mnemonic, opts.password);
        const addresses = deriveAddresses(mnemonic, 0);

        outputSuccess(
          {
            name: keystore.name,
            addresses: {
              ethereum: addresses.ethereum,
              solana: addresses.solana,
            },
          },
          format,
          quiet,
        );
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
