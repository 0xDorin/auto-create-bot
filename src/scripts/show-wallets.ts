/**
 * Script to display wallet addresses and balances
 *
 * Usage: npm run show-wallets
 */

import { config } from '../config';
import { deriveWallets, getBalance } from '../services/wallet';
import { formatEther } from 'viem';

async function main() {
  console.log('=== Wallet Addresses ===\n');
  console.log(`Network: ${config.networkMode}`);
  console.log(`Derivation path: m/44'/60'/0'/0/{index}\n`);

  const wallets = deriveWallets(config.mnemonic, config.numWallets + 1);

  console.log('Fetching balances...\n');

  for (const wallet of wallets) {
    const balance = await getBalance(wallet);
    const label = wallet.index === 0 ? '[MASTER]' : `[${wallet.index}]`;
    console.log(`${label.padEnd(10)} ${wallet.address}  ${formatEther(balance)} MON`);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
