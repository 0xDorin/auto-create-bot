/**
 * Script to prepare metadata before running the bot
 *
 * Usage:
 *   npm run prepare-metadata              # Auto-continue from last page
 *   npm run prepare-metadata -- --reset   # Start from page 1
 *   npm run prepare-metadata -- --page 5  # Start from specific page
 */

import { fetchAndPrepareTokens } from '../services/metadata';
import { appendMetadata, loadMetadataState, updateMetadataState, resetMetadataState } from '../services/storage';
import { config } from '../config';

async function main() {
  // Parse command line flags
  const args = process.argv.slice(2);
  const resetMode = args.includes('--reset');
  const pageArgIndex = args.indexOf('--page');
  const manualPage = pageArgIndex !== -1 ? parseInt(args[pageArgIndex + 1], 10) : null;

  console.log('=== Metadata Preparation Script ===\n');

  // Handle reset mode
  if (resetMode) {
    resetMetadataState();
    console.log('🔄 Reset mode: Starting from page 1\n');
  }

  // Load current state
  const metadataState = loadMetadataState();

  // Determine start page (priority: manual > auto > config > 1)
  let startPage: number;
  if (manualPage && !isNaN(manualPage)) {
    startPage = manualPage;
    console.log(`📍 Manual page specified: ${startPage}`);
  } else if (metadataState.lastPage > 0 && !resetMode) {
    startPage = metadataState.lastPage + 1;
    console.log(`📍 Auto-continuing from last page: ${metadataState.lastPage} → ${startPage}`);
  } else {
    startPage = config.metadataStartPage || 1;
    console.log(`📍 Starting from config/default page: ${startPage}`);
  }

  // Show state info
  if (metadataState.lastPreparedAt) {
    const lastRunDate = new Date(metadataState.lastPreparedAt).toLocaleString();
    console.log(`   Last run: ${lastRunDate}`);
    console.log(`   Total prepared (lifetime): ${metadataState.totalPrepared || 0} tokens`);
  }
  console.log();

  console.log(`Network mode: ${config.networkMode} (tokens will be created here)`);
  console.log(`Metadata mode: ${config.metadataMode}`);
  console.log(`Token list API: ${config.tokenListApiBaseUrl} (always mainnet for more tokens)`);
  console.log(`Metadata upload API: ${config.metadataUploadApiBaseUrl} (${config.networkMode})`);
  console.log(`Limit per page: ${config.metadataLimitPerPage}`);
  console.log(`\n→ Will prepare ${config.metadataLimitPerPage} metadata entries from page ${startPage}\n`);

  if (config.metadataMode === 'upload') {
    console.log('⚠️  UPLOAD mode: Images will be downloaded and re-uploaded');
    console.log('   This may take longer due to image processing\n');
  } else {
    console.log('⚠️  REUSE mode: Existing metadata URIs will be reused');
    console.log('   (This mode is not fully implemented yet)\n');
  }

  try {
    // Fetch and prepare tokens
    const tokens = await fetchAndPrepareTokens(
      startPage,
      config.metadataLimitPerPage
    );

    if (tokens.length === 0) {
      console.log('\n⚠️  No tokens found on this page. You may have reached the end.');
      console.log('   Try: npm run prepare-metadata -- --reset');
      process.exit(0);
    }

    // Append to existing metadata file
    appendMetadata(tokens);

    // Update state with last processed page
    updateMetadataState(startPage, tokens.length);

    console.log('\n✅ Metadata preparation completed successfully!');
    console.log(`   Added ${tokens.length} new metadata entries from page ${startPage}`);
    console.log(`   Next run will automatically start from page ${startPage + 1}`);

    console.log(`\nBot will randomly select from these when creating tokens.`);
    console.log(`You can now run the bot with: npm run dev`);
    console.log(`\nTip: Run again to fetch next page, or use --reset to start over`);
  } catch (error) {
    console.error('\n❌ Metadata preparation failed:', error);
    process.exit(1);
  }
}

main();
