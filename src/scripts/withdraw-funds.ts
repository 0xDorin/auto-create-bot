/**
 * Withdraw all MON from worker wallets back to master wallet
 */

import { parseEther, formatEther } from 'viem';
import { deriveWallets, getBalance, sendNative } from '../services/wallet';
import { config } from '../config';

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('WITHDRAW FUNDS TO MASTER WALLET');
  console.log('='.repeat(80));
  console.log(`\nNetwork: ${config.networkMode}`);
  console.log(`Number of worker wallets: ${config.numWallets}`);

  // Derive master wallet (index 0) and worker wallets (indices 1-N)
  const allWallets = deriveWallets(config.mnemonic, config.numWallets + 1);
  const masterWallet = allWallets[0]!;
  const workerWallets = allWallets.slice(1);

  console.log(`\nMaster wallet: ${masterWallet.address}`);

  // Get master wallet initial balance
  const initialMasterBalance = await getBalance(masterWallet);
  console.log(`Master balance: ${formatEther(initialMasterBalance)} MON`);

  console.log('\n' + '='.repeat(80));
  console.log('COLLECTING FUNDS FROM WORKER WALLETS');
  console.log('='.repeat(80) + '\n');

  // Execute withdrawals in parallel
  const withdrawalTasks = workerWallets.map(async (wallet) => {
    try {
      const balance = await getBalance(wallet);

      console.log(`\nWallet [${wallet.index}]: ${wallet.address}`);
      console.log(`  Balance: ${formatEther(balance)} MON`);

      if (balance === BigInt(0)) {
        console.log(`  ⏭️  Skipping (zero balance)`);
        return { success: false, amount: BigInt(0) };
      }

      // Use fixed gas for simple transfer (21000) instead of estimating
      const gasEstimate = BigInt(21000);

      const gasPrice = await wallet.publicClient.getGasPrice();
      const estimatedGasCost = gasEstimate * gasPrice;

      // Calculate amount to send (balance minus estimated gas cost)
      const amountToSend = balance - estimatedGasCost;

      if (amountToSend <= BigInt(0)) {
        console.log(`  ⏭️  Skipping (insufficient balance for gas)`);
        console.log(`  Gas cost would be: ${formatEther(estimatedGasCost)} MON`);
        return { success: false, amount: BigInt(0) };
      }

      console.log(`  Sending: ${formatEther(amountToSend)} MON`);
      console.log(`  Gas reserved: ${formatEther(estimatedGasCost)} MON (${gasEstimate} gas @ ${formatEther(gasPrice)} MON)`);

      const hash = await sendNative(wallet, masterWallet.address, amountToSend);

      console.log(`  ✅ Sent successfully`);
      console.log(`  Transaction: ${hash}`);

      return { success: true, amount: amountToSend };
    } catch (error) {
      console.error(`  ❌ Failed to withdraw:`, error);
      return { success: false, amount: BigInt(0) };
    }
  });

  const results = await Promise.allSettled(withdrawalTasks);

  let totalCollected = BigInt(0);
  let successCount = 0;
  let failCount = 0;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.success) {
        totalCollected += result.value.amount;
        successCount++;
      } else {
        failCount++;
      }
    } else {
      failCount++;
    }
  }

  // Get master wallet final balance
  const finalMasterBalance = await getBalance(masterWallet);

  console.log('\n' + '='.repeat(80));
  console.log('WITHDRAWAL SUMMARY');
  console.log('='.repeat(80));
  console.log(`\nWorker wallets processed: ${workerWallets.length}`);
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`\nTotal collected: ${formatEther(totalCollected)} MON`);
  console.log(`\nMaster wallet balance:`);
  console.log(`  Before: ${formatEther(initialMasterBalance)} MON`);
  console.log(`  After:  ${formatEther(finalMasterBalance)} MON`);
  console.log(`  Gained: ${formatEther(finalMasterBalance - initialMasterBalance)} MON`);
  console.log('\n' + '='.repeat(80) + '\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
