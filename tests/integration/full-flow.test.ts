import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execFile);
const CLI = join(import.meta.dirname, '../../dist/index.js');

async function run(args: string[], walletDir: string): Promise<{ ok: boolean; data: any }> {
  try {
    const { stdout, stderr } = await execAsync('node', [CLI, '--wallet-dir', walletDir, '--format', 'json', ...args], {
      timeout: 60000,
    });
    const output = stdout.trim() || stderr.trim();
    if (!output) return { ok: false, data: {} };
    const data = JSON.parse(output);
    return { ok: data.ok, data };
  } catch (error: any) {
    const output = (error.stdout || error.stderr || '').trim();
    if (output) {
      try {
        const data = JSON.parse(output);
        return { ok: data.ok ?? false, data };
      } catch {
        return { ok: false, data: { raw: output } };
      }
    }
    return { ok: false, data: { error: error.message } };
  }
}

describe('full CLI flow', () => {
  let walletDir: string;

  beforeEach(async () => {
    walletDir = await mkdtemp(join(tmpdir(), 'wallet-cli-integration-'));
  });

  afterEach(async () => {
    await rm(walletDir, { recursive: true, force: true });
  });

  it('should show help', async () => {
    const { stdout } = await execAsync('node', [CLI, '--help']);
    expect(stdout).toContain('wallet-cli');
    expect(stdout).toContain('init');
    expect(stdout).toContain('send');
  });

  it('should create wallet, unlock, show address, lock', async () => {
    // Init
    const init = await run(['init', '--password', 'test123', '--name', 'mytest'], walletDir);
    expect(init.ok).toBe(true);
    expect(init.data.mnemonic).toBeTruthy();
    expect(init.data.addresses.ethereum).toMatch(/^0x/);
    expect(init.data.addresses.solana).toBeTruthy();

    // Unlock
    const unlock = await run(['unlock', '--password', 'test123', '--name', 'mytest'], walletDir);
    expect(unlock.ok).toBe(true);
    expect(unlock.data.token).toMatch(/^wlt_/);
    const token = unlock.data.token;

    // Address
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

    const result = await run(['import', '--password', 'pw123', '--mnemonic', mnemonic, '--name', 'imported'], walletDir);
    expect(result.ok).toBe(true);
    expect(result.data.addresses.ethereum).toMatch(/^0x/);
  });

  it('should export mnemonic with password + confirm', async () => {
    const init = await run(['init', '--password', 'pw', '--name', 'exportme'], walletDir);
    expect(init.ok).toBe(true);

    // Export without --confirm should fail
    const noConfirm = await run(['export', '--password', 'pw', '--name', 'exportme'], walletDir);
    expect(noConfirm.ok).toBe(false);

    // Export with --confirm
    const exported = await run(['export', '--password', 'pw', '--name', 'exportme', '--confirm'], walletDir);
    expect(exported.ok).toBe(true);
    expect(exported.data.mnemonic).toBe(init.data.mnemonic);
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
    const init = await run(['init', '--password', 'pw', '--name', 'signer'], walletDir);
    const unlock = await run(['unlock', '--password', 'pw', '--name', 'signer'], walletDir);
    const token = unlock.data.token;

    const signed = await run(['sign', '--token', token, '--name', 'signer', '--chain', 'ethereum', '--message', 'Hello World'], walletDir);
    expect(signed.ok).toBe(true);
    expect(signed.data.signature).toMatch(/^0x/);
    expect(signed.data.address).toMatch(/^0x/);
  });

  it('should sign a message on solana', async () => {
    const init = await run(['init', '--password', 'pw', '--name', 'solsigner'], walletDir);
    const unlock = await run(['unlock', '--password', 'pw', '--name', 'solsigner'], walletDir);
    const token = unlock.data.token;

    const signed = await run(['sign', '--token', token, '--name', 'solsigner', '--chain', 'solana', '--message', 'Hello Solana'], walletDir);
    expect(signed.ok).toBe(true);
    expect(signed.data.signature).toBeTruthy();
    expect(signed.data.public_key).toBeTruthy();
  });

  it('should reject init without password', async () => {
    const result = await run(['init'], walletDir);
    expect(result.ok).toBe(false);
    expect(result.data.error?.code).toBe('ERR_INVALID_INPUT');
  });

  it('should reject wrong password on unlock', async () => {
    await run(['init', '--password', 'correct', '--name', 'locked'], walletDir);
    const result = await run(['unlock', '--password', 'wrong', '--name', 'locked'], walletDir);
    expect(result.ok).toBe(false);
  });

  it('should handle text output format', async () => {
    const { stdout } = await execAsync('node', [CLI, '--wallet-dir', walletDir, '--format', 'text', 'networks']);
    expect(stdout).toContain('networks:');
  });
});
