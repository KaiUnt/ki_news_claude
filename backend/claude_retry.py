"""Exponential-backoff retry wrapper for Claude API calls."""
import logging
import time
import anthropic

logger = logging.getLogger(__name__)


def call_with_retry(fn, *, max_retries: int = 3, base_delay: float = 2.0):
    """Call fn() and retry on transient Claude API errors with exponential backoff.

    Retries on: RateLimitError (429), APIConnectionError, APIStatusError >= 500.
    Propagates immediately on all other exceptions.
    """
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except (anthropic.RateLimitError, anthropic.APIConnectionError) as exc:
            if attempt == max_retries:
                raise
            delay = base_delay * (2 ** attempt)
            logger.warning("[Claude] %s — retry %d/%d in %ds", type(exc).__name__, attempt + 1, max_retries, delay)
            time.sleep(delay)
        except anthropic.APIStatusError as exc:
            if exc.status_code >= 500 and attempt < max_retries:
                delay = base_delay * (2 ** attempt)
                logger.warning("[Claude] HTTP %d — retry %d/%d in %ds", exc.status_code, attempt + 1, max_retries, delay)
                time.sleep(delay)
            else:
                raise
