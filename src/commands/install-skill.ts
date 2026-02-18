import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Command } from 'commander';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';

const SKILL_CONTENT = `---
name: agent-wallet-cli
description: Manage crypto wallets (Ethereum & Solana) — create wallets, check balances, send tokens, sign messages. Supports gasless ERC-20 transfers via relay.
---

# agent-wallet-cli

A CLI wallet for Ethereum and Solana. All commands return JSON with \`--format json\`. Always check \`"ok": true\` before proceeding.

Always invoke via \`npx\` to ensure the CLI is available without requiring a global install:

\`\`\`bash
npx agent-wallet-cli <command> [options]
\`\`\`

## Create a Wallet

If no wallet exists yet, create one:

\`\`\`bash
npx agent-wallet-cli init --password "$WALLET_PASSWORD" --format json
\`\`\`

The response includes a \`mnemonic_file\` path containing the wallet's recovery phrase. You MUST:
1. Read the mnemonic file and present it to the user.
2. Instruct the user to back it up in a safe, offline location (e.g. written on paper, stored in a password manager).
3. Make clear that this mnemonic is the ONLY way to recover the wallet. It cannot be recovered by anyone — not by the CLI, not by any service, not by the developer. If it is lost, the funds are gone forever.
4. After the user confirms they have saved it, delete the mnemonic file.

Options: \`--word-count 12\` (default) or \`--word-count 24\` for a longer phrase.

## Unlock

The wallet must be unlocked before use. Unlock creates a time-limited session token:

\`\`\`bash
npx agent-wallet-cli unlock --password "$WALLET_PASSWORD" --format json
\`\`\`

Response:
\`\`\`json
{ "ok": true, "token": "wlt_...", "expires_at": "..." }
\`\`\`

Save the \`token\` value. Pass it to all subsequent commands with \`--token <token>\`, or set the environment variable:

\`\`\`bash
export AGENT_WALLET_CLI_TOKEN="wlt_..."
\`\`\`

## Check Balance

Native balance:
\`\`\`bash
npx agent-wallet-cli balance --token <token> --chain ethereum --network mainnet --format json
\`\`\`

ERC-20 / SPL token balance (use alias or contract address):
\`\`\`bash
npx agent-wallet-cli balance --token <token> --chain ethereum --network base --token-address usdc --format json
\`\`\`

## Send Funds

Native transfer:
\`\`\`bash
npx agent-wallet-cli send --token <token> --chain ethereum --to <address> --amount <amount> --yes --format json
\`\`\`

Token transfer:
\`\`\`bash
npx agent-wallet-cli send --token <token> --chain ethereum --token-address usdc --to <address> --amount <amount> --yes --format json
\`\`\`

Use \`--dry-run\` to simulate without sending. Always use \`--dry-run\` first when uncertain about amounts.

### Gasless Relay

Token transfers on EVM chains automatically use a gasless relay when the wallet has no native tokens (ETH/MATIC) for gas. The relay fee (e.g. 0.01 USDC) is deducted from the token amount. Check the response for:
- \`"relay_used": true\` — relay was used
- \`"relay_fee"\` — fee deducted
- \`"amount_received"\` — net amount sent after fee

To disable the relay for a specific transfer, add \`--no-relay\`.

## Show Addresses

Show all wallet addresses (Ethereum + Solana):
\`\`\`bash
npx agent-wallet-cli address --token <token> --format json
\`\`\`

Show a specific chain:
\`\`\`bash
npx agent-wallet-cli address --token <token> --chain ethereum --format json
\`\`\`

## Sign Messages

Plain text message:
\`\`\`bash
npx agent-wallet-cli sign --token <token> --chain ethereum --message "Hello World" --format json
\`\`\`

EIP-712 typed data (JSON string or file path with \`@\` prefix):
\`\`\`bash
npx agent-wallet-cli sign --token <token> --chain ethereum --typed-data '{"types":...}' --format json
npx agent-wallet-cli sign --token <token> --chain ethereum --typed-data @typed-data.json --format json
\`\`\`

Raw bytes (hex):
\`\`\`bash
npx agent-wallet-cli sign --token <token> --chain ethereum --data 0xdeadbeef --format json
\`\`\`

## ERC-20 Approve & Allowance

Approve a spender:
\`\`\`bash
npx agent-wallet-cli approve --token <token> --chain ethereum --token-address usdc --spender <address> --amount <amount> --yes --format json
\`\`\`

Check allowance (no session token needed):
\`\`\`bash
npx agent-wallet-cli allowance --chain ethereum --token-address usdc --owner <address> --spender <address> --format json
\`\`\`

Delegated transfer (transferFrom):
\`\`\`bash
npx agent-wallet-cli transfer-from --token <token> --chain ethereum --token-address usdc --from <owner> --to <recipient> --amount <amount> --yes --format json
\`\`\`

## Lock

Always lock the wallet when done:
\`\`\`bash
npx agent-wallet-cli lock --format json
\`\`\`

## Token Aliases

Use short names instead of contract addresses:

| Alias | Ethereum | Base | Polygon | Arbitrum | Solana |
|-------|----------|------|---------|----------|--------|
| usdc  | yes      | yes  | yes     | yes      | yes    |
| usdt  | yes      | -    | yes     | yes      | yes    |
| dai   | yes      | -    | -       | -        | -      |
| weth  | yes      | -    | -       | -        | -      |
| wbtc  | yes      | -    | -       | -        | -      |

## Conventions

- Always use \`--format json\` and parse the JSON output.
- Always check \`"ok": true\` in the response before proceeding.
- Use \`--yes\` to skip interactive confirmation prompts (required for non-interactive agent use).
- Never send more than the user instructed. Always confirm amounts with the user first.
- Use \`--dry-run\` for send commands when uncertain about the amount or recipient.
- Use \`--network\` to specify the network (default: \`mainnet\`). Available: mainnet, sepolia, polygon, arbitrum, base, base-sepolia.
- Solana networks: mainnet, devnet.
`;

export function registerInstallSkillCommand(program: Command): void {
  program
    .command('install-skill')
    .description('Install agent-wallet-cli as a Claude Code skill')
    .option('-g, --global', 'Install to ~/.claude/skills/ (user-wide) instead of ./.claude/skills/ (project)')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        const baseDir = opts.global
          ? join(homedir(), '.claude', 'skills', 'agent-wallet-cli')
          : join(process.cwd(), '.claude', 'skills', 'agent-wallet-cli');

        const filePath = join(baseDir, 'SKILL.md');

        await mkdir(baseDir, { recursive: true });
        await writeFile(filePath, SKILL_CONTENT, 'utf-8');

        outputSuccess(
          {
            message: `Skill installed successfully`,
            path: filePath,
            scope: opts.global ? 'global' : 'project',
          },
          format,
          quiet,
        );
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
