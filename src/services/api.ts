/**
 * Type-safe HTTP client utilities
 */

interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | boolean>;
}

/**
 * Build URL with query parameters
 */
function buildURL(baseURL: string, path: string, params?: Record<string, string | number | boolean>): string {
  const url = new URL(path, baseURL);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value.toString());
      }
    });
  }

  return url.toString();
}

/**
 * Type-safe HTTP GET request
 */
export async function httpGet<T>(
  baseURL: string,
  path: string,
  options?: FetchOptions
): Promise<T> {
  const url = buildURL(baseURL, path, options?.params);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(
      `HTTP GET failed: ${response.status} ${response.statusText} (${url})`
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Type-safe HTTP POST request with JSON body
 */
export async function httpPost<TResponse, TBody = unknown>(
  baseURL: string,
  path: string,
  body?: TBody,
  options?: FetchOptions
): Promise<TResponse> {
  const url = buildURL(baseURL, path, options?.params);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options?.headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    ...options,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `HTTP POST failed: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  return response.json() as Promise<TResponse>;
}

/**
 * Upload binary data (e.g., images)
 */
export async function httpUpload<TResponse>(
  baseURL: string,
  path: string,
  data: Buffer | ArrayBuffer,
  contentType: string
): Promise<TResponse> {
  const url = buildURL(baseURL, path);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
    },
    body: data,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `HTTP upload failed: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  return response.json() as Promise<TResponse>;
}
