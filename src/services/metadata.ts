/**
 * Metadata fetching and preparation service
 */

import { config } from '../config';
import { httpGet, httpPost, httpUpload } from './api';
import type {
  TokenListResponse,
  MetadataUploadRequest,
  MetadataUploadResponse,
  PreparedToken,
} from '../types';

// Use mainnet API for token list (more tokens available)
const TOKEN_LIST_API_BASE_URL = config.tokenListApiBaseUrl;

// Use network-specific API for metadata upload
const METADATA_UPLOAD_API_BASE_URL = config.metadataUploadApiBaseUrl;

/**
 * Image upload response
 */
interface ImageUploadResponse {
  image_uri: string;
  is_nsfw: boolean;
}

/**
 * Fetch token list from API (always mainnet)
 */
export function fetchTokenList(
  page: number,
  limit: number
): Promise<TokenListResponse> {
  return httpGet<TokenListResponse>(TOKEN_LIST_API_BASE_URL, '/order/creation_time', {
    params: {
      page,
      limit,
      is_nsfw: false,
      direction: 'ASC',
    },
  });
}

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
  // Download image as buffer
  const imageBuffer = await downloadImage(imageUrl);

  // Detect content type from URL
  const contentType = detectContentType(imageUrl);

  // Upload as binary with Content-Type header
  return httpUpload<ImageUploadResponse>(
    METADATA_UPLOAD_API_BASE_URL,
    '/metadata/image',
    imageBuffer,
    contentType
  );
}

/**
 * Upload metadata and get metadata URI (network-specific)
 */
export function uploadMetadata(
  metadata: MetadataUploadRequest
): Promise<MetadataUploadResponse> {
  return httpPost<MetadataUploadResponse, MetadataUploadRequest>(
    METADATA_UPLOAD_API_BASE_URL,
    '/metadata/metadata',
    metadata
  );
}

/**
 * Process token list item to prepared token (UPLOAD mode)
 * Downloads image from mainnet and re-uploads to current network
 */
export async function processTokenToMetadataWithUpload(
  tokenInfo: TokenListResponse['tokens'][0]['token_info']
): Promise<PreparedToken> {
  // Step 1: Download and upload image to current network
  console.log(`  Uploading image for ${tokenInfo.symbol}...`);
  const imageUploadResult = await uploadImage(tokenInfo.image_uri);

  // Step 2: Create metadata with new image URI
  const uploadRequest: MetadataUploadRequest = {
    name: tokenInfo.name,
    symbol: tokenInfo.symbol,
    description: tokenInfo.description,
    image_uri: imageUploadResult.image_uri, // Use new image URI
    twitter: tokenInfo.twitter || undefined,
    telegram: tokenInfo.telegram || undefined,
    website: tokenInfo.website || undefined,
  };

  // Step 3: Upload metadata and get metadata URI
  const uploadResponse = await uploadMetadata(uploadRequest);

  // Return prepared token
  return {
    name: tokenInfo.name,
    symbol: tokenInfo.symbol,
    tokenURI: uploadResponse.metadata_uri,
    description: tokenInfo.description,
    imageUri: imageUploadResult.image_uri, // New image URI
    twitter: tokenInfo.twitter || undefined,
    telegram: tokenInfo.telegram || undefined,
    website: tokenInfo.website || undefined,
  };
}

/**
 * Process token list item to prepared token (REUSE mode)
 * Reuses existing metadata URIs without uploading
 * TODO: Implement this when needed
 */
export async function processTokenToMetadataWithReuse(
  tokenInfo: TokenListResponse['tokens'][0]['token_info']
): Promise<PreparedToken> {
  // For now, just use the image_uri as tokenURI
  // This might need adjustment based on actual requirements
  return {
    name: tokenInfo.name,
    symbol: tokenInfo.symbol,
    tokenURI: tokenInfo.image_uri, // Reuse image_uri as tokenURI
    description: tokenInfo.description,
    imageUri: tokenInfo.image_uri,
    twitter: tokenInfo.twitter || undefined,
    telegram: tokenInfo.telegram || undefined,
    website: tokenInfo.website || undefined,
  };
}

/**
 * Fetch and prepare tokens from a single page
 * Uses METADATA_START_PAGE and METADATA_LIMIT_PER_PAGE from config
 */
export async function fetchAndPrepareTokens(
  startPage: number = config.metadataStartPage,
  limit: number = config.metadataLimitPerPage
): Promise<PreparedToken[]> {
  const preparedTokens: PreparedToken[] = [];

  console.log(`Fetching tokens from page ${startPage} (limit: ${limit})...`);
  console.log(`Mode: ${config.metadataMode}\n`);

  try {
    const tokenList = await fetchTokenList(startPage, limit);

    console.log(`Processing ${tokenList.tokens.length} tokens from page ${startPage}...`);

    // Process each token with delay to avoid rate limiting
    for (const token of tokenList.tokens) {
      try {
        // Choose processing method based on mode
        const preparedToken =
          config.metadataMode === 'upload'
            ? await processTokenToMetadataWithUpload(token.token_info)
            : await processTokenToMetadataWithReuse(token.token_info);

        preparedTokens.push(preparedToken);

        console.log(
          `[${preparedTokens.length}/${tokenList.tokens.length}] Prepared: ${preparedToken.symbol}`
        );

        // Small delay to avoid rate limiting
        await delay(500); // Increased delay for image upload
      } catch (error) {
        console.error(
          `Failed to process token ${token.token_info.symbol}:`,
          error
        );
        // Continue with next token on error
      }
    }
  } catch (error) {
    console.error(`Failed to fetch page ${startPage}:`, error);
    throw error;
  }

  console.log(`Successfully prepared ${preparedTokens.length} tokens`);
  return preparedTokens;
}

/**
 * Utility: delay for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
