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

export interface RetryOptions {
  /** Number of extra attempts after the first (default 2). */
  retries?: number;
  /** Base delay between attempts in ms; grows linearly per attempt (default 500). */
  delayMs?: number;
  /** Predicate deciding whether a given error is worth retrying. */
  shouldRetry?: (error: any) => boolean;
}

/**
 * Runs an async operation, retrying it on transient auth failures. Each retry
 * re-invokes `operation`, which re-fetches a token from the host, so a stale
 * token is replaced without the user seeing an error.
 */
export async function withAuthRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 500;
  const shouldRetry = options.shouldRetry ?? isTransientAuthError;

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
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }

  throw lastError;
}
