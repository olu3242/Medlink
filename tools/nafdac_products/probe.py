import hashlib
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError

from tools.nafdac_manufacturers.client import GreenbookClient
from tools.nafdac_manufacturers.parser import SourceContractError

DETAIL_URL = "https://greenbook.nafdac.gov.ng/products/details/{product_id}"

def _atomic(path: Path, value: object) -> None:
    tmp=path.with_suffix(path.suffix+".tmp"); tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf-8"); tmp.replace(path)

def probe_candidates(candidate_path: Path, output: Path, *, client: GreenbookClient | None = None) -> dict[str, object]:
    client=client or GreenbookClient(); output.mkdir(parents=True,exist_ok=True); checkpoints=output/"detail-checkpoints"; checkpoints.mkdir(exist_ok=True)
    candidates=json.loads(candidate_path.read_text(encoding="utf-8"))["candidates"]; started=time.perf_counter(); network_requests=0; resumed=0
    for position,item in enumerate(candidates,1):
        pid=str(item["productId"]); path=checkpoints/f"{int(pid):08d}.json"
        if path.exists(): resumed+=1; continue
        url=DETAIL_URL.format(product_id=pid); began=time.perf_counter(); retrieved=datetime.now(timezone.utc).isoformat()
        try:
            status,html,final=client.get_text(url); network_requests+=1
            name=str(item.get("productName") or ""); nrn=str(item.get("nrn") or "")
            contract=bool(re.search(r"Manufacturer Name",html,re.I) and re.search(r"Approval Date",html,re.I))
            if not contract: raise SourceContractError("SOURCE_SCHEMA_MISMATCH: detail labels")
            classification="FOUND" if (not name or name.casefold().replace("#","")[:20] in html.casefold().replace("#","")) and (not nrn or nrn.casefold() in html.casefold()) else "SCHEMA_DRIFT"
            manufacturer_match=re.search(r"/manufacturer/products/(\d+)",html)
            value={"product_id":pid,"classification":classification,"http_status":status,"final_url":final,"retrieved_at":retrieved,"duration_seconds":time.perf_counter()-began,"html_sha256":hashlib.sha256(html.encode()).hexdigest(),"name_present":not name or name.casefold().replace("#","")[:20] in html.casefold().replace("#",""),"nrn_present":not nrn or nrn.casefold() in html.casefold(),"manufacturer_source_id":manufacturer_match.group(1) if manufacturer_match else ""}
        except RuntimeError as error:
            cause=error.__cause__; status=cause.code if isinstance(cause,HTTPError) else None
            classification="NOT_FOUND" if status==404 else "SERVER_ERROR" if status and status>=500 else "TERMINAL_FAILURE"
            value={"product_id":pid,"classification":classification,"http_status":status,"retrieved_at":retrieved,"duration_seconds":time.perf_counter()-began,"error":str(error)}
        except SourceContractError as error:
            value={"product_id":pid,"classification":"SCHEMA_DRIFT","http_status":200,"retrieved_at":retrieved,"duration_seconds":time.perf_counter()-began,"error":str(error)}
        _atomic(path,value)
        if position%50==0: print(f"candidate_details={position}/{len(candidates)} resumed={resumed}",flush=True)
    results={p.stem.lstrip('0') or '0':json.loads(p.read_text(encoding='utf-8')) for p in checkpoints.glob('*.json')}
    counts={}
    for value in results.values(): counts[value['classification']]=counts.get(value['classification'],0)+1
    metadata={"candidates":len(candidates),"results":len(results),"classifications":counts,"network_requests":network_requests,"resumed":resumed,"duration_seconds":time.perf_counter()-started}
    _atomic(output/"detail-probe-metadata.json",metadata); return metadata
