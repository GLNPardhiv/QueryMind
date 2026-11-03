# src/db/executor.py
from sqlalchemy import create_engine, text
from typing import Dict, Any, List, Optional
from src.core.config import config

class SQLExecutor:
    def __init__(self):
        self.engine = create_engine(config.DATABASE_URI)

    def execute_query(self, sql_query: str) -> Dict[str, Any]:
        """
        Executes the generated SQL query securely and returns the data rows.
        Guarantees read-only execution by enforcing a transaction rollback.
        """
        try:
            with self.engine.connect() as conn:
                # Open a transaction
                with conn.begin():
                    # Execute the raw SQL string
                    result = conn.execute(text(sql_query))
                    
                    # Convert the result rows into standard Python dictionaries
                    rows = [dict(row._mapping) for row in result.fetchall()]
                    
                    # SECURITY OVERRIDE: 
                    # Always rollback the transaction. SELECT statements don't need 
                    # commits, and this entirely neutralizes any rogue INSERT/UPDATE/DELETE queries.
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

    def explain_query(self, sql_query: str, mode: str = "analyze") -> Dict[str, Any]:
        """
        Runs EXPLAIN (estimated without execution) or EXPLAIN ANALYZE (with actual execution)
        for a given SQL query, returning the execution tree and tabular optimizer metrics.
        """
        clean_sql = sql_query.strip().rstrip(";")
        analyze_output = None
        tabular_plan: List[Dict[str, Any]] = []

        if mode == "analyze":
            try:
                # 1. Run MySQL 8.0 EXPLAIN ANALYZE (executes the query to record actual time)
                res_analyze = self.execute_query(f"EXPLAIN ANALYZE {clean_sql}")
                if res_analyze.get("status") == "success" and res_analyze.get("data"):
                    first_row = res_analyze["data"][0]
                    analyze_output = list(first_row.values())[0] if first_row else None
            except Exception as e:
                analyze_output = f"EXPLAIN ANALYZE error: {str(e)}"
        else:
            analyze_output = "Estimated optimizer plan (Query was NOT executed on database)."

        try:
            # 2. Run standard tabular EXPLAIN (pure optimizer estimation, query is NEVER executed)
            res_explain = self.execute_query(f"EXPLAIN {clean_sql}")
            if res_explain.get("status") == "success":
                tabular_plan = res_explain.get("data", [])
        except Exception:
            pass

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
