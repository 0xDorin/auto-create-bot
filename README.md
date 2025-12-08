# Token Creation Bot for Monad

Automated token creation bot for Monad network with bonding curve integration.

## Features

- ✅ Testnet/Mainnet mode support
- ✅ Mnemonic-based HD wallet management
- ✅ Automated metadata preparation from NAD API
- ✅ Token creation with initial buy
- ✅ Automatic sell after creation
- ✅ Scheduled execution (e.g., 100 tokens in 4 hours)
- ✅ State persistence and resumable
- ✅ Retry logic with exponential backoff
- ✅ Built with viem (best practices)

## Prerequisites

- Node.js 20+
- A mnemonic with funded master wallet (index 0)

## Installation

```bash
npm install
```

## Configuration

1. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

2. Edit `.env` and configure:

```bash
# Network mode
NETWORK_MODE=mainnet  # or testnet

# Mainnet
MAINNET_RPC_URL=https://your-monad-rpc.com
MAINNET_CHAIN_ID=10200
MAINNET_API_BASE_URL=https://api.nad.fun

# Wallet
MNEMONIC=your twelve word mnemonic here

# Bot settings
NUM_WALLETS=10                 # Number of wallets to use
TOTAL_TOKENS_TO_CREATE=100     # Total tokens to create
DURATION_HOURS=4               # Duration in hours

# Trading
INITIAL_BUY_AMOUNT=0.1         # MON amount for initial buy
SELL_PERCENTAGE=100            # Percentage to sell (0-100)

# Funding
WALLET_FUNDING_AMOUNT=50       # MON to send to each wallet
```

## Usage

### 1. View Wallet Addresses

```bash
npm run show-wallets
```

This shows all derived wallet addresses from your mnemonic.

### 2. Fund Wallets

```bash
npm run fund-wallets
```

Funds all wallets from master wallet (index 0). Make sure your master wallet has enough MON.

### 3. Prepare Metadata

```bash
npm run prepare-metadata
```

Fetches token metadata from NAD API and uploads to get metadata URIs. Saves to `data/metadata.json`.

**What it does:**

- Fetches oldest tokens from NAD
- Uploads metadata to get `metadata_uri`
- Saves prepared data for bot execution

### 4. Run the Bot

```bash
npm run dev
```

Starts the token creation bot with:

- Reads metadata from `data/metadata.json`
- Creates tokens at scheduled intervals
- Saves state to `data/state.json` (resumable)

**Example flow:**

- 100 tokens in 4 hours = 1 token every 2.4 minutes
- Distributes across all wallets (round-robin)
- Each token: create → initial buy → sell percentage

## Scripts

| Command                    | Description                     |
| -------------------------- | ------------------------------- |
| `npm run dev`              | Run the bot                     |
| `npm run prepare-metadata` | Prepare metadata before running |
| `npm run show-wallets`     | Display wallet addresses        |
| `npm run fund-wallets`     | Fund wallets from master        |
| `npm run build`            | Build TypeScript                |
| `npm start`                | Run built version               |

## Architecture

```
src/
├── abi/                  # Contract ABIs (typed)
│   ├── bondingCurveRouter.ts
│   ├── lens.ts
│   └── erc20.ts
├── config/               # Configuration
│   ├── index.ts          # Main config (network mode, env vars)
│   └── constants.ts      # Contract addresses, constants
├── services/             # Core services
│   ├── wallet.ts         # HD wallet management (viem)
│   ├── contracts.ts      # Contract interactions (viem)
│   ├── metadata.ts       # Metadata fetching/upload
│   ├── storage.ts        # JSON-based persistence
│   ├── tokenCreator.ts   # Token creation workflow
│   └── scheduler.ts      # Bot scheduler
├── scripts/              # Utility scripts
│   ├── prepare-metadata.ts
│   ├── show-wallets.ts
│   └── fund-wallets.ts
├── types/                # TypeScript types
└── index.ts              # Main entry point
```

## State Management

Bot state is saved to `data/state.json`:

```json
{
  "currentTokenIndex": 10,
  "tokensCreated": 10,
  "startTime": 1234567890,
  "lastCreatedAt": 1234567890,
  "createdTokens": [...]
}
```

**Resumable:** If bot crashes, run `npm run dev` again to resume from last saved state.

## Error Handling

- **Retry logic:** 3 attempts with exponential backoff
- **State persistence:** Progress saved after each token
- **Error recovery:** Resume from where it stopped

## Safety Features

- Slippage protection (1% default)
- Transaction confirmation waiting
- Balance checks before operations
- Graduated token detection

## Contract Addresses (Mainnet)

```
BONDING_CURVE_ROUTER: 0x6F6B8F1a20703309951a5127c45B49b1CD981A22
BONDING_CURVE:        0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE
LENS:                 0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea
DEX_ROUTER:           0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137
```

## Development

Built with viem best practices:

- Type-safe contract interactions
- Proper wallet client separation (public/wallet)
- Custom chain configuration
- HD wallet derivation (BIP44)
- Transaction receipt confirmation
- Event log parsing

## License

MIT
