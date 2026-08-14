import logging
import json
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .models import ManufacturerPage
from .parser import SourceContractError, parse_manufacturer_page


@dataclass(frozen=True)
class HttpPolicy:
    timeout_seconds: float = 30
    max_attempts: int = 3
    backoff_seconds: float = 1
    jitter_seconds: float = 0.25
    minimum_interval_seconds: float = 1.25
    maximum_pages: int = 100


class GreenbookClient:
    def __init__(self, policy: HttpPolicy = HttpPolicy(), *, sleep=time.sleep, clock=time.monotonic, opener=urlopen, random_value=random.random) -> None:
        self.policy, self._sleep, self._clock, self._opener, self._random = policy, sleep, clock, opener, random_value
        self._last_request: float | None = None
        self.log = logging.getLogger(__name__)

    def _wait_for_rate_limit(self) -> None:
        if self._last_request is not None:
            delay = self.policy.minimum_interval_seconds - (self._clock() - self._last_request)
            if delay > 0:
                self._sleep(delay)

    def get_text(self, url: str) -> tuple[int, str, str]:
        for attempt in range(1, self.policy.max_attempts + 1):
            self._wait_for_rate_limit()
            self._last_request = self._clock()
            try:
                request = Request(url, headers={"User-Agent": "Medlink-MERDP-source-contract/1.0 (+https://github.com/olu3242/Medlink)", "Accept": "text/html"})
                with self._opener(request, timeout=self.policy.timeout_seconds) as response:
                    status = int(response.status)
                    final_url = response.geturl()
                    content_type = response.headers.get("Content-Type", "")
                    if status != 200 or "text/html" not in content_type.lower():
                        raise SourceContractError(f"unexpected response: {status} {content_type}")
                    return status, response.read().decode("utf-8"), final_url
            except (HTTPError, URLError, TimeoutError) as error:
                retryable = not isinstance(error, HTTPError) or error.code in {429, 500, 502, 503, 504}
                if not retryable or attempt == self.policy.max_attempts:
                    raise RuntimeError(f"NAFDAC request failed after {attempt} attempt(s): {url}") from error
                retry_after = error.headers.get("Retry-After") if isinstance(error, HTTPError) else None
                delay = self._retry_delay(attempt, retry_after)
                self.log.warning("retrying NAFDAC request", extra={"url": url, "attempt": attempt, "delay_seconds": delay})
                self._sleep(delay)
        raise AssertionError("unreachable")

    def get_json(self, url: str) -> tuple[int, object, str]:
        """Fetch an authoritative JSON response with the same bounded policy."""
        for attempt in range(1, self.policy.max_attempts + 1):
            self._wait_for_rate_limit()
            self._last_request = self._clock()
            try:
                request = Request(url, headers={"User-Agent": "Medlink-MERDP-source-contract/1.0 (+https://github.com/olu3242/Medlink)", "Accept": "application/json", "X-Requested-With": "XMLHttpRequest"})
                with self._opener(request, timeout=self.policy.timeout_seconds) as response:
                    status = int(response.status)
                    content_type = response.headers.get("Content-Type", "")
                    if status != 200 or "json" not in content_type.lower():
                        raise SourceContractError(f"unexpected response: {status} {content_type}")
                    try:
                        return status, json.loads(response.read().decode("utf-8")), response.geturl()
                    except (UnicodeDecodeError, json.JSONDecodeError) as error:
                        raise SourceContractError("SOURCE_SCHEMA_MISMATCH: malformed JSON") from error
            except (HTTPError, URLError, TimeoutError) as error:
                retryable = not isinstance(error, HTTPError) or error.code in {429, 500, 502, 503, 504}
                if not retryable or attempt == self.policy.max_attempts:
                    raise RuntimeError(f"NAFDAC request failed after {attempt} attempt(s): {url}") from error
                self._sleep(self._retry_delay(attempt, error.headers.get("Retry-After") if isinstance(error, HTTPError) else None))
        raise AssertionError("unreachable")

    def _retry_delay(self, attempt: int, retry_after: str | None) -> float:
        if retry_after:
            try:
                return max(0, float(retry_after))
            except ValueError:
                try:
                    return max(0, (parsedate_to_datetime(retry_after) - datetime.now(timezone.utc)).total_seconds())
                except (TypeError, ValueError):
                    pass
        return self.policy.backoff_seconds * (2 ** (attempt - 1)) + self.policy.jitter_seconds * self._random()

    def fetch_page(self, url: str) -> tuple[int, ManufacturerPage]:
        status, html, final_url = self.get_text(url)
        return status, parse_manufacturer_page(html, final_url, datetime.now(timezone.utc))

    def traverse(self, start_url: str):
        url: str | None = start_url
        seen_urls: set[str] = set()
        seen_sets: set[tuple[str, ...]] = set()
        expected_page = 1
        while url:
            if len(seen_urls) >= self.policy.maximum_pages:
                raise SourceContractError("pagination exceeded defensive maximum")
            if url in seen_urls:
                raise SourceContractError("pagination URL loop")
            seen_urls.add(url)
            status, page = self.fetch_page(url)
            if page.current_page != expected_page:
                raise SourceContractError(f"unexpected page sequence: {page.current_page}, expected {expected_page}")
            signature = tuple(record.source_id for record in page.records)
            if signature in seen_sets:
                raise SourceContractError("repeated manufacturer set")
            seen_sets.add(signature)
            yield status, page
            if page.next_url is None:
                return
            url, expected_page = page.next_url, expected_page + 1
