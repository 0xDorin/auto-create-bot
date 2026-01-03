/**
 * Network-specific contract addresses
 */
type NetworkMode = "mainnet" | "testnet";

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
    BONDING_CURVE: "0x1228b0dc9481C11D3071E7A924B794CfB038994e",
    BONDING_CURVE_ROUTER: "0x865054F0F6A288adaAc30261731361EA7E908003",
    DEX_ROUTER: "0x65586647FC66221c5f208F9b8FC0A93C72e3a598",
    REWARD_POOL: "0x6e867daE0bDBcD88d585EDED9820355559da4DD3",
    LENS: "0x181B05cD8D73564A22C17825F3413A0f30634CCF",
    CREATOR_TREASURY: "0x04a47B530225C547E92adA51eF81EB0EDECB27Fc",
    DEX_FACTORY: "0x6B5F564339DbAD6b780249827f2198a841FEB7F3",
    WMON: "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701",
  },
  mainnet: {
    BONDING_CURVE: "0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE",
    BONDING_CURVE_ROUTER: "0x6F6B8F1a20703309951a5127c45B49b1CD981A22",
    DEX_ROUTER: "0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137",
    REWARD_POOL: "0xD5eE94894f3C86952AF792e1a03B1699c08b8c73",
    LENS: "0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea",
    CREATOR_TREASURY: "0x42e75B4B96d7000E7Da1e0c729Cec8d2049B9731",
    DEX_FACTORY: "0x6B5F564339DbAD6b780249827f2198a841FEB7F3",
    WMON: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
  },
} as const;

/**
 * Network Configuration
 */
export const NETWORK_CONFIG = {
  DEPLOY_FEE: "10", // MON
  GRADUATE_FEE: "3000", // MON
  VIRTUAL_MON_RESERVE: "90000", // MON
  VIRTUAL_TOKEN_RESERVE: "1073000191",
  TARGET_TOKEN_AMOUNT: "279900191",
  TOTAL_TOKEN_SUPPLY: "1000000000",
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
