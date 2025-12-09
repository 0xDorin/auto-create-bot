/**
 * Script to prepare metadata before running the bot
 *
 * Usage:
 *   npm run prepare-metadata           # Append to existing (default)
 *   npm run prepare-metadata -- --replace  # Replace all existing
 */

import { fetchAndPrepareTokens } from '../services/metadata';
import { saveMetadata, appendMetadata } from '../services/storage';
import { config } from '../config';

async function main() {
  // Check if --replace flag is provided
  const replaceMode = process.argv.includes('--replace');

  console.log('=== Metadata Preparation Script ===\n');
  console.log(`Mode: ${replaceMode ? '🔄 REPLACE' : '➕ APPEND'} (${replaceMode ? 'overwrites' : 'adds to'} existing metadata)`);
  console.log(`Network mode: ${config.networkMode} (tokens will be created here)`);
  console.log(`Metadata mode: ${config.metadataMode}`);
  console.log(`Token list API: ${config.tokenListApiBaseUrl} (always mainnet for more tokens)`);
  console.log(`Metadata upload API: ${config.metadataUploadApiBaseUrl} (${config.networkMode})`);
  console.log(`Start page: ${config.metadataStartPage}`);
  console.log(`Limit per page: ${config.metadataLimitPerPage}`);
  console.log(`\n→ Will prepare ${config.metadataLimitPerPage} metadata entries from page ${config.metadataStartPage}\n`);

  if (config.metadataMode === 'upload') {
    console.log('⚠️  UPLOAD mode: Images will be downloaded and re-uploaded');
    console.log('   This may take longer due to image processing\n');
  } else {
    console.log('⚠️  REUSE mode: Existing metadata URIs will be reused');
    console.log('   (This mode is not fully implemented yet)\n');
  }

  try {
    // Fetch and prepare tokens (uses START_PAGE and LIMIT from config)
    const tokens = await fetchAndPrepareTokens(
      config.metadataStartPage,
      config.metadataLimitPerPage
    );

    // Save to file
    if (replaceMode) {
      saveMetadata(tokens);
      console.log('\n✅ Metadata preparation completed successfully!');
      console.log(`   Replaced with ${tokens.length} metadata entries`);
    } else {
      appendMetadata(tokens);
      console.log('\n✅ Metadata preparation completed successfully!');
      console.log(`   Added ${tokens.length} new metadata entries`);
    }

    console.log(`\nBot will randomly select from these when creating tokens.`);
    console.log(`You can now run the bot with: npm run dev`);
    console.log(`\nTip: Use different METADATA_START_PAGE to fetch new tokens next time`);
  } catch (error) {
    console.error('\n❌ Metadata preparation failed:', error);
    process.exit(1);
  }
}

main();
