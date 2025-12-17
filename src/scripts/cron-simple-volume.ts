/**
 * Simple Volume Bot - Cron Job
 *
 * State-based volume trading with distributed timing over 24 hours
 * - Each wallet performs 4 trades sequentially
 * - Trades are distributed evenly over 24 hours with randomness
 * - State persists across runs (resume on restart)
 * - Tokens are rotated: 1→2→3→...→N→1→2→...
 *
 * Usage: npm run cron:simple-volume
 */

import { formatEther, type Address } from 'viem';
import { deriveWallet, getBalance } from '../services/wallet';
import { config } from '../config';
import {
  getVolumeConfig,
  getEligibleTokens,
  executeVolumeTrade,
  type TradeResult,
} from '../services/volumeBot';
import { loadVolumeState, updateVolumeState } from '../services/storage';

/**
 * Calculate delay in milliseconds with randomness
 */
function calculateDelay(baseDelayMs: number, randomness: number): number {
  // Apply randomness factor (e.g., 0.3 = ±30%)
  const variation = baseDelayMs * randomness;
  const minDelay = baseDelayMs - variation;
  const maxDelay = baseDelayMs + variation;

  return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main function
 */
async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🤖 SIMPLE VOLUME BOT STARTED');
  console.log('='.repeat(80));
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Network: ${config.networkMode}`);
  console.log('='.repeat(80) + '\n');

  try {
    // 1. Get volume config
    const volumeConfig = getVolumeConfig();

    // Calculate points per trade
    const pointsPerTrade = volumeConfig.targetPoints / volumeConfig.tradesPerWallet;

    console.log('📋 Configuration:');
    console.log(`  Wallets: ${volumeConfig.numWallets}`);
    console.log(`  Daily trades: ${volumeConfig.dailyTrades}`);
    console.log(`  Trades per wallet: ${volumeConfig.tradesPerWallet}`);
    console.log(`  Total target points per wallet: ${volumeConfig.targetPoints}`);
    console.log(`  Points per trade: ${pointsPerTrade.toFixed(1)}`);
    console.log(`  Delay randomness: ±${(volumeConfig.delayRandomness * 100).toFixed(0)}%`);

    // Calculate base delay between trades
    const baseDelayMs = (24 * 60 * 60 * 1000) / volumeConfig.dailyTrades;
    const baseDelayMin = (baseDelayMs / 60000).toFixed(1);
    console.log(`  Base delay: ~${baseDelayMin} minutes between trades`);
    console.log();

    // 2. Load state
    const state = loadVolumeState();

    console.log('📊 Current State:');
    console.log(`  Current wallet: ${state.currentWalletIndex + 1}/${volumeConfig.numWallets}`);
    console.log(`  Current wallet trades: ${state.currentWalletTrades}/${volumeConfig.tradesPerWallet}`);
    console.log(`  Total completed trades: ${state.totalCompletedTrades}/${volumeConfig.dailyTrades}`);
    console.log(`  Next token index: ${state.nextTokenIndex}`);

    if (state.lastTradeTimestamp) {
      const timeSinceLastTrade = Date.now() - state.lastTradeTimestamp;
      const minutesSince = (timeSinceLastTrade / 60000).toFixed(1);
      console.log(`  Last trade: ${minutesSince} minutes ago`);
    }
    console.log();

    // Check if already completed
    if (state.totalCompletedTrades >= volumeConfig.dailyTrades) {
      console.log('✅ All trades for today completed!');
      console.log(`   Completed: ${state.totalCompletedTrades}/${volumeConfig.dailyTrades}`);
      console.log('\n💡 Tip: Run reset-volume-state to start fresh for a new day\n');
      process.exit(0);
    }

    // 3. Get eligible tokens (holder count === 0)
    const eligibleTokens = await getEligibleTokens();

    if (eligibleTokens.length === 0) {
      console.log('⚠️  No eligible tokens found (all tokens have other holders)');
      console.log('✅ Nothing to do\n');
      process.exit(0);
    }

    console.log(`📊 Eligible tokens: ${eligibleTokens.length}`);
    console.log();

    // 4. Derive volume wallets
    const volumeWallets = Array.from({ length: volumeConfig.numWallets }, (_, i) =>
      deriveWallet(volumeConfig.mnemonic, i + 1)
    );

    console.log(`💼 Volume wallets loaded: ${volumeWallets.length}`);

    // 5. Check current wallet balance
    const currentWallet = volumeWallets[state.currentWalletIndex]!;
    const currentBalance = await getBalance(currentWallet);
    console.log(`\n💰 Wallet ${state.currentWalletIndex + 1} balance: ${formatEther(currentBalance)} MON\n`);

    // 6. Execute trades (resume from current state)
    console.log('='.repeat(80));
    console.log('🔄 EXECUTING VOLUME TRADES');
    console.log('='.repeat(80));

    let walletIndex = state.currentWalletIndex;
    let walletTrades = state.currentWalletTrades;
    let tokenIndex = state.nextTokenIndex;
    let totalTrades = state.totalCompletedTrades;

    // Continue until all trades are done
    while (totalTrades < volumeConfig.dailyTrades && walletIndex < volumeConfig.numWallets) {
      const wallet = volumeWallets[walletIndex]!;

      // If starting new wallet, print header
      if (walletTrades === 0) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`💼 Wallet ${walletIndex + 1}/${volumeConfig.numWallets} - ${volumeConfig.tradesPerWallet} trades`);
        console.log(`${'─'.repeat(80)}`);
      }

      // Perform one trade
      let tradeSuccessful = false;
      let attempts = 0;
      const maxAttempts = eligibleTokens.length; // Try all tokens once

      while (!tradeSuccessful && attempts < maxAttempts) {
        attempts++;

        // Get token for this trade (rotate through list)
        const token = eligibleTokens[tokenIndex % eligibleTokens.length]!;
        const displayTokenNum = (tokenIndex % eligibleTokens.length) + 1;
        const tokenSymbol = token.metadata?.symbol || token.tokenAddress.slice(0, 8);

        console.log(`\n  Trade ${walletTrades + 1}/${volumeConfig.tradesPerWallet}: ${tokenSymbol} (Token #${displayTokenNum}/${eligibleTokens.length})`);

        const result: TradeResult = await executeVolumeTrade(
          wallet,
          token.tokenAddress as Address,
          tokenSymbol,
          pointsPerTrade
        );

        // Handle result
        if (result.status === 'success') {
          console.log(`    ✅ Success!`);
          tradeSuccessful = true;
          walletTrades++;
          totalTrades++;
          tokenIndex++;

          // Save state after successful trade
          await updateVolumeState((s) => {
            s.currentWalletTrades = walletTrades;
            s.nextTokenIndex = tokenIndex;
            s.totalCompletedTrades = totalTrades;
            s.lastTradeTimestamp = Date.now();
          });

          console.log(`    📊 Progress: ${totalTrades}/${volumeConfig.dailyTrades} total trades`);

          // Check if wallet completed all trades
          if (walletTrades >= volumeConfig.tradesPerWallet) {
            console.log(`\n  ✅ Wallet ${walletIndex + 1} completed all ${volumeConfig.tradesPerWallet} trades`);
            walletIndex++;
            walletTrades = 0;

            // Save state for new wallet
            await updateVolumeState((s) => {
              s.currentWalletIndex = walletIndex;
              s.currentWalletTrades = 0;
            });
          }

          // Apply delay before next trade (unless this was the last trade)
          if (totalTrades < volumeConfig.dailyTrades) {
            const delayMs = calculateDelay(baseDelayMs, volumeConfig.delayRandomness);
            const delayMin = (delayMs / 60000).toFixed(1);
            console.log(`\n  ⏰ Waiting ${delayMin} minutes before next trade...`);
            await sleep(delayMs);
          }
        } else {
          // Token-level issues: try next token
          if (result.status === 'graduated') {
            console.log(`    ⏭️  Token graduated, trying next token...`);
          } else if (result.status === 'has_other_holders') {
            console.log(`    ⏭️  Other holders detected, trying next token...`);
          } else if (result.status === 'target_too_low') {
            console.log(`    ⏭️  Target points too low, trying next token...`);
          }
          // Wallet-level issues: stop this wallet's trades
          else if (result.status === 'insufficient_balance') {
            console.log(`    ❌ Insufficient balance, skipping to next wallet`);
            walletIndex++;
            walletTrades = 0;

            // Save state for new wallet
            await updateVolumeState((s) => {
              s.currentWalletIndex = walletIndex;
              s.currentWalletTrades = 0;
            });
            break; // Exit retry loop
          }

          // Move to next token for retry
          tokenIndex++;
          await updateVolumeState((s) => {
            s.nextTokenIndex = tokenIndex;
          });
        }
      }

      // If we exhausted all tokens without success
      if (!tradeSuccessful) {
        console.log(`\n  ⚠️  Could not find valid token after ${attempts} attempts, skipping to next wallet`);
        walletIndex++;
        walletTrades = 0;

        await updateVolumeState((s) => {
          s.currentWalletIndex = walletIndex;
          s.currentWalletTrades = 0;
        });
      }
    }

    // 7. Final summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total completed: ${totalTrades}/${volumeConfig.dailyTrades} trades`);

    if (totalTrades >= volumeConfig.dailyTrades) {
      console.log('\n🎉 All daily trades completed!');
    } else {
      console.log(`\n⏸️  Paused at: Wallet ${walletIndex + 1}, Trade ${walletTrades + 1}`);
      console.log(`   Resume anytime - state is saved`);
    }

    console.log('='.repeat(80) + '\n');

    console.log('✅ Simple volume bot session completed!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Simple volume bot failed:', error);
    process.exit(1);
  }
}

main();
