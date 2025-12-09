/**
 * Withdraw funds from master wallet (index 0) to specified address
 *
 * Usage:
 *   npm run withdraw-master <toAddress> [amount]
 *
 * Examples:
 *   npm run withdraw-master 0x1234...5678           # Withdraw all balance
 *   npm run withdraw-master 0x1234...5678 100       # Withdraw 100 MON
 */

import { parseEther, formatEther, type Address } from 'viem';
import { deriveWallet, getBalance, sendNative } from '../services/wallet';
import { config } from '../config';

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('\n❌ Error: Missing recipient address');
    console.log('\nUsage:');
    console.log('  npm run withdraw-master <toAddress> [amount]');
    console.log('\nExamples:');
    console.log('  npm run withdraw-master 0x1234...5678           # Withdraw all balance');
    console.log('  npm run withdraw-master 0x1234...5678 100       # Withdraw 100 MON');
    console.log('');
    process.exit(1);
  }

  const toAddress = args[0] as Address;
  const amountArg = args[1];

  // Validate address format
  if (!toAddress.startsWith('0x') || toAddress.length !== 42) {
    console.error('\n❌ Error: Invalid address format');
    console.log('Address must be 42 characters starting with 0x');
    console.log(`Received: ${toAddress}`);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log('MASTER WALLET WITHDRAWAL');
  console.log('='.repeat(80));
  console.log(`\nNetwork: ${config.networkMode}`);

  // Derive master wallet (index 0)
  const masterWallet = deriveWallet(config.mnemonic, 0);
  console.log(`\nMaster wallet: ${masterWallet.address}`);
  console.log(`Recipient: ${toAddress}`);

  // Get current balance
  const currentBalance = await getBalance(masterWallet);
  console.log(`\nCurrent balance: ${formatEther(currentBalance)} MON`);

  if (currentBalance === 0n) {
    console.log('\n⚠️  Master wallet has no balance to withdraw');
    return;
  }

  // Determine amount to withdraw
  let amountToWithdraw: bigint;

  if (amountArg) {
    // Specific amount requested
    amountToWithdraw = parseEther(amountArg);

    if (amountToWithdraw > currentBalance) {
      console.error(`\n❌ Error: Insufficient balance`);
      console.log(`Requested: ${amountArg} MON`);
      console.log(`Available: ${formatEther(currentBalance)} MON`);
      process.exit(1);
    }

    console.log(`Amount to withdraw: ${amountArg} MON`);
  } else {
    // Withdraw all (minus gas)
    // Estimate gas: 21000 gas * gas price
    const gasPrice = await masterWallet.publicClient.getGasPrice();
    const estimatedGas = 21000n * gasPrice;

    amountToWithdraw = currentBalance - estimatedGas;

    if (amountToWithdraw <= 0n) {
      console.error('\n❌ Error: Insufficient balance to cover gas fees');
      console.log(`Current balance: ${formatEther(currentBalance)} MON`);
      console.log(`Estimated gas: ${formatEther(estimatedGas)} MON`);
      process.exit(1);
    }

    console.log(`Amount to withdraw: ${formatEther(amountToWithdraw)} MON (all balance minus gas)`);
    console.log(`Estimated gas: ${formatEther(estimatedGas)} MON`);
  }

  // Confirm withdrawal
  console.log('\n' + '-'.repeat(80));
  console.log('⚠️  Please confirm the withdrawal:');
  console.log(`From: ${masterWallet.address}`);
  console.log(`To: ${toAddress}`);
  console.log(`Amount: ${formatEther(amountToWithdraw)} MON`);
  console.log('-'.repeat(80));

  // Wait for user confirmation (5 seconds)
  console.log('\nStarting withdrawal in 5 seconds... (Press Ctrl+C to cancel)');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Execute withdrawal
  console.log('\n🚀 Sending transaction...');
  const hash = await sendNative(masterWallet, toAddress, amountToWithdraw);

  console.log(`\n✅ Withdrawal successful!`);
  console.log(`Transaction hash: ${hash}`);
  console.log(`Explorer: https://explorer.monad.xyz/tx/${hash}`);

  // Show final balance
  const finalBalance = await getBalance(masterWallet);
  console.log(`\nFinal master wallet balance: ${formatEther(finalBalance)} MON`);

  console.log('\n' + '='.repeat(80) + '\n');
}

main().catch((error) => {
  console.error('\n❌ Withdrawal failed:', error);
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
