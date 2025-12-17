/**
 * Script to fund wallets from master wallet
 *
 * Usage:
 *   npm run fund-wallets:create  (for Token Create Bot wallets)
 *   npm run fund-wallets:volume  (for Simple Volume Bot wallets)
 */

import { parseEther, formatEther } from 'viem';
import { config } from '../config';
import { deriveWallet, deriveWallets, getBalance, sendNative } from '../services/wallet';

type WalletMode = 'create' | 'volume';

interface FundConfig {
  title: string;
  mnemonic: string;
  numWallets: number;
  fundingAmount: string;
  masterIndex: number;  // 0 for create, undefined for volume (uses index 0 as source)
}

async function main() {
  // Get mode from command line argument
  const mode = process.argv[2] as WalletMode;

  if (!mode || (mode !== 'create' && mode !== 'volume')) {
    console.error('❌ Invalid mode. Use: create or volume');
    console.error('Usage: tsx src/scripts/fund-wallets.ts <create|volume>');
    process.exit(1);
  }

  // Get funding configuration based on mode
  const fundConfig = getFundConfig(mode);

  // Execute funding
  await fundWallets(fundConfig);
}

function getFundConfig(mode: WalletMode): FundConfig {
  if (mode === 'create') {
    return {
      title: '💼 FUND TOKEN CREATE BOT WALLETS',
      mnemonic: config.mnemonic,
      numWallets: config.numWallets,
      fundingAmount: config.walletFundingAmount,
      masterIndex: 0,
    };
  } else {
    const volumeMnemonic = process.env.VOLUME_MNEMONIC;
    if (!volumeMnemonic) {
      console.error('❌ VOLUME_MNEMONIC not found in .env');
      process.exit(1);
    }

    const numWallets = parseInt(process.env.VOLUME_WALLETS || '24');
    const fundingAmount = process.env.VOLUME_FUNDING_AMOUNT || config.walletFundingAmount;

    return {
      title: '📊 FUND SIMPLE VOLUME BOT WALLETS',
      mnemonic: volumeMnemonic,
      numWallets: numWallets,
      fundingAmount: fundingAmount,
      masterIndex: 0,  // Volume bot uses index 0 as funding source
    };
  }
}

async function fundWallets(fundConfig: FundConfig) {
  console.log('\n' + '='.repeat(80));
  console.log(fundConfig.title);
  console.log('='.repeat(80));
  console.log(`\nNetwork: ${config.networkMode}`);
  console.log(`RPC: ${config.network.rpcUrl}`);
  console.log(`Number of wallets to fund: ${fundConfig.numWallets}`);
  console.log(`Amount per wallet: ${fundConfig.fundingAmount} MON`);

  // Derive master wallet (index 0) and worker wallets (indices 1-N)
  const allWallets = deriveWallets(fundConfig.mnemonic, fundConfig.numWallets + 1);
  const masterWallet = allWallets[0]!;
  const workerWallets = allWallets.slice(1);

  console.log(`\nMaster wallet: ${masterWallet.address}`);

  // Check master wallet balance
  const masterBalance = await getBalance(masterWallet);
  console.log(`Master balance: ${formatEther(masterBalance)} MON`);

  const fundingAmount = parseEther(fundConfig.fundingAmount);
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
      console.log(`  Sending: ${fundConfig.fundingAmount} MON`);

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
