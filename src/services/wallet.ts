/**
 * Wallet management service using viem
 */

import { createWalletClient, createPublicClient, http, type Address, type Hash, parseEther, formatEther } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { initSDK, type NadFunSDK } from '@nadfun/sdk';
import { config } from '../config';

// Custom chain definition for Monad
const monadChain = {
  id: config.network.chainId,
  name: config.networkMode === 'mainnet' ? 'Monad Mainnet' : 'Monad Testnet',
  network: config.networkMode,
  nativeCurrency: {
    name: 'Monad',
    symbol: 'MON',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [config.network.rpcUrl] },
    public: { http: [config.network.rpcUrl] },
  },
} as const;

/**
 * Wallet instance (simple wrapper)
 */
export interface WalletInstance {
  address: Address;
  index: number;
  account: ReturnType<typeof mnemonicToAccount>;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
}

/**
 * Derive wallet from mnemonic at specific index
 */
export function deriveWallet(mnemonic: string, index: number): WalletInstance {
  const account = mnemonicToAccount(mnemonic, { addressIndex: index });

  const publicClient = createPublicClient({
    chain: monadChain,
    transport: http(config.network.rpcUrl, {
      timeout: 60_000, // 60 seconds
    }),
  });

  const walletClient = createWalletClient({
    account,
    chain: monadChain,
    transport: http(config.network.rpcUrl, {
      timeout: 60_000, // 60 seconds
    }),
  });

  return {
    address: account.address,
    index,
    account,
    publicClient,
    walletClient,
  };
}

/**
 * Derive multiple wallets
 */
export function deriveWallets(mnemonic: string, count: number): WalletInstance[] {
  return Array.from({ length: count }, (_, i) => deriveWallet(mnemonic, i));
}

/**
 * Get native balance (MON)
 */
export async function getBalance(wallet: WalletInstance): Promise<bigint> {
  return wallet.publicClient.getBalance({ address: wallet.address });
}

/**
 * Send native token (MON)
 */
export async function sendNative(
  fromWallet: WalletInstance,
  to: Address,
  amount: bigint
): Promise<Hash> {
  // Let viem handle gas estimation automatically
  const hash = await fromWallet.walletClient.sendTransaction({
    account: fromWallet.account,
    to,
    value: amount,
    chain: monadChain,
  });

  await fromWallet.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * SDK cache (lazy initialization)
 */
const sdkCache = new Map<string, NadFunSDK>();

/**
 * Derive private key from mnemonic
 */
function derivePrivateKey(mnemonic: string, index: number): `0x${string}` {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const path = `m/44'/60'/0'/0/${index}`;
  const childKey = hdKey.derive(path);
  return `0x${Buffer.from(childKey.privateKey!).toString('hex')}` as `0x${string}`;
}

/**
 * Get SDK instance for wallet (lazy + cached)
 */
export function getSDK(mnemonic: string, walletIndex: number): NadFunSDK {
  const cacheKey = `${mnemonic.slice(0, 10)}_${walletIndex}`;

  if (!sdkCache.has(cacheKey)) {
    const privateKey = derivePrivateKey(mnemonic, walletIndex);
    const sdk = initSDK({
      rpcUrl: config.network.rpcUrl,
      privateKey,
      network: config.networkMode,
    });
    sdkCache.set(cacheKey, sdk);
  }

  return sdkCache.get(cacheKey)!;
}

/**
 * Clear SDK cache (for cleanup)
 */
export function clearSDKCache(): void {
  sdkCache.clear();
}
