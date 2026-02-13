import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ensureSecureDir, fileExists } from '../security/permissions.js';

export type ChainType = 'ethereum' | 'solana';

export interface NetworkConfig {
  rpcUrl: string;
  explorerApiUrl?: string;
  explorerUrl?: string;
  chainId?: number;
}

export interface WellKnownToken {
  address: string;
  decimals: number;
  symbol: string;
}

export interface AppConfig {
  walletDir: string;
  networks: Record<string, Record<string, NetworkConfig>>;
  tokens: Record<string, Record<string, Record<string, WellKnownToken>>>;
}

export const DEFAULT_NETWORKS: Record<string, Record<string, NetworkConfig>> = {
  ethereum: {
    mainnet: {
      rpcUrl: 'https://eth.llamarpc.com',
      explorerApiUrl: 'https://api.etherscan.io/api',
      explorerUrl: 'https://etherscan.io',
      chainId: 1,
    },
    sepolia: {
      rpcUrl: 'https://rpc.sepolia.org',
      explorerApiUrl: 'https://api-sepolia.etherscan.io/api',
      explorerUrl: 'https://sepolia.etherscan.io',
      chainId: 11155111,
    },
    polygon: {
      rpcUrl: 'https://polygon-rpc.com',
      explorerApiUrl: 'https://api.polygonscan.com/api',
      explorerUrl: 'https://polygonscan.com',
      chainId: 137,
    },
    arbitrum: {
      rpcUrl: 'https://arb1.arbitrum.io/rpc',
      explorerApiUrl: 'https://api.arbiscan.io/api',
      explorerUrl: 'https://arbiscan.io',
      chainId: 42161,
    },
    base: {
      rpcUrl: 'https://mainnet.base.org',
      explorerApiUrl: 'https://api.basescan.org/api',
      explorerUrl: 'https://basescan.org',
      chainId: 8453,
    },
    'base-sepolia': {
      rpcUrl: 'https://sepolia.base.org',
      explorerApiUrl: 'https://api-sepolia.basescan.org/api',
      explorerUrl: 'https://sepolia.basescan.org',
      chainId: 84532,
    },
  },
  solana: {
    mainnet: {
      rpcUrl: 'https://api.mainnet-beta.solana.com',
      explorerUrl: 'https://explorer.solana.com',
    },
    devnet: {
      rpcUrl: 'https://api.devnet.solana.com',
      explorerUrl: 'https://explorer.solana.com',
    },
  },
};

export const WELL_KNOWN_TOKENS: Record<string, Record<string, Record<string, WellKnownToken>>> = {
  ethereum: {
    mainnet: {
      usdc: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, symbol: 'USDC' },
      usdt: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, symbol: 'USDT' },
      dai: { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, symbol: 'DAI' },
      weth: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, symbol: 'WETH' },
      wbtc: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, symbol: 'WBTC' },
    },
    polygon: {
      usdc: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, symbol: 'USDC' },
      usdt: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, symbol: 'USDT' },
    },
    arbitrum: {
      usdc: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, symbol: 'USDC' },
      usdt: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, symbol: 'USDT' },
    },
    base: {
      usdc: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, symbol: 'USDC' },
    },
    sepolia: {},
  },
  solana: {
    mainnet: {
      usdc: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, symbol: 'USDC' },
      usdt: { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, symbol: 'USDT' },
    },
    devnet: {
      usdc: { address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6, symbol: 'USDC' },
    },
  },
};

export function getDefaultWalletDir(): string {
  return join(homedir(), '.wallet-cli');
}

export function getKeystoreDir(walletDir: string): string {
  return join(walletDir, 'keystores');
}

export function getSessionDir(walletDir: string): string {
  return join(walletDir, 'sessions');
}

export function getConfigFilePath(walletDir: string): string {
  return join(walletDir, 'config.json');
}

export async function loadConfig(walletDir: string): Promise<AppConfig> {
  const configPath = getConfigFilePath(walletDir);
  const config: AppConfig = {
    walletDir,
    networks: JSON.parse(JSON.stringify(DEFAULT_NETWORKS)),
    tokens: JSON.parse(JSON.stringify(WELL_KNOWN_TOKENS)),
  };

  // Apply env var overrides for RPC URLs
  for (const [chain, networks] of Object.entries(config.networks)) {
    for (const [network, netConfig] of Object.entries(networks)) {
      const envKey = `WALLET_CLI_RPC_${chain.toUpperCase()}_${network.toUpperCase()}`;
      const envUrl = process.env[envKey];
      if (envUrl) {
        netConfig.rpcUrl = envUrl;
      }
    }
  }

  // Load saved config overrides
  if (await fileExists(configPath)) {
    try {
      const saved = JSON.parse(await readFile(configPath, 'utf-8'));
      if (saved.networks) {
        for (const [chain, networks] of Object.entries(saved.networks as Record<string, Record<string, NetworkConfig>>)) {
          if (!config.networks[chain]) config.networks[chain] = {};
          for (const [network, netConfig] of Object.entries(networks)) {
            config.networks[chain][network] = { ...config.networks[chain]?.[network], ...netConfig };
          }
        }
      }
    } catch {
      // Ignore invalid config file
    }
  }

  return config;
}

export async function saveNetworkConfig(walletDir: string, chain: string, network: string, rpcUrl: string): Promise<void> {
  await ensureSecureDir(walletDir);
  const configPath = getConfigFilePath(walletDir);

  let saved: { networks?: Record<string, Record<string, Partial<NetworkConfig>>> } = {};
  if (await fileExists(configPath)) {
    try {
      saved = JSON.parse(await readFile(configPath, 'utf-8'));
    } catch {
      saved = {};
    }
  }

  if (!saved.networks) saved.networks = {};
  if (!saved.networks[chain]) saved.networks[chain] = {};
  saved.networks[chain][network] = { rpcUrl };

  await writeFile(configPath, JSON.stringify(saved, null, 2));
}

export async function resetNetworkConfig(walletDir: string, chain: string, network: string): Promise<void> {
  const configPath = getConfigFilePath(walletDir);
  if (!(await fileExists(configPath))) return;

  try {
    const saved = JSON.parse(await readFile(configPath, 'utf-8'));
    if (saved.networks?.[chain]?.[network]) {
      delete saved.networks[chain][network];
      if (Object.keys(saved.networks[chain]).length === 0) {
        delete saved.networks[chain];
      }
      await writeFile(configPath, JSON.stringify(saved, null, 2));
    }
  } catch {
    // Ignore
  }
}

export function getNetworkConfig(config: AppConfig, chain: string, network: string): NetworkConfig {
  const netConfig = config.networks[chain]?.[network];
  if (!netConfig) {
    throw new Error(`Network ${chain}:${network} not found`);
  }
  return netConfig;
}

export function resolveTokenAddress(
  config: AppConfig,
  chain: string,
  network: string,
  tokenAddressOrAlias: string,
): WellKnownToken | { address: string; decimals?: number; symbol?: string } {
  // Check if it's a well-known alias
  const token = config.tokens[chain]?.[network]?.[tokenAddressOrAlias.toLowerCase()];
  if (token) return token;

  // Otherwise treat as raw address
  return { address: tokenAddressOrAlias };
}
