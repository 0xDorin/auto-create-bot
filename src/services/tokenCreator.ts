/**
 * Token creation workflow
 */

import { parseEther, formatEther } from "viem";
import { createToken, sellTokens } from "./contracts";
import { config } from "../config";
import { updateState } from "./storage";
import { calculateMonAmount } from "./priceOracle";
import type { WalletInstance } from "./wallet";
import type { PreparedToken } from "../types";
import type { BotState } from "./storage";

/**
 * Execute token creation (create + sell with retry on sell)
 */
export async function executeTokenCreation(
  wallet: WalletInstance,
  metadata: PreparedToken
): Promise<void> {
  console.log(`\n🪙 ${metadata.symbol} (Wallet ${wallet.index})`);

  // Determine initial buy amount based on mode
  let initialBuyAmount: bigint;

  if (config.initialBuyMode === 'dynamic') {
    const monAmount = await calculateMonAmount(config.targetPoints);
    initialBuyAmount = parseEther(monAmount.toString());
  } else {
    initialBuyAmount = parseEther(config.initialBuyAmount);
    console.log(`💰 Buy: ${config.initialBuyAmount} MON (fixed)`);
  }

  // Create token (no retry - if fails, skip to next)
  const { tokenAddress, tokensReceived } = await createToken(
    wallet,
    {
      name: metadata.name,
      symbol: metadata.symbol,
      tokenURI: metadata.tokenURI,
    },
    initialBuyAmount
  );

  // Update state immediately after successful creation (atomic operation)
  await updateState((state) => {
    state.tokensCreated++;
    state.lastCreatedAt = Date.now();
    state.createdTokens.push({
      tokenAddress,
      metadata,
      createdAt: Date.now(),
      walletIndex: wallet.index,
    });
  });

  // Sell tokens if configured AND initial buy was > 0 (WITH RETRY - must succeed to ensure wallet only has MON)
  if (initialBuyAmount === 0n) {
    console.log(`⏭️  Skipping sell (no initial buy)`);
  } else if (config.sellPercentage === 0) {
    console.log(`⏭️  Skipping sell (sellPercentage is 0, holding ${formatEther(tokensReceived)} tokens)`);
  } else if (config.sellPercentage > 0) {
    const sellAmount =
      (tokensReceived * BigInt(config.sellPercentage)) / BigInt(100);

    await withRetry(
      () => sellTokens(wallet, tokenAddress, sellAmount),
      `Sell tokens for ${metadata.symbol}`,
      config.maxRetries,
      config.retryDelayMs
    );
  }

  console.log(`✅ Complete\n`);
}

/**
 * Retry wrapper
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  taskName: string,
  maxRetries: number = config.maxRetries,
  retryDelay: number = config.retryDelayMs
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      console.error(`\n❌ Failed to ${taskName} (attempt ${attempt}/${maxRetries}):`);
      console.error(error instanceof Error ? error.stack || error.message : error);

      if (attempt < maxRetries) {
        const delay = retryDelay * attempt;
        console.log(`   Retrying in ${delay}ms...\n`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        const finalError = error instanceof Error ? error : new Error(String(error));
        throw new Error(`${taskName} failed after ${maxRetries} attempts: ${finalError.message}`);
      }
    }
  }

  throw new Error(`${taskName} failed after ${maxRetries} attempts`);
}
