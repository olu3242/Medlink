from email.message import Message
from io import BytesIO
from urllib.error import HTTPError

import pytest

from tools.nafdac_manufacturers.client import GreenbookClient, HttpPolicy
from tools.nafdac_manufacturers.parser import SourceContractError


class Response(BytesIO):
    status = 200
    headers = Message()
    headers["Content-Type"] = "text/html; charset=UTF-8"

    def __init__(self, body: str, url: str):
        super().__init__(body.encode())
        self.url = url

    def geturl(self):
        return self.url

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def card(source_id: int, page: int, next_page: int | None = None) -> str:
    next_link = f"<a href='/manufacturers?page={next_page}' rel='next'>Next</a>" if next_page else ""
    return f"<a href='/manufacturer/products/{source_id}'><h5>Name {source_id}</h5><span>0 Products, 0 Ingredients</span></a>{next_link}"


def test_retry_after_and_success() -> None:
    calls, sleeps = [], []
    headers = Message(); headers["Retry-After"] = "2"
    error = HTTPError("https://example.test", 429, "slow", headers, None)
    responses = iter([error, Response(card(1, 1), "https://greenbook.nafdac.gov.ng/manufacturers")])
    def opener(*args, **kwargs):
        result = next(responses); calls.append(result)
        if isinstance(result, Exception): raise result
        return result
    client = GreenbookClient(HttpPolicy(max_attempts=2, minimum_interval_seconds=0), sleep=sleeps.append, opener=opener, random_value=lambda: 0)
    assert client.fetch_page("https://greenbook.nafdac.gov.ng/manufacturers")[0] == 200
    assert sleeps == [2]


def test_dynamic_traversal_and_terminal_page() -> None:
    responses = iter([
        Response(card(1, 1, 2), "https://greenbook.nafdac.gov.ng/manufacturers"),
        Response(card(2, 2), "https://greenbook.nafdac.gov.ng/manufacturers?page=2"),
    ])
    client = GreenbookClient(HttpPolicy(minimum_interval_seconds=0), opener=lambda *_args, **_kwargs: next(responses))
    assert [page.current_page for _, page in client.traverse("https://greenbook.nafdac.gov.ng/manufacturers")] == [1, 2]


def test_repeated_manufacturer_set_is_rejected() -> None:
    responses = iter([
        Response(card(1, 1, 2), "https://greenbook.nafdac.gov.ng/manufacturers"),
        Response(card(1, 2), "https://greenbook.nafdac.gov.ng/manufacturers?page=2"),
    ])
    client = GreenbookClient(HttpPolicy(minimum_interval_seconds=0), opener=lambda *_args, **_kwargs: next(responses))
    with pytest.raises(SourceContractError, match="repeated manufacturer set"):
        list(client.traverse("https://greenbook.nafdac.gov.ng/manufacturers"))
