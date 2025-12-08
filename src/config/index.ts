import dotenv from 'dotenv';
import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts';

dotenv.config();

type NetworkMode = 'mainnet' | 'testnet';

interface NetworkConfig {
  rpcUrl: string;
  chainId: number;
}

interface BotConfig {
  // Network
  networkMode: NetworkMode;
  network: NetworkConfig;

  // Metadata API
  tokenListApiBaseUrl: string; // Always mainnet for more tokens
  metadataUploadApiBaseUrl: string; // Network-specific for upload
  metadataStartPage: number;
  metadataLimitPerPage: number;
  metadataMode: 'upload' | 'reuse';

  // Wallet
  mnemonic: string;
  numWallets: number;
  walletFundingAmount: string; // in MON

  // Bot Settings
  totalTokensToCreate: number;
  durationHours: number;
  executionMode: 'sequential' | 'parallel';
  delayRandomness: number; // 0.0-1.0

  // Trading
  initialBuyAmount: string; // in MON
  sellPercentage: number; // 0-100

  // Gas
  gasLimit: number;
  maxFeePerGas: string; // in gwei
  maxPriorityFeePerGas: string; // in gwei

  // Retry
  maxRetries: number;
  retryDelayMs: number;
}

/**
 * Validate required environment variables
 */
function validateEnv(): void {
  const networkMode = (process.env.NETWORK_MODE || 'mainnet') as NetworkMode;

  if (!['mainnet', 'testnet'].includes(networkMode)) {
    throw new Error('NETWORK_MODE must be either "mainnet" or "testnet"');
  }

  const required = [
    'MNEMONIC',
    'NUM_WALLETS',
    'TOTAL_TOKENS_TO_CREATE',
    'DURATION_HOURS',
    'TOKEN_LIST_API_BASE_URL',
  ];

  // Network-specific required vars
  if (networkMode === 'mainnet') {
    required.push('MAINNET_RPC_URL', 'MAINNET_CHAIN_ID', 'MAINNET_METADATA_API_BASE_URL');
  } else {
    required.push('TESTNET_RPC_URL', 'TESTNET_CHAIN_ID', 'TESTNET_METADATA_API_BASE_URL');
  }

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        'Please copy .env.example to .env and fill in the values.'
    );
  }
}

/**
 * Parse and validate configuration
 */
function parseConfig(): BotConfig {
  validateEnv();

  const networkMode = (process.env.NETWORK_MODE || 'mainnet') as NetworkMode;

  // Select network-specific config
  const networkConfig: NetworkConfig = {
    rpcUrl:
      networkMode === 'mainnet'
        ? process.env.MAINNET_RPC_URL!
        : process.env.TESTNET_RPC_URL!,
    chainId:
      networkMode === 'mainnet'
        ? parseInt(process.env.MAINNET_CHAIN_ID!)
        : parseInt(process.env.TESTNET_CHAIN_ID!),
  };

  const config: BotConfig = {
    networkMode,
    network: networkConfig,
    tokenListApiBaseUrl: process.env.TOKEN_LIST_API_BASE_URL!,
    metadataUploadApiBaseUrl:
      networkMode === 'mainnet'
        ? process.env.MAINNET_METADATA_API_BASE_URL!
        : process.env.TESTNET_METADATA_API_BASE_URL!,
    metadataStartPage: parseInt(process.env.METADATA_START_PAGE || '1'),
    metadataLimitPerPage: parseInt(process.env.METADATA_LIMIT_PER_PAGE || '100'),
    metadataMode: (process.env.METADATA_MODE || 'upload') as 'upload' | 'reuse',
    mnemonic: process.env.MNEMONIC!,
    numWallets: parseInt(process.env.NUM_WALLETS!),
    walletFundingAmount: process.env.WALLET_FUNDING_AMOUNT || '50',
    totalTokensToCreate: parseInt(process.env.TOTAL_TOKENS_TO_CREATE!),
    durationHours: parseFloat(process.env.DURATION_HOURS!),
    executionMode: (process.env.EXECUTION_MODE || 'parallel') as 'sequential' | 'parallel',
    delayRandomness: parseFloat(process.env.DELAY_RANDOMNESS || '0.5'),
    initialBuyAmount: process.env.INITIAL_BUY_AMOUNT || '0.1',
    sellPercentage: parseInt(process.env.SELL_PERCENTAGE || '100'),
    gasLimit: parseInt(process.env.GAS_LIMIT || '500000'),
    maxFeePerGas: process.env.MAX_FEE_PER_GAS || '2',
    maxPriorityFeePerGas: process.env.MAX_PRIORITY_FEE_PER_GAS || '1',
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '5000'),
  };

  // Validate values
  if (config.numWallets < 1) {
    throw new Error('NUM_WALLETS must be at least 1');
  }

  if (config.totalTokensToCreate < 1) {
    throw new Error('TOTAL_TOKENS_TO_CREATE must be at least 1');
  }

  if (config.durationHours <= 0) {
    throw new Error('DURATION_HOURS must be greater than 0');
  }

  if (config.sellPercentage < 0 || config.sellPercentage > 100) {
    throw new Error('SELL_PERCENTAGE must be between 0 and 100');
  }

  if (!['sequential', 'parallel'].includes(config.executionMode)) {
    throw new Error('EXECUTION_MODE must be either "sequential" or "parallel"');
  }

  if (config.delayRandomness < 0 || config.delayRandomness > 1) {
    throw new Error('DELAY_RANDOMNESS must be between 0.0 and 1.0');
  }

  // Validate mnemonic (basic check)
  const words = config.mnemonic.trim().split(/\s+/);
  if (![12, 15, 18, 21, 24].includes(words.length)) {
    throw new Error('Invalid MNEMONIC format - must be 12, 15, 18, 21, or 24 words');
  }

  return config;
}

export const config = parseConfig();
export type { BotConfig, NetworkMode, NetworkConfig };
