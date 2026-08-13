import csv
from pathlib import Path

from tools.nafdac_manufacturers.reconcile import reconcile


def write(path: Path, columns: tuple[str, ...], rows: list[tuple[str, ...]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.writer(target); writer.writerow(columns); writer.writerows(rows)


def test_reconciliation_uses_ids_and_relationships_without_name_merge(tmp_path: Path) -> None:
    directory=tmp_path/"directory.csv"; relationships=tmp_path/"relationships.csv"; historical=tmp_path/"historical.csv"; products=tmp_path/"products.csv"; output=tmp_path/"out"
    manufacturer_columns=("manufacturer_id","manufacturer_name","product_count","ingredient_count","detail_url","source_page","source_position","retrieved_at")
    write(directory,manufacturer_columns,[("370","Same Name","1","1","url","1","1","now"),("718","Same Name","1","1","url","1","2","now"),("999","New Name","1","1","url","1","3","now")])
    write(historical,manufacturer_columns,[("370","Same Name","1","1","url","1","1","then"),("718","Same Name","1","1","url","1","2","then")])
    write(relationships,("manufacturer_source_id","manufacturer_source_name","product_id","product_name","nrn","composition","detail_source_url","retrieved_at"),[("370","Same Name","1","A","N1","C","url","now"),("718","Same Name","2","B","N2","C","url","now"),("999","New Name","3","C","N3","C","url","now")])
    write(products,("product_id","manufacturer_id"),[("1","370"),("2","718"),("3","370")])
    result=reconcile(directory,relationships,historical,products,output,adapter_commit="commit",source_hashes={})
    by_id={item["directory_source_id"]:item for item in result["manufacturers"]}
    assert by_id["370"]["classification"] == "EXACT_SOURCE_ID_MATCH"
    assert by_id["718"]["classification"] == "EXACT_SOURCE_ID_MATCH"
    assert by_id["999"]["classification"] == "DETERMINISTIC_RELATIONSHIP_MATCH"
    assert result["source_drift"]["added"] == ["999"]
    assert len(result["name_collisions"]) == 1
