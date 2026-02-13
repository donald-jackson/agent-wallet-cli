# agent-wallet-cli

A cross-platform TypeScript CLI wallet for Ethereum and Solana, designed for AI agent integration.

## Risks & Security Warnings

**Read this section before using agent-wallet-cli.**

- **Experimental software.** This tool is provided as-is with no warranty. Use at your own risk.
- **Do not use on mainnet with significant funds** without reading and understanding the source code.
- **Mnemonic is displayed once on `init`.** Secure your terminal — anyone who sees it controls your funds.
- **Session tokens grant access to funds.** Treat them like passwords. Never log or share them.
- **JavaScript cannot guarantee secrets are purged from memory.** Buffers are zeroed on a best-effort basis, but the V8 garbage collector may retain copies.
- **`argon2` requires native bindings** (C compiler toolchain). It will not work in all environments (e.g., some Docker images, serverless runtimes).
- **Public RPCs may be rate-limited or unreliable.** Configure your own RPC endpoints for production use.
- **No security audit has been performed on this code.**

## Features

- **Multi-chain**: Ethereum (+ Polygon, Arbitrum, Base) and Solana
- **BIP-39 HD wallet**: 12 or 24-word mnemonic, multiple account indices
- **ERC-20 & SPL tokens**: balance, transfer, approve, transferFrom, allowance
- **Strong encryption**: Argon2id key derivation + AES-256-GCM
- **Session tokens**: Time-limited unlock (default 1h, max 24h) so agents don't need your password
- **Message signing**: Plain text, EIP-712 typed data, raw bytes
- **Transaction history**: Recent transactions with explorer links
- **Approval discovery**: Scan recent ERC-20 Approval events
- **JSON-first output**: Machine-readable by default, human-readable `--format text` option
- **Token aliases**: Use `usdc` instead of `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`

## Quick Start

```bash
# Create a new wallet
npx agent-wallet-cli init --password "my-secure-password"

# Unlock (creates a session token valid for 1 hour)
npx agent-wallet-cli unlock --password "my-secure-password"

# Check balance
npx agent-wallet-cli balance --token wlt_... --chain ethereum --network mainnet

# Send ETH
npx agent-wallet-cli send --token wlt_... --chain ethereum --to 0x... --amount 0.01

# Lock when done
npx agent-wallet-cli lock
```

## Installation

### npx (no install)

```bash
npx agent-wallet-cli <command> [options]
```

### npm global install

```bash
npm install -g agent-wallet-cli
agent-wallet-cli <command> [options]
```

### From source

```bash
git clone https://github.com/donald-jackson/agent-wallet-cli.git
cd agent-wallet-cli
npm install
npm run build
node dist/index.js <command> [options]
```

## Commands Reference

### Global Options

All commands accept these options:

| Flag | Description | Default |
|------|-------------|---------|
| `--format <format>` | Output format (`json` or `text`) | `json` |
| `--wallet-dir <path>` | Wallet storage directory | `~/.wallet-cli` |
| `--quiet` | Suppress output | |

### Wallet Management

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `init` | Create a new wallet | `--password` (required), `--word-count 12\|24`, `--name` |
| `import` | Import from mnemonic | `--password` (required), `--mnemonic` (required), `--name` |
| `unlock` | Create session token | `--password` (required), `--duration <seconds>`, `--name` |
| `lock` | Revoke session token | `--name` |
| `export` | Export mnemonic phrase | `--password` (required), `--confirm` (required), `--name` |

### Addresses & Balances

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `address` | Show wallet addresses | `--token`, `--chain`, `--account-index`, `--name` |
| `balance` | Query native or token balance | `--token`, `--chain` (required), `--network`, `--token-address`, `--account-index` |

### Transfers & Approvals

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `send` | Transfer native coin or token | `--token`, `--chain` (required), `--to` (required), `--amount` (required), `--token-address`, `--dry-run` |
| `approve` | Approve ERC-20/SPL spender | `--token`, `--chain` (required), `--token-address` (required), `--spender` (required), `--amount` (required) |
| `allowance` | Query approval amount | `--chain` (required), `--token-address` (required), `--owner` (required), `--spender` (required) |
| `transfer-from` | Delegated transfer | `--token`, `--chain` (required), `--token-address` (required), `--from` (required), `--to` (required), `--amount` (required) |
| `approvals` | Discover ERC-20 approvals | `--token`, `--chain`, `--network`, `--limit` |

