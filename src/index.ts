/**
 * Token Creation Bot - Main Entry Point
 */

import { runScheduler } from './services/scheduler';

async function main() {
  try {
    await runScheduler();
  } catch (error) {
    console.error('\n❌ Bot error:', error);
    process.exit(1);
  }
}

main();
