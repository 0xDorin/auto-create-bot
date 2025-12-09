/**
 * Network-specific contract addresses
 */
type NetworkMode = 'mainnet' | 'testnet';

interface ContractAddresses {
  BONDING_CURVE: string;
  BONDING_CURVE_ROUTER: string;
  DEX_ROUTER: string;
  LENS: string;
  REWARD_POOL?: string;
  CREATOR_TREASURY?: string;
  DEX_FACTORY?: string;
  WMON?: string;
}

export const CONTRACTS: Record<NetworkMode, ContractAddresses> = {
  testnet: {
    BONDING_CURVE: '0x985Ae3529A1875698772C5fFbc66b8327049E094',
    BONDING_CURVE_ROUTER: '0x2D729C91aB77a887b3579aa50f55B50E5bC6dE46',
    DEX_ROUTER: '0x8a7697098da7F8692325046DB98F3dA9c480B529',
    REWARD_POOL: '0x0FbF77ec779a2500d9C7Ee1f4DbC93dD62ec6694',
    LENS: '0x143dc84ac094edECABeF577Fb326aa4d9893D97B',
    CREATOR_TREASURY: '0xf52e447a64D0062a2b4c4FC05b9a06d9f29Fe4C5',
    DEX_FACTORY: '0x6B5F564339DbAD6b780249827f2198a841FEB7F3',
    WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
  },
  mainnet: {
    BONDING_CURVE: '0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE',
    BONDING_CURVE_ROUTER: '0x6F6B8F1a20703309951a5127c45B49b1CD981A22',
    DEX_ROUTER: '0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137',
    REWARD_POOL: '0xD5eE94894f3C86952AF792e1a03B1699c08b8c73',
    LENS: '0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea',
    CREATOR_TREASURY: '0x42e75B4B96d7000E7Da1e0c729Cec8d2049B9731',
    DEX_FACTORY: '0x6B5F564339DbAD6b780249827f2198a841FEB7F3',
    WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
  },
} as const;

/**
 * Network Configuration
 */
export const NETWORK_CONFIG = {
  DEPLOY_FEE: '10', // MON
  GRADUATE_FEE: '3000', // MON
  VIRTUAL_MON_RESERVE: '90000', // MON
  VIRTUAL_TOKEN_RESERVE: '1073000191',
  TARGET_TOKEN_AMOUNT: '279900191',
  TOTAL_TOKEN_SUPPLY: '1000000000',
} as const;

/**
 * Wallet Derivation Path (BIP44)
 */
export const DERIVATION_PATH = "m/44'/60'/0'/0"; // Ethereum standard

/**
 * Transaction Defaults
 */
export const TX_DEFAULTS = {
  DEADLINE_OFFSET: 300, // 5 minutes
  SLIPPAGE_BPS: 100, // 1% (100 basis points)
} as const;

/**
 * Timing constants (in milliseconds)
 */
export const TIMING = {
  /** Wait time after transaction receipt for RPC node sync */
  RPC_SYNC_DELAY: 2000, // 2 seconds

  /** Retry delay for balanceOf calls */
  BALANCE_RETRY_DELAY: 2000, // 2 seconds

  /** Max retries for balanceOf calls */
  BALANCE_MAX_RETRIES: 3,

  /** Wallet lock polling interval */
  WALLET_LOCK_POLL_INTERVAL: 2000, // 2 seconds
} as const;
