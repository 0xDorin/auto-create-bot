/**
 * Cron job for Railway - Test Large (Testnet)
 * - Runs every hour at :30 (30 minutes past)
 * - Creates 30 tokens over 20 minutes
 * - For testing purposes on testnet
 */

import { formatEther, parseEther } from 'viem';
import { deriveWallet, getBalance } from '../services/wallet';
import { config } from '../config';
import { runScheduler } from '../services/scheduler';
import { resetState, loadState } from '../services/storage';
import { fetchMonPrice, calculateMonAmount } from '../services/priceOracle';

/**
 * Test Large mode configuration (hardcoded)
 */
const MODE_CONFIG = {
  name: 'test-large',
  tokensToCreate: 30,
  durationHours: 20 / 60, // 20 minutes
  numWallets: parseInt(process.env.NUM_WALLETS || '10'),
};

/**
 * Calculate required balance for this run
 */
async function calculateRequiredBalance(tokensToCreate: number): Promise<bigint> {
  let initialBuyPerToken: bigint;

  if (config.initialBuyMode === 'dynamic') {
    const monAmount = await calculateMonAmount(config.targetPoints);
    initialBuyPerToken = parseEther(monAmount.toString());
  } else {
    initialBuyPerToken = parseEther(config.initialBuyAmount);
  }

  const costPerToken = parseEther('10') + initialBuyPerToken;
  const totalCost = costPerToken * BigInt(tokensToCreate);
  const withBuffer = (totalCost * BigInt(110)) / BigInt(100);

  return withBuffer;
}

/**
 * Send alert
 */
async function sendAlert(message: string, details?: any) {
  console.error('\n' + '='.repeat(80));
  console.error('🚨 ALERT');
  console.error('='.repeat(80));
  console.error(message);
  if (details) {
    console.error(JSON.stringify(details, null, 2));
  }
  console.error('='.repeat(80) + '\n');
}

/**
 * Send completion report
 */
async function sendReport(
  startBalance: bigint,
  endBalance: bigint,
  tokensCreated: number
) {
  const spent = startBalance - endBalance;

  console.log('\n' + '='.repeat(80));
  console.log('📊 RUN REPORT');
  console.log('='.repeat(80));
  console.log(`Mode: ${MODE_CONFIG.name}`);
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Tokens created: ${tokensCreated}`);
  console.log(`Start balance: ${formatEther(startBalance)} MON`);
  console.log(`End balance: ${formatEther(endBalance)} MON`);
  console.log(`Spent: ${formatEther(spent)} MON`);
  console.log(`Cost per token: ${formatEther(spent / BigInt(tokensCreated || 1))} MON`);
  console.log('='.repeat(80) + '\n');
}

/**
 * Main cron run function
 */
async function main() {
  // Set SERVICE_NAME for separate state file
  process.env.SERVICE_NAME = MODE_CONFIG.name;

  console.log('\n' + '='.repeat(80));
  console.log('🤖 CRON JOB STARTED - TEST LARGE (30 tokens, 20min)');
  console.log('='.repeat(80));
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Network: ${config.networkMode}`);
  console.log(`Tokens to create: ${MODE_CONFIG.tokensToCreate}`);
  console.log(`Duration: 20 minutes`);
  console.log(`Wallets: ${MODE_CONFIG.numWallets}`);
  console.log('='.repeat(80) + '\n');

  try {
    // 1. Fetch current MON price
    const priceData = await fetchMonPrice();
    console.log(`💵 MON: $${priceData.price.toFixed(6)}\n`);

    // 2. Check master wallet balance
    const masterWallet = deriveWallet(config.mnemonic, 0);
    const startBalance = await getBalance(masterWallet);
    const requiredBalance = await calculateRequiredBalance(MODE_CONFIG.tokensToCreate);

    console.log('💰 Balance Check:');
    console.log(`  Current: ${formatEther(startBalance)} MON`);
    console.log(`  Required: ${formatEther(requiredBalance)} MON`);

    if (startBalance < requiredBalance) {
      await sendAlert('Insufficient balance for test-large run', {
        mode: MODE_CONFIG.name,
        current: formatEther(startBalance),
        required: formatEther(requiredBalance),
        shortfall: formatEther(requiredBalance - startBalance),
      });
      console.log('\n❌ Insufficient balance. Aborting.\n');
      process.exit(1);
    }

    console.log('  ✅ Sufficient balance\n');

    // 3. Override config with mode settings
    (config as any).totalTokensToCreate = MODE_CONFIG.tokensToCreate;
    (config as any).durationHours = MODE_CONFIG.durationHours;
    (config as any).numWallets = MODE_CONFIG.numWallets;

    // 4. Reset state (each cron run starts fresh)
    console.log('🔄 Resetting state for new run...');
    await resetState();

    // 5. Run scheduler
    console.log('🚀 Starting token creation...\n');
    await runScheduler();

    // 6. Send report
    const endBalance = await getBalance(masterWallet);
    const state = loadState();
    await sendReport(startBalance, endBalance, state.tokensCreated);

    console.log('✅ Test Large cron job completed successfully!\n');
    process.exit(0);
  } catch (error) {
    await sendAlert('Test Large cron job failed', {
      mode: MODE_CONFIG.name,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    console.error('\n❌ Test Large cron job failed:', error);
    process.exit(1);
  }
}

main();
