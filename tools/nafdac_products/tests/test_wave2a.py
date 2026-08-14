import json
from pathlib import Path
from urllib.error import HTTPError

import pytest

from tools.nafdac_manufacturers.client import GreenbookClient, HttpPolicy
from tools.nafdac_manufacturers.parser import SourceContractError
from tools.nafdac_products.acquire import acquire_snapshot

class Response:
    status=200
    headers={"Content-Type":"application/json"}
    def __init__(self,value,url="https://greenbook.nafdac.gov.ng/"): self.value=value; self.url=url
    def __enter__(self): return self
    def __exit__(self,*_): pass
    def read(self): return json.dumps(self.value).encode()
    def geturl(self): return self.url

def row(pid):
    return {"product_id":pid,"ingredient":{"ingredient_name":"A"},"form":{"name":"Tablet"},"applicant":{"name":"X"},"route":{"name":"Oral"},"product_category":{"name":"Drugs"}}

def test_snapshot_is_atomic_and_replays_checkpoints(tmp_path: Path):
    calls=[]
    def opener(*args,**kwargs): calls.append(1); return Response({"recordsTotal":2,"data":[row(1),row(2)]})
    client=GreenbookClient(HttpPolicy(minimum_interval_seconds=0),opener=opener)
    first=acquire_snapshot(tmp_path,"abc","def",client=client,page_size=100)
    second=acquire_snapshot(tmp_path,"abc","def",client=GreenbookClient(HttpPolicy(minimum_interval_seconds=0),opener=lambda *_a,**_k: pytest.fail("network replay")),page_size=100)
    assert first["records"]==second["records"]==2 and len(calls)==1

def test_malformed_json_and_schema_shift_fail_closed(tmp_path: Path):
    class Bad(Response):
        def read(self): return b"not-json"
    with pytest.raises(SourceContractError): GreenbookClient(HttpPolicy(minimum_interval_seconds=0),opener=lambda *_a,**_k:Bad({})).get_json("https://example.test/x")
    with pytest.raises(SourceContractError): acquire_snapshot(tmp_path,"a","b",client=GreenbookClient(HttpPolicy(minimum_interval_seconds=0),opener=lambda *_a,**_k:Response({"wrong":[]})))

def test_bounded_server_retry():
    calls=[]
    def opener(*_a,**_k): calls.append(1); raise HTTPError("x",500,"bad",{},None)
    with pytest.raises(RuntimeError): GreenbookClient(HttpPolicy(max_attempts=2,minimum_interval_seconds=0,backoff_seconds=0,jitter_seconds=0),opener=opener).get_json("https://example.test/x")
    assert len(calls)==2
