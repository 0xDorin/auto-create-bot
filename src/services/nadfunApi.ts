/**
 * nad.fun API Service
 * Centralized API calls for nad.fun platform
 */

import { config } from '../config';
import { httpGet, httpPost, httpUpload } from './api';
import type { TokenListResponse, MetadataUploadRequest, MetadataUploadResponse } from '../types';

// =============================================================================
// API Base URLs
// =============================================================================

/** Token list API (always mainnet - more tokens available) */
const getTokenListBaseUrl = () => config.tokenListApiBaseUrl;

/** Metadata upload API (network-specific) */
const getMetadataBaseUrl = () => config.metadataUploadApiBaseUrl;

/** Trade API (network-specific) */
const getTradeBaseUrl = () =>
  config.networkMode === 'mainnet'
    ? process.env.MAINNET_METADATA_API_BASE_URL!
    : process.env.TESTNET_METADATA_API_BASE_URL!;

// =============================================================================
// Types
// =============================================================================

/** Token list tab options */
export type TokensTab = 'latest_trade' | 'creation_time_desc' | 'creation_time_asc' | 'market_cap';

/** Pagination params */
export interface PaginationParams {
  page: number;
  limit: number;
  is_nsfw?: boolean;
}

/** Holder info response */
export interface HolderResponse {
  holders: Array<{
    account_info: {
      account_id: string;
      bio: string;
      image_uri: string;
      nickname: string;
    };
    balance_info: {
      balance: string;
      created_at: number;
      native_price: string;
      token_price: string;
    };
  }>;
  total_count: number;
}

/** Image upload response */
export interface ImageUploadResponse {
  image_uri: string;
  is_nsfw: boolean;
}

// =============================================================================
// Token List API
// =============================================================================

/**
 * Fetch token list by tab
 * - creation_time_asc / creation_time_desc: /order/creation_time with direction
 * - latest_trade: /order/latest_trade
 * - market_cap: /order/market_cap
 */
export async function getTokenList(
  params: PaginationParams,
  tab: TokensTab = 'creation_time_asc'
): Promise<TokenListResponse> {
  const baseUrl = getTokenListBaseUrl();
  const queryParams = {
    page: params.page,
    limit: params.limit,
    is_nsfw: params.is_nsfw ?? false,
  };

  if (tab === 'creation_time_desc' || tab === 'creation_time_asc') {
    const direction = tab === 'creation_time_asc' ? 'ASC' : 'DESC';
    return httpGet<TokenListResponse>(baseUrl, '/order/creation_time', {
      params: { ...queryParams, direction },
    });
  } else {
    return httpGet<TokenListResponse>(baseUrl, `/order/${tab}`, {
      params: queryParams,
    });
  }
}

// =============================================================================
// Trade API
// =============================================================================

/**
 * Get holders for a token
 */
export async function getHolders(tokenAddress: string): Promise<HolderResponse> {
  return httpGet<HolderResponse>(getTradeBaseUrl(), `/trade/holder/${tokenAddress}`);
}

/**
 * Get holder count only (convenience wrapper)
 */
export async function getHolderCount(tokenAddress: string): Promise<number> {
  const response = await getHolders(tokenAddress);
  return response.total_count;
}

// =============================================================================
// Metadata API
// =============================================================================

/**
 * Download image from URL
 */
async function downloadImage(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Detect content type from image URL
 */
function detectContentType(imageUrl: string): string {
  const ext = imageUrl.split('.').pop()?.toLowerCase().split('?')[0];
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}

/**
 * Upload image to API
 */
export async function uploadImage(imageUrl: string): Promise<ImageUploadResponse> {
  const imageBuffer = await downloadImage(imageUrl);
  const contentType = detectContentType(imageUrl);

  return httpUpload<ImageUploadResponse>(
    getMetadataBaseUrl(),
    '/metadata/image',
    imageBuffer,
    contentType
  );
}

/**
 * Upload metadata and get metadata URI
 */
export async function uploadMetadata(
  metadata: MetadataUploadRequest
): Promise<MetadataUploadResponse> {
  return httpPost<MetadataUploadResponse, MetadataUploadRequest>(
    getMetadataBaseUrl(),
    '/metadata/metadata',
    metadata
  );
}
