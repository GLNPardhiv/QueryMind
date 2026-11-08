# src/db/executor.py
import time
import re
from sqlalchemy import create_engine, text
from typing import Dict, Any, List, Optional
from src.core.config import config

class SQLExecutor:
    def __init__(self):
        self.engine = create_engine(config.DATABASE_URI) if config.DATABASE_URI else None

    def execute_query(self, sql_query: str, engine: Optional[Any] = None) -> Dict[str, Any]:
        """
        Executes the generated SQL query securely and returns the data rows.
        Guarantees read-only execution by enforcing a transaction rollback.
        """
        target_engine = engine or self.engine
        if not target_engine:
            return {
                "status": "error",
                "message": "No database connected. Please connect a database via Connect DB or re-import your SQL file first."
            }
        try:
            with target_engine.connect() as conn:
                with conn.begin():
                    result = conn.execute(text(sql_query))
                    rows = [dict(row._mapping) for row in result.fetchall()]
                    conn.rollback()
                    
                return {
                    "status": "success",
                    "data": rows,
                    "row_count": len(rows)
                }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e)
            }

    def explain_query(self, sql_query: str, mode: str = "analyze", engine: Optional[Any] = None) -> Dict[str, Any]:
        """
        Runs EXPLAIN (estimated optimizer plan) or EXPLAIN ANALYZE (with actual execution profiling)
        for a given SQL query, returning the execution tree and tabular optimizer metrics.
        Seamlessly adapts to SQLite, MySQL, and PostgreSQL dialects.
        """
        target_engine = engine or self.engine
        if not target_engine:
            return {
                "status": "error",
                "message": "No database connected. Please connect a database via Connect DB or re-import your SQL file first."
            }

        clean_sql = sql_query.strip().rstrip(";")
        dialect_name = getattr(target_engine.dialect, "name", "sqlite").lower()
        analyze_output = None
        tabular_plan: List[Dict[str, Any]] = []

        # ── 1. SQLite Dialect Handling ──
        if "sqlite" in dialect_name:
            actual_time_ms = 0.0
            actual_rows_count = 0
            exec_status = "Executed"

            if mode == "analyze":
                start_t = time.perf_counter()
                res_run = self.execute_query(clean_sql, engine=target_engine)
                actual_time_ms = round((time.perf_counter() - start_t) * 1000, 2)
                if res_run.get("status") == "success":
                    actual_rows_count = res_run.get("row_count", 0)
                    exec_status = f"Success ({actual_rows_count} rows returned)"
                else:
                    exec_status = f"Failed: {res_run.get('message', 'Execution error')}"

            # Query plan from SQLite
            qp_res = self.execute_query(f"EXPLAIN QUERY PLAN {clean_sql}", engine=target_engine)
            if qp_res.get("status") == "success" and qp_res.get("data"):
                qp_data = qp_res["data"]
                # Build alias mapping from SQL if present
                alias_map = {}
                for m in re.finditer(r'\b(?:FROM|JOIN)\s+([`"]?\w+[`"]?)\s+(?:AS\s+)?([`"]?\w+[`"]?)\b', clean_sql, re.IGNORECASE):
                    real_t = m.group(1).strip('`"')
                    alias_t = m.group(2).strip('`"')
                    if alias_t.lower() not in {"where", "join", "inner", "left", "right", "cross", "on", "order", "group", "limit"}:
                        alias_map[alias_t.lower()] = real_t

                tree_lines = []
                for idx, r in enumerate(qp_data):
                    detail = r.get("detail", "")
                    prefix = "└── " if idx == len(qp_data) - 1 else "├── "
                    tree_lines.append(f"{prefix}{detail}")

                    # Build tabular representation
                    scan_type = "OPERATION"
                    key_used = "None"
                    if "USING INDEX" in detail.upper() or "USING COVERING INDEX" in detail.upper():
                        scan_type = "INDEX SEARCH"
                        idx_match = re.search(r'USING (?:COVERING )?INDEX (\w+)', detail, re.IGNORECASE)
                        key_used = idx_match.group(1) if idx_match else "Secondary Index"
                    elif "SCAN" in detail.upper():
                        scan_type = "ALL (FULL TABLE SCAN)"
                        key_used = "None"
                    elif "TEMP B-TREE" in detail.upper():
                        scan_type = "TEMP B-TREE"
                        key_used = "In-Memory B-Tree"

                    tbl_match = re.search(r'\b(?:SCAN|SEARCH)\s+([`"]?\w+[`"]?)', detail, re.IGNORECASE)
                    tbl_token = tbl_match.group(1).strip('`"') if tbl_match else "—"
                    if tbl_token.lower() in alias_map:
                        tbl_display = f"{alias_map[tbl_token.lower()]} ({tbl_token})"
                    else:
                        tbl_display = tbl_token

                    tabular_plan.append({
                        "table": tbl_display,
                        "type": scan_type,
                        "key": key_used,
                        "rows": actual_rows_count if mode == "analyze" and tbl_token != "—" else "—",
                        "filtered": "100%",
                        "Extra": detail
                    })

                header = [
                    f"-> SQLite Query Optimizer Plan ({'Profiled Execution' if mode == 'analyze' else 'Optimizer Estimation'})"
                ]
                if mode == "analyze":
                    header.append(f"   Execution Time: {actual_time_ms} ms | Row Count: {actual_rows_count} | Status: {exec_status}\n")
                else:
                    header.append("   Mode: Estimated Optimizer Plan (Query was NOT executed on database)\n")
                
                analyze_output = "\n".join(header + ["Execution Tree:"] + tree_lines)
            else:
                analyze_output = qp_res.get("message") or "Could not extract SQLite query plan."

        # ── 2. MySQL Dialect Handling ──
        elif "mysql" in dialect_name:
            if mode == "analyze":
                try:
                    res_analyze = self.execute_query(f"EXPLAIN ANALYZE {clean_sql}", engine=target_engine)
                    if res_analyze.get("status") == "success" and res_analyze.get("data"):
                        lines = [str(list(row.values())[0]) for row in res_analyze["data"] if row]
                        analyze_output = "\n".join(lines)
                    else:
                        analyze_output = res_analyze.get("message") or "No EXPLAIN ANALYZE output."
                except Exception as e:
                    analyze_output = f"EXPLAIN ANALYZE error: {str(e)}"
            else:
                analyze_output = "Estimated optimizer plan (Query was NOT executed on database)."

            try:
                res_explain = self.execute_query(f"EXPLAIN {clean_sql}", engine=target_engine)
                if res_explain.get("status") == "success":
                    tabular_plan = res_explain.get("data", [])
            except Exception:
                pass

        # ── 3. PostgreSQL Dialect Handling ──
        elif "postgres" in dialect_name:
            cmd = "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, COSTS, FORMAT TEXT)" if mode == "analyze" else "EXPLAIN (VERBOSE, COSTS, FORMAT TEXT)"
            res = self.execute_query(f"{cmd} {clean_sql}", engine=target_engine)
            if res.get("status") == "success" and res.get("data"):
                analyze_output = "\n".join(str(list(r.values())[0]) for r in res["data"] if r)
            else:
                analyze_output = res.get("message") or "No EXPLAIN output."

        # ── 4. Generic / Fallback ──
        else:
            res_explain = self.execute_query(f"EXPLAIN {clean_sql}", engine=target_engine)
            if res_explain.get("status") == "success" and res_explain.get("data"):
                analyze_output = "\n".join(str(r) for r in res_explain["data"])
                tabular_plan = res_explain["data"]

        return {
            "status": "success",
            "sql": clean_sql,
            "mode": mode,
            "executed": mode == "analyze",
            "analyze_plan": analyze_output,
            "tabular_plan": tabular_plan
        }

# Instantiate a global executor to be used by the orchestrator
sql_executor = SQLExecutor()
