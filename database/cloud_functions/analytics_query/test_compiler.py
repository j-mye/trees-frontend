"""pytest: draft -> SQL allowlist (no injection via identifiers)."""

import pytest

from compiler import compile_draft_to_sql


def test_compile_basic():
    draft = {
        "xAxisItem": {"id": "dim-species", "name": "Species", "type": "dimension"},
        "yAxisItem": {"id": "meas-tree-count", "name": "Tree Count", "type": "measure"},
        "yAggregation": "SUM",
    }
    sql, _ = compile_draft_to_sql(draft, table_fqn="proj.ds.qs_table")
    assert "top_species" in sql
    assert "tree_count" in sql
    assert "SUM" in sql
    assert "COALESCE" in sql
    assert "NULLIF" in sql
    assert "TRIM" in sql
    assert "Unknown" in sql


def test_reject_unknown_dimension():
    draft = {
        "xAxisItem": {"id": "dim-evil", "name": "Evil", "type": "dimension"},
        "yAxisItem": {"id": "meas-tree-count", "name": "Tree Count", "type": "measure"},
        "yAggregation": "SUM",
    }
    with pytest.raises(ValueError, match="Unknown dimension"):
        compile_draft_to_sql(draft, table_fqn="proj.ds.qs_table")


def test_reject_injection_table():
    draft = {
        "xAxisItem": {"id": "dim-species", "name": "Species", "type": "dimension"},
        "yAxisItem": {"id": "meas-tree-count", "name": "Tree Count", "type": "measure"},
        "yAggregation": "SUM",
    }
    with pytest.raises(ValueError):
        compile_draft_to_sql(draft, table_fqn="proj; DROP TABLE t;--")


def test_filter_in_quarter_section():
    draft = {
        "xAxisItem": {"id": "dim-species", "name": "Species", "type": "dimension"},
        "yAxisItem": {"id": "meas-tree-count", "name": "Tree Count", "type": "measure"},
        "yAggregation": "SUM",
        "draftFilters": [
            {
                "fieldId": "filter-quarter-section",
                "op": "in",
                "values": ["QS-1", "QS-2"],
            }
        ],
    }
    sql, params = compile_draft_to_sql(draft, table_fqn="proj.ds.qs_table")
    assert "IN UNNEST" in sql
    assert "qs_id" in sql
    assert any(p.get("name") == "f_0" and p.get("type") == "ARRAY<STRING>" for p in params)
