/**
 * Type definitions
 */

export interface TokenMetadata {
  name: string;
  symbol: string;
  description: string;
  imageUri: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface TokenListItem {
  token_info: {
    token_id: string;
    name: string;
    symbol: string;
    image_uri: string;
    description: string;
    is_graduated: boolean;
    is_nsfw: boolean;
    twitter: string | null;
    telegram: string | null;
    website: string | null;
    created_at: number;
    creator: {
      account_id: string;
      nickname: string;
      bio: string;
      image_uri: string;
    };
  };
  market_info: {
    market_type: string;
    token_id: string;
    market_id: string;
    reserve_native: string;
    reserve_token: string;
    token_price: string;
    native_price: string;
    price: string;
    total_supply: string;
    volume: string;
    ath_price: string;
    holder_count: number;
  };
  percent: number;
}

export interface TokenListResponse {
  tokens: TokenListItem[];
  total_count: number;
}

export interface MetadataUploadRequest {
  description: string;
  image_uri: string;
  name: string;
  symbol: string;
  telegram?: string;
  twitter?: string;
  website?: string;
}

export interface MetadataUploadResponse {
  metadata: {
    description: string;
    image_uri: string;
    is_nsfw: boolean;
    name: string;
    symbol: string;
    telegram: string;
    twitter: string;
    website: string;
  };
  metadata_uri: string;
}

export interface PreparedToken {
  name: string;
  symbol: string;
  tokenURI: string;
  description: string;
  imageUri: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface PreparedTokensFile {
  tokens: PreparedToken[];
  total_count: number;
}