### History & Signing

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `history` | List recent transactions | `--token`, `--chain` (required), `--network`, `--limit` |
| `sign` | Sign message or data | `--token`, `--chain` (required), `--message` / `--typed-data` / `--data` |

### Network Configuration

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `networks` | List or configure RPCs | `--set <chain:network>`, `--rpc-url <url>`, `--reset <chain:network>` |

## AI Agent Integration

### Using with OpenClaw

#### Option A: AgentSkill (recommended)

Create a skill file that teaches the agent how to use agent-wallet-cli. Place this as `wallet.md` in your OpenClaw skills directory:

```markdown
# Wallet Management Skill

You have access to `agent-wallet-cli`, a CLI wallet for Ethereum and Solana.

## Setup

The wallet is already initialized. To use it, first unlock with:
\`\`\`bash
agent-wallet-cli unlock --password "$WALLET_PASSWORD" --format json
\`\`\`
Save the `token` field from the JSON response. Pass it to all subsequent commands with `--token <token>`.

## Check Balance

\`\`\`bash
agent-wallet-cli balance --token <token> --chain ethereum --network mainnet --format json
\`\`\`

For ERC-20 tokens, add `--token-address <alias-or-address>`:
\`\`\`bash
agent-wallet-cli balance --token <token> --chain ethereum --network base --token-address usdc --format json
\`\`\`

## Send Funds

\`\`\`bash
agent-wallet-cli send --token <token> --chain ethereum --to <address> --amount <amount> --format json
\`\`\`

For tokens:
\`\`\`bash
agent-wallet-cli send --token <token> --chain ethereum --token-address usdc --to <address> --amount <amount> --format json
\`\`\`

Use `--dry-run` to simulate before sending.

## Show Addresses

\`\`\`bash
agent-wallet-cli address --token <token> --format json
\`\`\`

## Lock When Done

\`\`\`bash
agent-wallet-cli lock
\`\`\`

## Supported Token Aliases

Ethereum mainnet: usdc, usdt, dai, weth, wbtc
Base: usdc
Polygon: usdc, usdt
Arbitrum: usdc, usdt
Solana mainnet: usdc, usdt

## Important

- Always use `--format json` and parse the JSON response.
- Check `"ok": true` in the response before proceeding.
- Never send more than instructed. Always confirm amounts with the user first.
- Use `--dry-run` for sends when uncertain.
```

Reference it in your `openclaw.json`:

```json
{
  "skills": [
    {
      "name": "wallet",
      "file": "skills/wallet.md"
    }
  ]
}
```

#### Option B: Shell execution

OpenClaw agents with shell access can invoke agent-wallet-cli directly. Add instructions to your agent's system prompt:

```
You can manage crypto wallets using the `agent-wallet-cli` command.
All commands return JSON with an "ok" field. Always check "ok": true before proceeding.
First unlock the wallet: agent-wallet-cli unlock --password "$WALLET_PASSWORD" --format json
Then use the returned token for subsequent commands.
```

### Using with Other AI Agents

agent-wallet-cli is designed for programmatic use:

**JSON output** — all commands return structured JSON by default:

```json
{
  "ok": true,
  "balance": "1.5",
  "symbol": "ETH"
}
```

**Session token pattern** — unlock once, reuse the token:

```bash
# Unlock and capture token
TOKEN=$(agent-wallet-cli unlock --password "pass" --format json | jq -r '.token')

# Use token for subsequent commands
agent-wallet-cli balance --token "$TOKEN" --chain ethereum --format json
agent-wallet-cli send --token "$TOKEN" --chain ethereum --to 0x... --amount 0.01
```

**Environment variable** — set `WALLET_CLI_TOKEN` to avoid passing `--token` every time:

```bash
export WALLET_CLI_TOKEN=$(agent-wallet-cli unlock --password "pass" --format json | jq -r '.token')
agent-wallet-cli balance --chain ethereum
agent-wallet-cli send --chain ethereum --to 0x... --amount 0.01
```

## Supported Networks

