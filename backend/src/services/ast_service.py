# src/services/ast_service.py
import sqlglot
from sqlglot import exp
from typing import Dict, Tuple
from src.models.schema_metadata import TableMetadata

class ASTValidatorService:
    def __init__(self):
        # Define tables that require elevated privileges
        self.RESTRICTED_TABLES = {"employeepayhistory", "databaselog", "passwordhash"}

    def validate(self, sql: str, schema_subset: Dict[str, TableMetadata], user_role: str = "ADMIN") -> Tuple[bool, str]:
        """
        Parses the SQL into an AST. Enforces read-only execution, RBAC constraints, 
        and blocks schema hallucinations while allowing CTEs.
        """
        try:
            parsed = sqlglot.parse_one(sql, read="mysql")
            
            if not isinstance(parsed, exp.Select):
                return False, "Security Violation: Only SELECT operations are permitted."
            
            # 1. Extract all tables referenced in the query
            query_tables = {table.name.lower() for table in parsed.find_all(exp.Table)}
            
            # 2. Extract dynamically created CTEs (e.g., "WITH monthly_revenue AS (...)")
            cte_names = {cte.alias.lower() for cte in parsed.find_all(exp.CTE)}
            
            # 3. RBAC Check (Only check actual database tables, ignore CTEs)
            if user_role != "ADMIN":
                base_query_tables = query_tables - cte_names
                unauthorized_access = base_query_tables.intersection(self.RESTRICTED_TABLES)
                if unauthorized_access:
                    return False, f"RBAC Blocked: Your role ({user_role}) lacks permission to query {unauthorized_access}."

            # 4. Hallucination Check (Valid = Schema Context + CTEs)
            valid_tables = {t.lower() for t in schema_subset.keys()}.union(cte_names)
            invalid_tables = query_tables - valid_tables
            
            if invalid_tables:
                return False, f"Hallucination Blocked: Attempted to query outside context: {invalid_tables}"
            
            return True, "AST Validation Passed"
            
        except sqlglot.errors.ParseError as e:
            return False, f"Syntax Error: The generated SQL is syntactically invalid. {str(e)}"
        except Exception as e:
            return False, f"AST Validation Error: {str(e)}"

ast_service = ASTValidatorService()