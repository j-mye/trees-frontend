"""pytest: draft -> SQL allowlist (no injection via identifiers)."""

import pytest

from compiler import compile_draft_to_sql


def test_compile_basic():
    draft = {
        "xAxisItem": {"id": "dim-district", "name": "District", "type": "dimension"},
        "yAxisItem": {"id": "meas-tree-count", "name": "Tree Count", "type": "measure"},
        "yAggregation": "SUM",
    }
    sql, _ = compile_draft_to_sql(draft, table_fqn="proj.ds.qs_table")
    assert "district" in sql
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
        "xAxisItem": {"id": "dim-district", "name": "District", "type": "dimension"},
        "yAxisItem": {"id": "meas-tree-count", "name": "Tree Count", "type": "measure"},
        "yAggregation": "SUM",
    }
    with pytest.raises(ValueError):
        compile_draft_to_sql(draft, table_fqn="proj; DROP TABLE t;--")
