import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execFile);
const CLI = join(import.meta.dirname, '../../dist/index.js');

// Strong password that meets C3 validation requirements
const STRONG_PW = 'Test-P@ssw0rd!99';

function extractJson(text: string): any | null {
  // Find the first { and last } to extract JSON from mixed output (warnings + JSON)
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function run(args: string[], walletDir: string): Promise<{ ok: boolean; data: any }> {
  try {
    const { stdout, stderr } = await execAsync('node', [CLI, '--wallet-dir', walletDir, '--format', 'json', ...args], {
      timeout: 60000,
    });
    const data = extractJson(stdout) ?? extractJson(stderr);
    if (!data) return { ok: false, data: {} };
    return { ok: data.ok, data };
  } catch (error: any) {
    const combined = (error.stdout || '') + (error.stderr || '');
    const data = extractJson(combined);
    if (data) return { ok: data.ok ?? false, data };
    return { ok: false, data: { error: error.message } };
  }
}

describe('full CLI flow', () => {
  let walletDir: string;

  beforeEach(async () => {
    walletDir = await mkdtemp(join(tmpdir(), 'agent-wallet-cli-integration-'));
  });

  afterEach(async () => {
    await rm(walletDir, { recursive: true, force: true });
  });

  it('should show help', async () => {
    const { stdout } = await execAsync('node', [CLI, '--help']);
    expect(stdout).toContain('agent-wallet-cli');
    expect(stdout).toContain('init');
    expect(stdout).toContain('send');
  });

  it('should create wallet, unlock, show address, lock', async () => {
    // Init — mnemonic is now in a file, not stdout
    const init = await run(['init', '--password', STRONG_PW, '--name', 'mytest'], walletDir);
    expect(init.ok).toBe(true);
    expect(init.data.mnemonic).toBeUndefined(); // C1: no mnemonic in stdout
    expect(init.data.mnemonic_file).toBeTruthy();
    expect(init.data.addresses.ethereum).toMatch(/^0x/);
    expect(init.data.addresses.solana).toBeTruthy();

    // Read mnemonic from the secure file
    const mnemonic = (await readFile(init.data.mnemonic_file, 'utf-8')).trim();
    expect(mnemonic.split(' ').length).toBe(12);

    // Unlock — token is returned in output, NOT persisted to disk (C6)
    const unlock = await run(['unlock', '--password', STRONG_PW, '--name', 'mytest'], walletDir);
    expect(unlock.ok).toBe(true);
    expect(unlock.data.token).toMatch(/^wlt_/);
    const token = unlock.data.token;

    // Address — must pass --token explicitly now (C6)
    const addr = await run(['address', '--token', token, '--name', 'mytest'], walletDir);
    expect(addr.ok).toBe(true);
    expect(addr.data.addresses.ethereum).toBe(init.data.addresses.ethereum);
    expect(addr.data.addresses.solana).toBe(init.data.addresses.solana);

    // Address - specific chain
    const ethAddr = await run(['address', '--token', token, '--name', 'mytest', '--chain', 'ethereum'], walletDir);
    expect(ethAddr.ok).toBe(true);
    expect(ethAddr.data.address).toBe(init.data.addresses.ethereum);

    // Lock
    const lock = await run(['lock', '--name', 'mytest'], walletDir);
    expect(lock.ok).toBe(true);

    // Address should fail after lock
    const addrFail = await run(['address', '--token', token, '--name', 'mytest'], walletDir);
    expect(addrFail.ok).toBe(false);
  });

  it('should import wallet from mnemonic', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    const result = await run(['import', '--password', STRONG_PW, '--mnemonic', mnemonic, '--name', 'imported'], walletDir);
    expect(result.ok).toBe(true);
    expect(result.data.addresses.ethereum).toMatch(/^0x/);
  });

  it('should export mnemonic with password + confirm', async () => {
    const init = await run(['init', '--password', STRONG_PW, '--name', 'exportme'], walletDir);
    expect(init.ok).toBe(true);

    // Read the mnemonic from the file for comparison
    const expectedMnemonic = (await readFile(init.data.mnemonic_file, 'utf-8')).trim();

    // Export without --confirm should fail
    const noConfirm = await run(['export', '--password', STRONG_PW, '--name', 'exportme'], walletDir);
    expect(noConfirm.ok).toBe(false);

    // Export with --confirm
    const exported = await run(['export', '--password', STRONG_PW, '--name', 'exportme', '--confirm'], walletDir);
    expect(exported.ok).toBe(true);
    expect(exported.data.mnemonic).toBe(expectedMnemonic);
  });

  it('should list networks', async () => {
    const result = await run(['networks'], walletDir);
    expect(result.ok).toBe(true);
    expect(result.data.networks.length).toBeGreaterThan(0);
    const ethMainnet = result.data.networks.find((n: any) => n.chain === 'ethereum' && n.network === 'mainnet');
    expect(ethMainnet).toBeTruthy();
    expect(ethMainnet.rpc_url).toBeTruthy();
  });

  it('should sign a message on ethereum', async () => {
    await run(['init', '--password', STRONG_PW, '--name', 'signer'], walletDir);
    const unlock = await run(['unlock', '--password', STRONG_PW, '--name', 'signer'], walletDir);
    const token = unlock.data.token;

    const signed = await run(['sign', '--token', token, '--name', 'signer', '--chain', 'ethereum', '--message', 'Hello World'], walletDir);
    expect(signed.ok).toBe(true);
    expect(signed.data.signature).toMatch(/^0x/);
    expect(signed.data.address).toMatch(/^0x/);
  });

  it('should sign a message on solana', async () => {
    await run(['init', '--password', STRONG_PW, '--name', 'solsigner'], walletDir);
    const unlock = await run(['unlock', '--password', STRONG_PW, '--name', 'solsigner'], walletDir);
    const token = unlock.data.token;

    const signed = await run(['sign', '--token', token, '--name', 'solsigner', '--chain', 'solana', '--message', 'Hello Solana'], walletDir);
    expect(signed.ok).toBe(true);
    expect(signed.data.signature).toBeTruthy();
    expect(signed.data.public_key).toBeTruthy();
  });

  it('should reject init without password when stdin is not a TTY', async () => {
    // Pipe empty stdin so the process doesn't hang waiting for input
    const { spawn } = await import('node:child_process');
    const result = await new Promise<{ ok: boolean; data: any }>((resolve) => {
      const child = spawn('node', [CLI, '--wallet-dir', walletDir, '--format', 'json', 'init'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      // Immediately close stdin so readline resolves with empty string
      child.stdin.end();
      child.on('close', () => {
        const data = extractJson(stdout) ?? extractJson(stderr);
        resolve({ ok: data?.ok ?? false, data: data ?? {} });
      });
    });
    expect(result.ok).toBe(false);
  });

  it('should reject wrong password on unlock', async () => {
    await run(['init', '--password', STRONG_PW, '--name', 'locked'], walletDir);
    const result = await run(['unlock', '--password', 'Wr0ng-P@ssword!', '--name', 'locked'], walletDir);
    expect(result.ok).toBe(false);
  });

  it('should reject weak passwords on init', async () => {
    const result = await run(['init', '--password', 'weak', '--name', 'weaktest'], walletDir);
    expect(result.ok).toBe(false);
    expect(result.data.error?.message).toContain('Password too weak');
  });

  it('should reject weak passwords on import', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const result = await run(['import', '--password', 'short', '--mnemonic', mnemonic, '--name', 'weakimport'], walletDir);
    expect(result.ok).toBe(false);
    expect(result.data.error?.message).toContain('Password too weak');
  });

  it('should lock out after repeated failed unlock attempts (C4)', async () => {
    await run(['init', '--password', STRONG_PW, '--name', 'lockme'], walletDir);

    // Fail 5 times with wrong password
    for (let i = 0; i < 5; i++) {
      const result = await run(['unlock', '--password', 'Wr0ng-P@ssword!', '--name', 'lockme'], walletDir);
      expect(result.ok).toBe(false);
    }

    // 6th attempt should be locked out even with the correct password
    const locked = await run(['unlock', '--password', STRONG_PW, '--name', 'lockme'], walletDir);
    expect(locked.ok).toBe(false);
    expect(locked.data.error?.code).toBe('ERR_WALLET_LOCKED');
  });

  it('should clear lockout after successful unlock', async () => {
    await run(['init', '--password', STRONG_PW, '--name', 'clearme'], walletDir);

    // Fail twice
    await run(['unlock', '--password', 'Wr0ng-P@ssword!', '--name', 'clearme'], walletDir);
    await run(['unlock', '--password', 'Wr0ng-P@ssword!', '--name', 'clearme'], walletDir);

    // Wait for backoff to expire (2^1 = 2 seconds for 2nd failure)
    await new Promise((r) => setTimeout(r, 2500));

    // Succeed — should clear lockout
    const success = await run(['unlock', '--password', STRONG_PW, '--name', 'clearme'], walletDir);
    expect(success.ok).toBe(true);

    // Fail again — counter should be reset, no lockout
    const fail = await run(['unlock', '--password', 'Wr0ng-P@ssword!', '--name', 'clearme'], walletDir);
    expect(fail.ok).toBe(false);
    expect(fail.data.error?.code).toBe('ERR_WRONG_PASSWORD');
  });

  it('should require --token for commands after unlock (C6 - no token file)', async () => {
    await run(['init', '--password', STRONG_PW, '--name', 'nofile'], walletDir);
    await run(['unlock', '--password', STRONG_PW, '--name', 'nofile'], walletDir);

    // Address without --token should fail (no token file to fall back to)
    const result = await run(['address', '--name', 'nofile'], walletDir);
    expect(result.ok).toBe(false);
    expect(result.data.error?.code).toBe('ERR_NO_TOKEN');
  });

  it('should handle text output format', async () => {
    const { stdout } = await execAsync('node', [CLI, '--wallet-dir', walletDir, '--format', 'text', 'networks']);
    expect(stdout).toContain('networks:');
  });
});
