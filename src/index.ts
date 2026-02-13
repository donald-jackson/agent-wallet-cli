import { Command } from 'commander';
import { getDefaultWalletDir } from './core/config.js';
import { registerInitCommand } from './commands/init.js';
import { registerImportCommand } from './commands/import.js';
import { registerUnlockCommand } from './commands/unlock.js';
import { registerLockCommand } from './commands/lock.js';
import { registerAddressCommand } from './commands/address.js';
import { registerBalanceCommand } from './commands/balance.js';
import { registerHistoryCommand } from './commands/history.js';
import { registerSendCommand } from './commands/send.js';
import { registerApproveCommand } from './commands/approve.js';
import { registerTransferFromCommand } from './commands/transfer-from.js';
import { registerAllowanceCommand } from './commands/allowance.js';
import { registerSignCommand } from './commands/sign.js';
import { registerNetworksCommand } from './commands/networks.js';
import { registerApprovalsCommand } from './commands/approvals.js';
import { registerExportCommand } from './commands/export.js';

const program = new Command();

program
  .name('agent-wallet-cli')
  .description('Cross-platform CLI wallet for Ethereum and Solana')
  .version('1.0.0')
  .option('--format <format>', 'Output format (json or text)', 'json')
  .option('--wallet-dir <path>', 'Wallet directory', getDefaultWalletDir())
  .option('--quiet', 'Suppress output');

registerInitCommand(program);
registerImportCommand(program);
registerUnlockCommand(program);
registerLockCommand(program);
registerAddressCommand(program);
registerBalanceCommand(program);
registerHistoryCommand(program);
registerSendCommand(program);
registerApproveCommand(program);
registerTransferFromCommand(program);
registerAllowanceCommand(program);
registerApprovalsCommand(program);
registerSignCommand(program);
registerNetworksCommand(program);
registerExportCommand(program);

program.parse();
