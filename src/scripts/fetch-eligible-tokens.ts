/**
 * Script to fetch tokens with holder_count === 0 for volume bot testing
 *
 * Usage:
 *   npm run fetch-eligible-tokens
 *
 * Strategy:
 *   - Starts from page 30 (or last saved page)
 *   - Searches until 30 eligible tokens found
 *   - Saves progress (last page read)
 *   - Next run continues from where it left off
 */

import { httpGet } from '../services/api';
import { config } from '../config';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { TokenListResponse, PreparedToken } from '../types';

/**
 * Eligible token format - matches BotState.createdTokens format
 * This allows seamless switching between fetched tokens and created tokens
 */
interface EligibleToken {
  tokenAddress: string;
  metadata?: PreparedToken;  // Optional - undefined for fetched tokens
  createdAt: number;
  walletIndex?: number;      // Optional - undefined for fetched tokens
}

interface EligibleTokensFile {
  tokens: EligibleToken[];
  total_count: number;
  last_page_read: number;
  start_page: number;
}

/**
 * Sleep helper for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Load existing eligible tokens file
 */
function loadExistingData(filePath: string): EligibleTokensFile | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.warn('⚠️  Could not load existing file, starting fresh');
    return null;
  }
}

/**
 * Fetch tokens with holder_count === 0
 * Continues from last saved page if available
 */
async function fetchEligibleTokens(
  targetCount: number = 30,
  startPage: number = 30,
  limitPerPage: number = 100,
  existingTokens: EligibleToken[] = []
): Promise<{ tokens: EligibleToken[]; lastPage: number }> {
  const eligibleTokens: EligibleToken[] = [...existingTokens];
  const baseUrl = config.tokenListApiBaseUrl;
  let currentPage = startPage;

  console.log('🔍 Searching for tokens with holder_count === 0...\n');
  console.log(`API: ${baseUrl}`);
  console.log(`Starting from page: ${startPage}`);
  console.log(`Target count: ${targetCount}`);
  console.log(`Currently have: ${existingTokens.length} tokens`);
  console.log(`Need to find: ${Math.max(0, targetCount - existingTokens.length)} more\n`);

  // Already have enough tokens
  if (existingTokens.length >= targetCount) {
    console.log(`✅ Already have ${existingTokens.length} tokens (target: ${targetCount})`);
    return { tokens: eligibleTokens, lastPage: startPage - 1 };
  }

  while (eligibleTokens.length < targetCount) {
    try {
      console.log(`📄 Fetching page ${currentPage}...`);

      const response = await httpGet<TokenListResponse>(
        baseUrl,
        '/order/creation_time',
        {
          params: {
            page: currentPage,
            limit: limitPerPage,
            is_nsfw: false,
            direction: 'ASC',
          },
        }
      );

      console.log(`   Total tokens in page: ${response.tokens.length}`);

      // No more tokens available
      if (response.tokens.length === 0) {
        console.log(`   ⚠️  No more tokens available\n`);
        break;
      }

      // Filter tokens with holder_count === 0
      let eligibleInPage = 0;
      for (const token of response.tokens) {
        const holderCount = token.market_info.holder_count;
        const isGraduated = token.token_info.is_graduated;

        if (holderCount === 0 && !isGraduated) {
          // Check if already exists (avoid duplicates)
          const exists = eligibleTokens.some(t => t.tokenAddress === token.token_info.token_id);
          if (!exists) {
            eligibleTokens.push({
              tokenAddress: token.token_info.token_id,
              // metadata: undefined (not available for fetched tokens)
              createdAt: token.token_info.created_at * 1000, // Convert to milliseconds
              // walletIndex: undefined (not available for fetched tokens)
            });
            eligibleInPage++;
          }
        }

        // Stop if we reached target
        if (eligibleTokens.length >= targetCount) {
          break;
        }
      }

      console.log(`   ✅ Found ${eligibleInPage} new eligible tokens (holder_count === 0)`);
      console.log(`   📊 Total: ${eligibleTokens.length}/${targetCount}\n`);

      // Reached target
      if (eligibleTokens.length >= targetCount) {
        console.log(`🎯 Target reached! Found ${eligibleTokens.length} tokens\n`);
        break;
      }

      // Rate limiting: 1 second delay between requests
      console.log(`   ⏳ Waiting 1 second (rate limit)...\n`);
      await sleep(1000);

      currentPage++;

    } catch (error) {
      console.error(`   ❌ Error fetching page ${currentPage}:`, error);
      console.log(`   Stopping at page ${currentPage - 1}\n`);
      break;
    }
  }

  return { tokens: eligibleTokens, lastPage: currentPage };
}

/**
 * Main function
 */
async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🤖 FETCH ELIGIBLE TOKENS FOR VOLUME BOT');
  console.log('='.repeat(80));
  console.log(`Network: ${config.networkMode}`);
  console.log('='.repeat(80) + '\n');

  const dataDir = resolve(__dirname, '../../data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const outputPath = resolve(dataDir, 'eligible-tokens.json');

  try {
    // Load existing data
    const existingData = loadExistingData(outputPath);
    const existingTokens = existingData?.tokens || [];
    const lastPage = existingData?.last_page_read || 29; // Start from page 30
    const startPage = lastPage + 1;

    console.log('📂 Existing data:');
    if (existingData) {
      console.log(`   Tokens: ${existingTokens.length}`);
      console.log(`   Last page read: ${lastPage}`);
      console.log(`   Will start from page: ${startPage}\n`);
    } else {
      console.log(`   No existing data found`);
      console.log(`   Starting fresh from page: ${startPage}\n`);
    }

    // Fetch eligible tokens
    const targetCount = parseInt(process.env.FETCH_TARGET_COUNT || '30');
    const result = await fetchEligibleTokens(targetCount, startPage, 100, existingTokens);

    console.log('\n' + '='.repeat(80));
    console.log('📊 RESULTS');
    console.log('='.repeat(80));
    console.log(`Total eligible tokens: ${result.tokens.length}`);
    console.log(`Last page read: ${result.lastPage}`);
    console.log('='.repeat(80) + '\n');

    if (result.tokens.length === 0) {
      console.log('⚠️  No eligible tokens found (holder_count === 0)');
      console.log('   Try creating some tokens first with: npm run cron:peak\n');
      process.exit(0);
    }

    // Display first 10
    console.log('First 10 eligible tokens:');
    result.tokens.slice(0, 10).forEach((token: EligibleToken, i: number) => {
      const date = new Date(token.createdAt).toLocaleDateString();
      console.log(`  ${i + 1}. ${token.tokenAddress} (Created: ${date})`);
    });

    if (result.tokens.length > 10) {
      console.log(`  ... and ${result.tokens.length - 10} more\n`);
    }

    // Save to file
    const fileData: EligibleTokensFile = {
      tokens: result.tokens,
      total_count: result.tokens.length,
      last_page_read: result.lastPage,
      start_page: startPage,
    };

    writeFileSync(
      outputPath,
      JSON.stringify(fileData, null, 2),
      'utf-8'
    );

    console.log(`✅ Saved to: ${outputPath}`);
    console.log(`   Tokens: ${result.tokens.length}`);
    console.log(`   Last page: ${result.lastPage}`);
    console.log('\n💡 You can now test volume bot with these tokens!');
    console.log('   Run again to fetch more tokens (will continue from page ${result.lastPage + 1})\n');

  } catch (error) {
    console.error('\n❌ Failed to fetch eligible tokens:', error);
    process.exit(1);
  }
}

main();
