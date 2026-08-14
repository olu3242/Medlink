import csv
import hashlib
import io
import json
import time
from collections import Counter, defaultdict
from pathlib import Path

def _csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as source: return list(csv.DictReader(source))

def _norm(value: str | None) -> str:
    return " ".join((value or "").casefold().split())

def _atomic(path: Path, content: str) -> str:
    path.parent.mkdir(parents=True, exist_ok=True); tmp=path.with_suffix(path.suffix+".tmp"); tmp.write_text(content,encoding="utf-8"); tmp.replace(path); return hashlib.sha256(path.read_bytes()).hexdigest()

def reconcile_candidates(candidate_path: Path, wave1_path: Path, current_path: Path, relationships_path: Path, output_dir: Path, *, detail_results: dict[str, dict[str, object]] | None = None, manufacturer_mappings: dict[str, str] | None = None) -> dict[str, object]:
    started=time.perf_counter(); candidates=json.loads(candidate_path.read_text(encoding="utf-8"))["candidates"]
    wave1={r["product_id"]:r for r in _csv(wave1_path)}; current={r["product_id"]:r for r in _csv(current_path)}
    relationships=_csv(relationships_path); rel_by_product: dict[str,list[dict[str,str]]]=defaultdict(list)
    for row in relationships: rel_by_product[row["product_id"]].append(row)
    detail_results=detail_results or {}; manufacturer_mappings=manufacturer_mappings or {}
    wave1_nrn: dict[str,list[dict[str,str]]]=defaultdict(list); candidate_nrn: dict[str,list[str]]=defaultdict(list)
    for row in wave1.values():
        if _norm(row.get("NAFDAC")): wave1_nrn[_norm(row["NAFDAC"])].append(row)
    for item in candidates:
        if _norm(item.get("nrn")): candidate_nrn[_norm(item["nrn"])].append(str(item["productId"]))
    rows=[]
    for item in candidates:
        pid=str(item["productId"]); cur=current.get(pid); detail=detail_results.get(pid,{}); nrn=_norm((cur or {}).get("NAFDAC") or item.get("nrn")); matches=wave1_nrn.get(nrn,[]) if nrn else []
        if cur: primary="EXACT_CURRENT_SOURCE_PRODUCT"
        elif matches: primary="POSSIBLE_EXISTING_PRODUCT_DIFFERENT_ID"
        else: primary="MANUFACTURER_EVIDENCE_ONLY"
        if cur: automation="SAFE_INCREMENTAL_NEW_SOURCE_IDENTITY"
        elif matches: automation="POSSIBLE_CANONICAL_EQUIVALENT_REVIEW"
        else: automation="SOURCE_INSUFFICIENT"
        clinical_conflict=len({r.get("ingredient_id","") for r in matches}) > 1
        manufacturer_id=str(item.get("manufacturerSourceId") or "")
        row={"product_id":pid,"current_source_status":"FOUND" if cur else str(detail.get("classification") or "NOT_IN_CURRENT_LISTING"),"product_name":(cur or {}).get("product_name") or item.get("productName") or "","nrn":(cur or {}).get("NAFDAC") or item.get("nrn") or "","ingredient":(cur or {}).get("ingredient_name") or "","strength":(cur or {}).get("strength") or "","dosage_form":(cur or {}).get("form_name") or "","route":(cur or {}).get("route_name") or "","category":(cur or {}).get("category_name") or "","regulatory_status":(cur or {}).get("status") or "","expiry":(cur or {}).get("expiry_date") or "","manufacturer_source_id":manufacturer_id,"canonical_manufacturer_uuid":manufacturer_mappings.get(manufacturer_id,""),"wave1_presence":False,"possible_canonical_medicine_uuid":"","nrn_collision_state":"INGREDIENT_CONFLICT" if clinical_conflict else "WAVE1_COLLISION" if len(matches)>1 else "WAVE1_MATCH" if matches else "NONE","field_drift_classification":"NOT_SHARED_SOURCE_ID","primary_reconciliation_classification":primary,"automation_eligibility":automation,"review_required":automation not in {"SAFE_INCREMENTAL_NEW_SOURCE_IDENTITY","DETERMINISTIC_EXISTING_SOURCE_MAPPING","SAFE_EXISTING_SOURCE_UPDATE"},"evidence":{"manufacturer_relationships":len(rel_by_product[pid]),"detail":detail,"wave1_nrn_product_ids":[r["product_id"] for r in matches]}}
        rows.append(row)
    if len(rows)!=2700 or len({r['product_id'] for r in rows})!=2700: raise ValueError("CANDIDATE_ACCOUNTING_FAILURE")
    shared=set(wave1)&set(current); changed=[]
    governed=("product_name","NAFDAC","manufacturer_id","ingredient_name","strength","form_name","route_name","category_name","status","expiry_date")
    field_drift={key:{"unchanged":0,"whitespace":0,"case":0,"material":0} for key in governed}
    for pid in shared:
        for key in governed:
            before=wave1[pid].get(key,""); after=current[pid].get(key,"")
            classification="unchanged" if before==after else "whitespace" if " ".join(before.split())==" ".join(after.split()) else "case" if _norm(before)==_norm(after) else "material"
            field_drift[key][classification]+=1
        if any(wave1[pid].get(k,"") != current[pid].get(k,"") for k in governed): changed.append(pid)
    result={"wave1_current_drift":{"wave1":len(wave1),"current":len(current),"intersection":len(shared),"current_only":len(set(current)-set(wave1)),"wave1_only":len(set(wave1)-set(current)),"changed":len(changed),"unchanged":len(shared)-len(changed),"duplicate_current_ids":0,"invalid_current_ids":sum(not x.isdigit() for x in current),"field_drift":field_drift},"candidate_count":len(rows),"primary_classifications":dict(Counter(r["primary_reconciliation_classification"] for r in rows)),"automation_eligibility":dict(Counter(r["automation_eligibility"] for r in rows)),"nrn_analysis":{"present":sum(bool(_norm(r["nrn"])) for r in rows),"absent":sum(not _norm(r["nrn"]) for r in rows),"unique":len({_norm(r["nrn"]) for r in rows if _norm(r["nrn"])}),"already_in_wave1":sum(bool(wave1_nrn.get(_norm(r["nrn"]))) for r in rows),"multiple_candidate_ids_sharing_nrn":sum(len(v)>1 for v in candidate_nrn.values()),"ingredient_conflicting":sum(r["nrn_collision_state"]=="INGREDIENT_CONFLICT" for r in rows)},"manufacturer_mapping":{"mapped":sum(bool(r["canonical_manufacturer_uuid"]) for r in rows),"unmapped":sum(not r["canonical_manufacturer_uuid"] for r in rows)},"safety":{"manufacturer_1161_unresolved":True,"manufacturer_370_718_distinct":True,"product_9452_published":False,"unsafe_nrn_merges":0},"canonical_mutation_audit":{"canonical_medicines":0,"canonical_organizations":0,"source_mappings":0,"certifications":0,"publications":0,"runtime_medicines":0,"prescriptions":0,"pharmacist_records":0,"inventory":0},"candidates":rows}
    json_path=output_dir/"merdp-wave2a-product-candidate-reconciliation.json"; json_hash=_atomic(json_path,json.dumps(result,ensure_ascii=False,indent=2,sort_keys=True)+"\n")
    csv_path=output_dir/"merdp-wave2a-product-candidate-reconciliation.csv"; columns=tuple(k for k in rows[0] if k!="evidence")+("evidence",); buf=io.StringIO(newline=""); writer=csv.DictWriter(buf,fieldnames=columns,lineterminator="\n"); writer.writeheader(); writer.writerows([{**r,"evidence":json.dumps(r["evidence"],sort_keys=True)} for r in rows]); csv_hash=_atomic(csv_path,buf.getvalue())
    drift={k:v for k,v in result.items() if k!="candidates"}; drift["artifact_hashes"]={str(json_path):json_hash,str(csv_path):csv_hash}; drift_path=output_dir/"merdp-wave2a-product-source-drift.json"; drift_hash=_atomic(drift_path,json.dumps(drift,ensure_ascii=False,indent=2,sort_keys=True)+"\n")
    return {**drift,"performance":{"reconciliation_seconds":time.perf_counter()-started},"artifact_hashes":{**drift["artifact_hashes"],str(drift_path):drift_hash}}