### Ethereum

| Network | Chain ID | RPC | Explorer |
|---------|----------|-----|----------|
| mainnet | 1 | https://eth.llamarpc.com | https://etherscan.io |
| sepolia | 11155111 | https://rpc.sepolia.org | https://sepolia.etherscan.io |
| polygon | 137 | https://polygon-rpc.com | https://polygonscan.com |
| arbitrum | 42161 | https://arb1.arbitrum.io/rpc | https://arbiscan.io |
| base | 8453 | https://mainnet.base.org | https://basescan.org |
| base-sepolia | 84532 | https://sepolia.base.org | https://sepolia.basescan.org |

### Solana

| Network | RPC | Explorer |
|---------|-----|----------|
| mainnet | https://api.mainnet-beta.solana.com | https://explorer.solana.com |
| devnet | https://api.devnet.solana.com | https://explorer.solana.com |

## Security Model

### Keystore Encryption

Wallets are encrypted at rest using a two-layer scheme:

1. **Key derivation**: Argon2id (time_cost=3, memory_cost=64 MB, parallelism=4) derives a 32-byte key from your password + random salt
2. **Encryption**: AES-256-GCM encrypts the mnemonic with a random 12-byte IV and produces a 16-byte authentication tag

Keystore files are stored in `~/.wallet-cli/keystores/` with `0600` permissions.

### Session Tokens

When you `unlock`, the CLI:
1. Decrypts the mnemonic with your password
2. Re-encrypts it with a random session key (via HKDF-SHA256)
3. Returns a token (`wlt_` prefix) containing token ID + token secret
4. Validates tokens using HMAC-SHA256

Tokens expire after the configured duration (default 1 hour, max 24 hours). Session files are stored with `0600` permissions.

### Memory Clearing

All sensitive buffers (mnemonic bytes, derived keys, decrypted material) are zeroed after use via `try/finally` blocks. This is best-effort — the JavaScript runtime cannot guarantee that the garbage collector hasn't copied the data.

### File Permissions

- Keystore files: `0600` (owner read/write only)
- Session files: `0600`
- Wallet directories: `0700` (owner only)

## Token Aliases

Use token names instead of contract addresses:

### Ethereum

| Alias | Mainnet | Polygon | Arbitrum | Base |
|-------|---------|---------|----------|------|
| `usdc` | `0xA0b8...eB48` | `0x3c49...3359` | `0xaf88...5831` | `0x8335...2913` |
| `usdt` | `0xdAC1...1ec7` | `0xc213...8e8F` | `0xFd08...cbb9` | — |
| `dai` | `0x6B17...1d0F` | — | — | — |
| `weth` | `0xC02a...6Cc2` | — | — | — |
| `wbtc` | `0x2260...C599` | — | — | — |

### Solana

| Alias | Mainnet | Devnet |
|-------|---------|--------|
| `usdc` | `EPjFW...Dt1v` | `4zMMC...ncDU` |
| `usdt` | `Es9vM...wNYB` | — |

## Configuration

### Custom RPC Endpoints

```bash
# Set a custom RPC
agent-wallet-cli networks --set ethereum:mainnet --rpc-url https://your-rpc.example.com

# Reset to default
agent-wallet-cli networks --reset ethereum:mainnet

# List all configured networks
agent-wallet-cli networks
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `WALLET_CLI_TOKEN` | Session token (avoids `--token` flag on every command) |

## Development

### Build from source

```bash
git clone https://github.com/donald-jackson/agent-wallet-cli.git
cd agent-wallet-cli
npm install
npm run build
```

### Run tests

```bash
npm test
```

### Project structure

```
src/
  index.ts          # CLI entry point (Commander.js)
  commands/         # Command implementations (one file per command)
  chains/           # Chain adapters (Ethereum via viem, Solana via @solana/web3.js)
  core/             # Keystore, session management, mnemonic derivation, config
  security/         # Encryption (Argon2id + AES-256-GCM), memory clearing, file permissions
  output/           # JSON/text formatters, error codes
tests/
  unit/             # Unit tests for encryption, keystore, mnemonic, memory, session, config
  integration/      # End-to-end CLI flow tests
```

## License

MIT — see [LICENSE](./LICENSE).
