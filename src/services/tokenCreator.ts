/**
 * Token creation workflow
 */

import { parseEther } from "viem";
import { createToken, sellTokens } from "./contracts";
import { config } from "../config";
import { updateState } from "./storage";
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
  console.log(`\n${"=".repeat(80)}`);
  console.log(`Creating token: ${metadata.name} (${metadata.symbol})`);
  console.log(`Wallet [${wallet.index}]: ${wallet.address}`);
  console.log(`${"=".repeat(80)}\n`);

  const initialBuyAmount = parseEther(config.initialBuyAmount);

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

  console.log(`✅ Token created and saved to state`);

  // Sell tokens if configured (WITH RETRY - must succeed to ensure wallet only has MON)
  if (config.sellPercentage > 0) {
    const sellAmount =
      (tokensReceived * BigInt(config.sellPercentage)) / BigInt(100);

    console.log(`\nSelling ${config.sellPercentage}% of tokens...`);

    await withRetry(
      () => sellTokens(wallet, tokenAddress, sellAmount),
      `Sell tokens for ${metadata.symbol}`,
      config.maxRetries,
      config.retryDelayMs
    );
  }

  console.log(`\n✅ Token workflow completed!\n`);
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
