/**
 * Script to display wallet addresses and balances
 *
 * Usage:
 *   npm run show-wallets:create  (for Token Create Bot wallets)
 *   npm run show-wallets:volume  (for Simple Volume Bot wallets)
 */

import { config } from '../config';
import { deriveWallet, getBalance } from '../services/wallet';
import { formatEther } from 'viem';

type WalletMode = 'create' | 'volume';

interface WalletConfig {
  title: string;
  mnemonic: string;
  numWallets: number;
  startIndex: number;  // 0 for create (includes master), 1 for volume (no master)
  description: string;
}

async function main() {
  // Get mode from command line argument
  const mode = process.argv[2] as WalletMode;

  if (!mode || (mode !== 'create' && mode !== 'volume')) {
    console.error('❌ Invalid mode. Use: create or volume');
    console.error('Usage: tsx src/scripts/show-wallets.ts <create|volume>');
    process.exit(1);
  }

  // Get wallet configuration based on mode
  const walletConfig = getWalletConfig(mode);

  // Display wallets
  await displayWallets(walletConfig);
}

function getWalletConfig(mode: WalletMode): WalletConfig {
  if (mode === 'create') {
    return {
      title: '💼 TOKEN CREATE BOT WALLETS',
      mnemonic: config.mnemonic,
      numWallets: config.numWallets + 1, // +1 for master
      startIndex: 0,
      description: `Total wallets: ${config.numWallets + 1} (1 master + ${config.numWallets} sub-wallets)\nMnemonic: MNEMONIC (from .env)`,
    };
  } else {
    const volumeMnemonic = process.env.VOLUME_MNEMONIC;
    if (!volumeMnemonic) {
      console.error('❌ VOLUME_MNEMONIC not found in .env');
      process.exit(1);
    }

    const numWallets = parseInt(process.env.VOLUME_WALLETS || '24');

    return {
      title: '📊 SIMPLE VOLUME BOT WALLETS',
      mnemonic: volumeMnemonic,
      numWallets: numWallets,
      startIndex: 1,  // Start from index 1 (no master)
      description: `Total wallets: ${numWallets} (starting from index 1)\nMnemonic: VOLUME_MNEMONIC (from .env)`,
    };
  }
}

async function displayWallets(walletConfig: WalletConfig) {
  console.log('\n' + '='.repeat(80));
  console.log(walletConfig.title);
  console.log('='.repeat(80));
  console.log(`Network: ${config.networkMode}`);
  console.log(walletConfig.description);
  console.log(`Derivation path: m/44'/60'/0'/0/{index}`);
  console.log('='.repeat(80) + '\n');

  console.log('Fetching balances...\n');

  let totalBalance = 0n;

  for (let i = 0; i < walletConfig.numWallets; i++) {
    const walletIndex = walletConfig.startIndex + i;
    const wallet = deriveWallet(walletConfig.mnemonic, walletIndex);
    const balance = await getBalance(wallet);
    totalBalance += balance;

    const label = walletIndex === 0 ? '[MASTER]' : `[${walletIndex}]`;
    console.log(`${label.padEnd(10)} ${wallet.address}  ${formatEther(balance)} MON`);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`Total Balance: ${formatEther(totalBalance)} MON`);
  if (walletConfig.startIndex > 0) {
    console.log(`Average per wallet: ${formatEther(totalBalance / BigInt(walletConfig.numWallets))} MON`);
  }
  console.log('='.repeat(80) + '\n');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
