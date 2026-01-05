/**
 * Latest Trade Volume Bot - Cron Job
 *
 * Trades on tokens from latest_trade list (active tokens)
 * - Fetches 30 tokens from /order/latest_trade
 * - Excludes last 2 traded tokens to avoid repetition
 * - Randomly picks one token to trade
 *
 * Usage: npm run cron:latest-volume
 */

import { formatEther, type Address } from 'viem';
import { deriveWallet, getBalance } from '../services/wallet';
import { config } from '../config';
import { getTokenList } from '../services/nadfunApi';
import {
  getVolumeConfig,
  executeVolumeTrade,
  type TradeResult,
} from '../services/volumeBot';
import { loadVolumeState, updateVolumeState } from '../services/storage';

/** Recent tokens to exclude (last N traded) */
const EXCLUDE_RECENT_COUNT = 2;

/** Number of tokens to fetch from latest_trade */
const FETCH_LIMIT = 30;

/**
 * Calculate delay in milliseconds with randomness
 */
function calculateDelay(baseDelayMs: number, randomness: number): number {
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
 * Pick random item from array
 */
function pickRandom<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Get tokens from latest_trade, excluding recent trades
 */
async function getLatestTradeTokens(recentTokens: string[]): Promise<Array<{
  tokenAddress: string;
  symbol: string;
  name: string;
}>> {
  console.log('\n🔍 Fetching latest_trade tokens...');

  const response = await getTokenList(
    { page: 1, limit: FETCH_LIMIT, is_nsfw: false },
    'latest_trade'
  );

  console.log(`  📊 Fetched ${response.tokens.length} tokens`);

  // Filter out graduated tokens and recent trades
  const available = response.tokens
    .filter(t => !t.token_info.is_graduated)
    .filter(t => !recentTokens.includes(t.token_info.token_id))
    .map(t => ({
      tokenAddress: t.token_info.token_id,
      symbol: t.token_info.symbol,
      name: t.token_info.name,
    }));

  console.log(`  ✅ Available: ${available.length} (excluded ${recentTokens.length} recent)`);

  return available;
}

/**
 * Main function
 */
async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🔥 LATEST TRADE VOLUME BOT STARTED');
  console.log('='.repeat(80));
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Network: ${config.networkMode}`);
  console.log('='.repeat(80) + '\n');

  try {
    // 1. Get volume config
    const volumeConfig = getVolumeConfig();
    const pointsPerTrade = volumeConfig.targetPoints / volumeConfig.tradesPerWallet;

    console.log('📋 Configuration:');
    console.log(`  Wallets: ${volumeConfig.numWallets}`);
    console.log(`  Daily trades: ${volumeConfig.dailyTrades}`);
    console.log(`  Trades per wallet: ${volumeConfig.tradesPerWallet}`);
    console.log(`  Points per trade: ${pointsPerTrade.toFixed(1)}`);
    console.log(`  Exclude recent: ${EXCLUDE_RECENT_COUNT} tokens`);
    console.log();

    // 2. Load state
    const state = loadVolumeState();
    const targetTrades = state.totalCompletedTrades + volumeConfig.dailyTrades;

    // Track recent tokens (in-memory, resets on restart)
    let recentTokens: string[] = [];

    console.log('📊 Current State:');
    console.log(`  Lifetime trades: ${state.totalCompletedTrades}`);
    console.log(`  Current wallet: ${state.currentWalletIndex + 1}/${volumeConfig.numWallets}`);
    console.log(`  Current wallet trades: ${state.currentWalletTrades}/${volumeConfig.tradesPerWallet}`);
    console.log();

    // Calculate dynamic delay
    const remainingTrades = targetTrades - state.totalCompletedTrades;
    if (remainingTrades <= 0) {
      console.log('✅ Target already reached. Nothing to do.\n');
      process.exit(0);
    }

    const baseDelayMs = (24 * 60 * 60 * 1000) / remainingTrades;
    const baseDelayMin = (baseDelayMs / 60000).toFixed(1);

    console.log('⏱️  This Run:');
    console.log(`  Target: ${volumeConfig.dailyTrades} more trades`);
    console.log(`  Interval: ~${baseDelayMin} min per trade`);
    console.log();

    // 3. Derive volume wallets
    const volumeWallets = Array.from({ length: volumeConfig.numWallets }, (_, i) =>
      deriveWallet(volumeConfig.mnemonic, i + 1)
    );

    console.log(`💼 Volume wallets loaded: ${volumeWallets.length}`);

    // 4. Validate wallet index
    let walletIndex = state.currentWalletIndex;
    if (walletIndex < 0 || walletIndex >= volumeConfig.numWallets) {
      console.warn(`\n⚠️  Invalid wallet index: ${walletIndex}. Resetting to 0.`);
      walletIndex = 0;
      await updateVolumeState(s => {
        s.currentWalletIndex = 0;
        s.currentWalletTrades = 0;
      });
    }

    // 5. Execute trades
    console.log('\n' + '='.repeat(80));
    console.log('🔄 EXECUTING LATEST TRADE VOLUME');
    console.log('='.repeat(80));

    let walletTrades = state.currentWalletTrades;
    let totalTrades = state.totalCompletedTrades;

    while (totalTrades < targetTrades) {
      const wallet = volumeWallets[walletIndex];
      if (!wallet) {
        console.error(`\n❌ Invalid wallet index: ${walletIndex}. Resetting.`);
        walletIndex = 0;
        await updateVolumeState(s => {
          s.currentWalletIndex = 0;
          s.currentWalletTrades = 0;
        });
        continue;
      }

      // Print wallet header
      if (walletTrades === 0) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`💼 Wallet ${walletIndex + 1}/${volumeConfig.numWallets}`);
        const balance = await getBalance(wallet);
        console.log(`💰 Balance: ${formatEther(balance)} MON`);
        console.log(`${'─'.repeat(80)}`);
      }

      // Get available tokens
      const availableTokens = await getLatestTradeTokens(recentTokens);

      if (availableTokens.length === 0) {
        console.log('\n⚠️  No available tokens. Waiting...');
        await sleep(60000); // Wait 1 min and retry
        continue;
      }

      // Pick random token
      const token = pickRandom(availableTokens)!;
      console.log(`\n🎲 Selected: ${token.symbol} (${token.tokenAddress.slice(0, 10)}...)`);

      // Execute trade
      let result: TradeResult;
      try {
        result = await executeVolumeTrade(
          wallet,
          token.tokenAddress as Address,
          token.symbol,
          pointsPerTrade,
          { skipHolderCheck: true }
        );
      } catch (error) {
        console.error(`  ❌ Trade error:`, error instanceof Error ? error.message : error);
        // Add to recent to avoid retry
        recentTokens = [token.tokenAddress, ...recentTokens].slice(0, EXCLUDE_RECENT_COUNT);
        await sleep(5000);
        continue;
      }

      // Handle result
      if (result.status === 'success') {
        console.log(`  ✅ Trade successful!`);

        // Add to recent tokens
        recentTokens = [token.tokenAddress, ...recentTokens].slice(0, EXCLUDE_RECENT_COUNT);

        walletTrades++;
        totalTrades++;

        // Check wallet completion
        const walletCompleted = walletTrades >= volumeConfig.tradesPerWallet;

        if (walletCompleted) {
          console.log(`\n  ✅ Wallet ${walletIndex + 1} completed ${volumeConfig.tradesPerWallet} trades`);
          const nextWalletIndex = (walletIndex + 1) % volumeConfig.numWallets;

          await updateVolumeState(s => {
            s.currentWalletTrades = 0;
            s.totalCompletedTrades = totalTrades;
            s.lastTradeTimestamp = Date.now();
            s.currentWalletIndex = nextWalletIndex;
          });

          walletIndex = nextWalletIndex;
          walletTrades = 0;
        } else {
          await updateVolumeState(s => {
            s.currentWalletTrades = walletTrades;
            s.totalCompletedTrades = totalTrades;
            s.lastTradeTimestamp = Date.now();
          });
        }

        console.log(`  📊 Progress: ${totalTrades}/${targetTrades}`);

        // Delay before next trade
        if (totalTrades < targetTrades) {
          const delayMs = calculateDelay(baseDelayMs, volumeConfig.delayRandomness);
          const delayMin = (delayMs / 60000).toFixed(1);
          console.log(`\n  ⏰ Waiting ${delayMin} minutes...`);
          await sleep(delayMs);
        }
      } else if (result.status === 'insufficient_balance') {
        console.log(`  ❌ Insufficient balance, moving to next wallet`);

        const nextWalletIndex = (walletIndex + 1) % volumeConfig.numWallets;
        await updateVolumeState(s => {
          s.currentWalletIndex = nextWalletIndex;
          s.currentWalletTrades = 0;
        });

        walletIndex = nextWalletIndex;
        walletTrades = 0;
      } else {
        // Other failures: add to recent and try another
        console.log(`  ⏭️  Status: ${result.status}, trying another token...`);
        recentTokens = [token.tokenAddress, ...recentTokens].slice(0, EXCLUDE_RECENT_COUNT);
      }
    }

    // Final summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(80));
    console.log(`Lifetime trades: ${totalTrades}`);
    console.log('\n🎉 All trades completed!\n');
    console.log('='.repeat(80) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Latest trade volume bot failed:', error);
    process.exit(1);
  }
}

main();
