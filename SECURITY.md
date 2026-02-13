# Security Audit Report — agent-wallet-cli v1.0.1

**Audit Date:** 2026-02-13
**Scope:** Full source code review of all TypeScript source files
**Risk Level:** MODERATE — critical issues have been addressed; remaining high-severity items should be resolved before production use with significant funds.

---

## Executive Summary

agent-wallet-cli is a cryptocurrency wallet CLI tool supporting Ethereum and Solana. The architecture implements strong security practices including Argon2id key derivation (time_cost=6, 64MB), AES-256-GCM authenticated encryption, HKDF-derived session keys, file permission enforcement (0600/0700), best-effort memory clearing, password strength validation, brute-force lockout protection, and secure stdin-based secret input.

The following critical issues have been resolved:

- **C1 (Fixed):** Mnemonic is now written to a 0600-permission file instead of stdout.
- **C2 (Fixed):** Secrets are read from stdin with echo disabled; CLI arg usage emits a warning.
- **C3 (Fixed):** Passwords require 12+ characters, uppercase, lowercase, digit, and special character.
- **C4 (Fixed):** Unlock attempts are rate-limited with exponential backoff and 15-minute lockout after 5 failures.
- **C6 (Fixed):** Session tokens are no longer persisted to disk.
- **H1 (Fixed):** Argon2id time_cost increased from 3 to 6.
- **H3 (Fixed):** Transaction commands now require interactive confirmation; `--yes` flag available for automation.
- **H4 (Fixed):** Session HMAC now covers the full canonical session object, not just the token ID.

The remaining issues are documented below.

---

## Critical Severity

### C5: RPC URL Injection / SSRF via Environment Variables

**File:** `src/core/config.ts:136-143`

RPC URLs are loaded from environment variables without any validation of the URL scheme, host, or format:

```typescript
const envKey = `AGENT_WALLET_CLI_RPC_${chain.toUpperCase()}_${network.toUpperCase()}`;
const envUrl = process.env[envKey];
if (envUrl) {
  netConfig.rpcUrl = envUrl;
}
```

These URLs are then used directly for HTTP requests (`viem` transport, `fetch()` calls) that carry wallet addresses and signed transactions.

**Impact:** An attacker who can set environment variables (shared hosting, compromised CI, container escape) can redirect all RPC traffic to an attacker-controlled server, enabling:
- Transaction interception and modification
- Address and balance exfiltration
- Replaying signed transactions to different endpoints

**Recommendation:** Validate that RPC URLs use HTTPS. Consider maintaining an allow-list of trusted RPC domains. Warn users when non-default RPC endpoints are active. Log the active RPC URL at startup.

---

## High Severity

### H2: No HTTPS Enforcement on RPC and Explorer API Calls

**Files:** `src/chains/ethereum.ts:49-53`, `src/chains/ethereum.ts:539-540`, `src/chains/solana.ts:40`

RPC and API URLs are used as-is with no scheme validation:

```typescript
transport: http(rpcUrl), // No check that rpcUrl is https://
```

```typescript
const url = `${explorerApiUrl}?module=account&action=txlist&address=${address}&...`;
const response = await fetch(url); // No HTTPS check
```

**Impact:** HTTP (non-TLS) connections allow man-in-the-middle attacks that can intercept wallet addresses, modify transaction data, or inject false balance/history information.

**Recommendation:** Reject RPC URLs that do not start with `https://`. Allow an explicit `--insecure` flag for local development only.

---

### H5: Keystore File Parsed Without Schema Validation

**File:** `src/core/keystore.ts:82-83`

Keystore files are deserialized with a bare `JSON.parse()` and an unchecked type assertion:

```typescript
const data = await readFile(keystorePath, 'utf-8');
return JSON.parse(data) as KeystoreFile;
```

**Impact:** A corrupted or maliciously crafted keystore file could cause unexpected runtime errors, or trick the decryption routine into operating on attacker-controlled data.

**Recommendation:** Validate the parsed JSON against a schema (e.g., using `zod`) before returning. Check that `version`, `kdf`, `cipher`, and other required fields are present and have the expected types.

---

### H6: No Address Format Validation on Send

**File:** `src/commands/send.ts:31-33`

The `--to` address is checked for presence but not for format correctness:

```typescript
if (!opts.to) {
  throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Recipient is required (--to)');
}
```

No validation is performed to ensure the address matches the target chain format. Ethereum EIP-55 checksums are not verified.

**Impact:** Funds sent to malformed or wrong-chain addresses may be permanently lost.

**Recommendation:** Validate Ethereum addresses (0x prefix, 40 hex chars, EIP-55 checksum). Validate Solana addresses (base58, 32-44 chars). Reject addresses that don't match the selected chain.

---

## Positive Security Findings

The following security practices are implemented and should be maintained:

1. **Argon2id KDF** — memory-hard password hashing with time_cost=6, 64MB memory (`src/security/encryption.ts`)
2. **AES-256-GCM** — authenticated encryption with random IVs (`src/security/encryption.ts`)
3. **HKDF-SHA256** — proper session key derivation from token secrets (`src/core/session.ts`)
4. **Best-effort memory clearing** — `clearBuffer()` and `clearUint8Array()` on sensitive Buffers (`src/security/memory.ts`)
5. **File permission enforcement** — 0700 directories, 0600 files on Unix systems (`src/security/permissions.ts`)
6. **Session expiry** — tokens have a maximum lifetime of 24 hours (`src/core/session.ts`)
7. **HMAC session integrity** — full session object authenticated with HMAC-SHA256 using canonical JSON serialization (`src/core/session.ts`)
8. **Solana secret key cleanup** — `finally` blocks consistently zero Solana keypair secret keys (`src/chains/solana.ts`)
9. **Password strength enforcement** — 12+ characters with uppercase, lowercase, digit, and special character required (`src/security/password.ts`)
10. **Secure secret input** — passwords read from stdin with echo disabled; CLI arg usage emits warnings (`src/security/input.ts`)
11. **Brute-force protection** — exponential backoff and 15-minute lockout after 5 failed unlock attempts (`src/security/lockout.ts`)
12. **No token persistence** — session tokens are not written to disk (`src/core/session.ts`)
13. **Mnemonic file isolation** — mnemonic written to a 0600 file on init, never output to stdout (`src/commands/init.ts`)
14. **Transaction confirmation** — `send`, `approve`, and `transfer-from` require interactive confirmation; `--yes` flag for automation (`src/commands/send.ts`, `src/commands/approve.ts`, `src/commands/transfer-from.ts`)

---

## Recommended Remediation Priority

| Priority | Issue | Effort |
|----------|-------|--------|
| 1 | C5: RPC URL validation (HTTPS) | Low |
| 2 | H2: HTTPS enforcement on all URLs | Low |
| 3 | H6: Address format validation | Low |
| 4 | H5: Keystore schema validation | Low |

---

## Deployment Guidance

**Safe for:** Testnet usage, development, educational purposes, small-value transactions with understood risks.

**Recommended before production use with significant funds:** Resolve C5, H2, H5, and H6.

---

## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly by opening a private security advisory at:
https://github.com/donald-jackson/agent-wallet-cli/security/advisories/new
