import type { Command } from 'commander';
import { generateMnemonic, validateMnemonic, deriveAddresses } from '../core/mnemonic.js';
import { createKeystore } from '../core/keystore.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';
import { clearBuffer } from '../security/memory.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Create a new wallet')
    .option('--password <password>', 'Encryption password')
    .option('--word-count <count>', 'Mnemonic word count (12 or 24)', '12')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        if (!opts.password) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Password is required (--password)');
        }

        const wordCount = parseInt(opts.wordCount) as 12 | 24;
        if (wordCount !== 12 && wordCount !== 24) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Word count must be 12 or 24');
        }

        const mnemonic = generateMnemonic(wordCount);
        const keystore = await createKeystore(walletDir, opts.name, mnemonic, opts.password);
        const addresses = deriveAddresses(mnemonic, 0);

        outputSuccess(
          {
            name: keystore.name,
            mnemonic,
            addresses: {
              ethereum: addresses.ethereum,
              solana: addresses.solana,
            },
            warning: 'SAVE YOUR MNEMONIC. It will not be shown again.',
          },
          format,
          quiet,
        );
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
