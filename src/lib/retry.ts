// Resilience helpers for the transient auth failures that surface as
// "TF400813: The user 'aaaaaaaa-...' is not authorized to access this
// resource". Every REST call re-mints a token from the host via
// DevOps.getAccessToken(), so re-issuing the operation picks up a fresh token
// and typically succeeds - the same recovery a manual page refresh performs by
// hand. The platform's own 401-refresh-retry does not re-issue the request in
// the bundled azure-devops-extension-api, so we retry here instead.

// The placeholder identity Azure DevOps reports when a request arrives without
// a token it can resolve to a user.
const ANONYMOUS_USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// Minimum base delay between retries of an auth failure.
const AUTH_RETRY_DELAY_MS = 2000;

/**
 * Returns true when an error looks like a transient Azure DevOps auth failure
 * that a fresh token would resolve (HTTP 401 or the TF400813 anonymous-user
 * response).
 */
export function isTransientAuthError(error: any): boolean {
  if (!error) {
    return false;
  }

  if (error.status === 401 || error.statusCode === 401) {
    return true;
  }

  const message = `${error.message ?? error}`;
  return message.indexOf("TF400813") >= 0 || message.indexOf(ANONYMOUS_USER_ID) >= 0;
}

/**
 * Returns true for transient network/service failures (HTTP 502/503/504 or the
 * TF400893 "Unable to contact the server" response, which is also how a 503
 * without CORS headers surfaces).
 */
export function isTransientNetworkError(error: any): boolean {
  if (!error) {
    return false;
  }

  const status = error.status ?? error.statusCode;
  if (status === 502 || status === 503 || status === 504) {
    return true;
  }

  const message = `${error.message ?? error}`;
  return message.indexOf("TF400893") >= 0 || message.indexOf("Failed to fetch") >= 0;
}

export interface RetryOptions {
  /** Number of extra attempts after the first (default 2). */
  retries?: number;
  /** Base delay between attempts in ms; grows linearly per attempt (default 500). */
  delayMs?: number;
  /** Predicate deciding whether a given error is worth retrying. */
  shouldRetry?: (error: any) => boolean;
}

/**
 * Runs an async operation, retrying it on transient auth/network failures. Each retry
 * re-invokes `operation`, which re-fetches a token from the host, so a stale
 * token is replaced without the user seeing an error.
 */
export async function withAuthRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 500;
  const shouldRetry =
    options.shouldRetry ?? ((error: any) => isTransientAuthError(error) || isTransientNetworkError(error));

  let lastError: any;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === retries || !shouldRetry(error)) {
        throw error;
      }

      // Linear backoff before re-issuing; the next attempt fetches a new token.
      // The host hands back its cached token until it refreshes it, so auth
      // failures wait longer to give it a chance to do so.
      const baseDelay = isTransientAuthError(error) ? Math.max(delayMs, AUTH_RETRY_DELAY_MS) : delayMs;
      await new Promise((resolve) => setTimeout(resolve, baseDelay * (attempt + 1)));
    }
  }

  throw lastError;
}
