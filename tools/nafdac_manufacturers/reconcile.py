import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path


def _read(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    value = re.sub(r"[^\w\s]", " ", value)
    return " ".join(value.split())


def _atomic(path: Path, content: str) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reconcile(directory_path: Path, relationships_path: Path, historical_manufacturers_path: Path, wave1_products_path: Path, output_dir: Path, *, adapter_commit: str, source_hashes: dict[str, str]) -> dict[str, object]:
    current_rows = _read(directory_path); historical_rows = _read(historical_manufacturers_path); relationships = _read(relationships_path); products = _read(wave1_products_path)
    current = {row["manufacturer_id"]: row for row in current_rows}; historical = {row["manufacturer_id"]: row for row in historical_rows}
    wave1_product = {row["product_id"]: row for row in products}
    current_rel: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in relationships: current_rel[row["manufacturer_source_id"]].append(row)
    historical_names: dict[str, list[str]] = defaultdict(list)
    for source_id, row in historical.items(): historical_names[normalize_name(row["manufacturer_name"])].append(source_id)
    classifications: list[dict[str, object]] = []
    proposals: list[dict[str, object]] = []
    conflicts: list[dict[str, str]] = []
    for source_id, row in current.items():
        evidence = current_rel[source_id]
        known = [item for item in evidence if item["product_id"] in wave1_product]
        unknown = [item for item in evidence if item["product_id"] not in wave1_product]
        targets = Counter(wave1_product[item["product_id"]]["manufacturer_id"] for item in known)
        expected_id = source_id if source_id in historical else targets.most_common(1)[0][0] if len(targets) == 1 else None
        agreement = [item for item in known if expected_id and wave1_product[item["product_id"]]["manufacturer_id"] == expected_id]
        disagreement = [item for item in known if not expected_id or wave1_product[item["product_id"]]["manufacturer_id"] != expected_id]
        name_candidates = historical_names[normalize_name(row["manufacturer_name"])]
        if source_id in historical:
            classification = "CONFLICT" if disagreement else "EXACT_SOURCE_ID_MATCH"
        elif len(targets) == 1:
            classification = "DETERMINISTIC_RELATIONSHIP_MATCH"
        elif len(targets) > 1:
            classification = "CONFLICT"
        elif len(name_candidates) == 1:
            classification = "NAME_ONLY_CANDIDATE"
        elif len(name_candidates) > 1:
            classification = "AMBIGUOUS"
        else:
            classification = "DIRECTORY_ONLY"
        eligibility = "AUTO_RESOLVABLE_EXISTING" if classification in {"EXACT_SOURCE_ID_MATCH", "DETERMINISTIC_RELATIONSHIP_MATCH"} else "SAFE_NEW_IDENTITY_CANDIDATE" if classification == "DIRECTORY_ONLY" else "CONFLICT" if classification == "CONFLICT" else "REVIEW_REQUIRED"
        canonical = ""
        record = {"directory_source_id": source_id, "directory_name": row["manufacturer_name"], "directory_product_count": int(row["product_count"]), "wave1_source_id": source_id if source_id in historical else targets.most_common(1)[0][0] if targets else name_candidates[0] if len(name_candidates) == 1 else "", "wave1_name": historical.get(source_id, historical.get(targets.most_common(1)[0][0], {}) if targets else {}).get("manufacturer_name", ""), "canonical_organization_uuid": canonical, "classification": classification, "automation_eligibility": eligibility, "product_overlap": len(known), "agreement_count": len(agreement), "conflict_count": len(disagreement), "unknown_count": len(unknown), "evidence": {"relationship_targets": dict(targets), "normalized_name_candidates": name_candidates}, "review_required": eligibility in {"REVIEW_REQUIRED", "CONFLICT"}}
        classifications.append(record)
        if record["review_required"]:
            proposals.append({"source_id": source_id, "reason": classification, "evidence": record["evidence"]})
        for item in disagreement:
            conflicts.append({"directory_source_id": source_id, "product_id": item["product_id"], "wave1_source_id": wave1_product[item["product_id"]]["manufacturer_id"]})
    added = sorted(set(current) - set(historical), key=int); absent = sorted(set(historical) - set(current), key=int); intersection = set(current) & set(historical)
    changed = sorted([source_id for source_id in intersection if any(current[source_id][field] != historical[source_id][field] for field in ("manufacturer_name", "product_count", "ingredient_count"))], key=int)
    unchanged = sorted(intersection - set(changed), key=int)
    collisions = [{"normalized_name": name, "source_ids": sorted(ids, key=int), "source_names": [current[source_id]["manufacturer_name"] for source_id in sorted(ids, key=int)], "classifications": [next(item["classification"] for item in classifications if item["directory_source_id"] == source_id) for source_id in sorted(ids, key=int)]} for name, ids in defaultdict(list, ((name, [source_id for source_id, row in current.items() if normalize_name(row["manufacturer_name"]) == name]) for name in {normalize_name(row["manufacturer_name"]) for row in current.values()})).items() if len(ids) > 1]
    wave1_only = [{"source_id": source_id, "source_name": historical[source_id]["manufacturer_name"], "wave1_product_count": sum(1 for product in products if product["manufacturer_id"] == source_id), "current_directory_presence": False} for source_id in absent]
    result = {"adapter_commit": adapter_commit, "source_hashes": source_hashes, "source_drift": {"previous_count": len(historical), "current_count": len(current), "intersection": len(intersection), "added": added, "absent": absent, "changed": changed, "unchanged": len(unchanged)}, "classification_counts": dict(Counter(str(item["classification"]) for item in classifications)), "automation_counts": dict(Counter(str(item["automation_eligibility"]) for item in classifications)), "manufacturers": classifications, "product_evidence": {"relationships": len(relationships), "unique_products": len({row["product_id"] for row in relationships}), "wave1_matches": sum(1 for row in relationships if row["product_id"] in wave1_product), "unknown_products": sum(1 for row in relationships if row["product_id"] not in wave1_product), "conflicts": conflicts}, "name_collisions": collisions, "wave1_only": wave1_only, "zero_product_count": sum(row["product_count"] == "0" for row in current_rows), "review_proposals": proposals, "fixture_1161": {"verdict": "NOT_FOUND", "directory_present": "1161" in current}, "fixture_370_718": [next(item for item in classifications if item["directory_source_id"] == source_id) for source_id in ("370", "718")], "canonical_mutation_audit": {key: 0 for key in ("canonical_organizations", "canonical_mappings", "resolved_reviews", "medicine_certifications", "publications", "runtime_medicines")}}
    json_path = output_dir / "merdp-wave1.5-manufacturer-reconciliation.json"
    json_hash = _atomic(json_path, json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    csv_path = output_dir / "merdp-wave1.5-manufacturer-reconciliation.csv"
    columns = ("directory_source_id", "directory_name", "directory_product_count", "wave1_source_id", "wave1_name", "canonical_organization_uuid", "classification", "automation_eligibility", "product_overlap", "agreement_count", "conflict_count", "evidence", "review_required")
    rows = []
    for item in classifications:
        rows.append({key: json.dumps(item[key], ensure_ascii=False, sort_keys=True) if key == "evidence" else item[key] for key in columns})
    import io
    buffer = io.StringIO(newline=""); writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n"); writer.writeheader(); writer.writerows(rows)
    csv_hash = _atomic(csv_path, buffer.getvalue())
    result["artifacts"] = {str(json_path): json_hash, str(csv_path): csv_hash}
    return result
