type FetchRetryOptions = {
  maxRetries?: number;
  onRetry?: (retry: number) => void;
};

function waitForRetry(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchRetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  const signal = init.signal;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (!isRetryableStatus(response.status) || attempt === maxRetries) return response;
    } catch (error) {
      if (signal?.aborted || attempt === maxRetries) throw error;
    }

    options.onRetry?.(attempt + 1);
    await waitForRetry(1000 * (attempt + 1), signal);
  }

  throw new Error('Request failed after retries.');
}