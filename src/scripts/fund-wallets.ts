/**
 * Script to fund wallets from master wallet
 *
 * Usage: npm run fund-wallets
 */

import { parseEther, formatEther } from 'viem';
import { config } from '../config';
import { deriveWallets, getBalance, sendNative } from '../services/wallet';

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('FUND WALLETS FROM MASTER');
  console.log('='.repeat(80));
  console.log(`\nNetwork: ${config.networkMode}`);
  console.log(`RPC: ${config.network.rpcUrl}`);
  console.log(`Number of wallets to fund: ${config.numWallets}`);
  console.log(`Amount per wallet: ${config.walletFundingAmount} MON`);

  // Derive master wallet (index 0) and worker wallets (indices 1-N)
  const allWallets = deriveWallets(config.mnemonic, config.numWallets + 1);
  const masterWallet = allWallets[0]!;
  const workerWallets = allWallets.slice(1);

  console.log(`\nMaster wallet: ${masterWallet.address}`);

  // Check master wallet balance
  const masterBalance = await getBalance(masterWallet);
  console.log(`Master balance: ${formatEther(masterBalance)} MON`);

  const fundingAmount = parseEther(config.walletFundingAmount);
  const totalNeeded = fundingAmount * BigInt(workerWallets.length);

  console.log(`\nTotal needed: ${formatEther(totalNeeded)} MON`);

  if (masterBalance < totalNeeded) {
    throw new Error(
      `Insufficient balance. Need ${formatEther(totalNeeded)} MON but have ${formatEther(masterBalance)} MON`
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log('FUNDING WALLETS');
  console.log('='.repeat(80) + '\n');

  let successCount = 0;
  let failCount = 0;

  for (const wallet of workerWallets) {
    try {
      console.log(`\nWallet [${wallet.index}]: ${wallet.address}`);
      console.log(`  Sending: ${config.walletFundingAmount} MON`);

      const hash = await sendNative(masterWallet, wallet.address, fundingAmount);

      console.log(`  ✅ Funded successfully`);
      console.log(`  Transaction: ${hash}`);

      successCount++;
    } catch (error) {
      console.error(`  ❌ Failed to fund:`, error);
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('FUNDING SUMMARY');
  console.log('='.repeat(80));
  console.log(`\nTotal wallets: ${workerWallets.length}`);
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);

  // Check master balance after funding
  const finalBalance = await getBalance(masterWallet);
  console.log(`\nMaster wallet balance after: ${formatEther(finalBalance)} MON`);
  console.log('='.repeat(80) + '\n');
}

main().catch((error) => {
  console.error('\n❌ Wallet funding failed:', error);
  process.exit(1);
});
