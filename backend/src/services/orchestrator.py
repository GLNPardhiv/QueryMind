# src/services/orchestrator.py
from typing import Dict, Any, Optional, List
import traceback

from src.db.inspector import schema_extractor
from src.services.query_translator import query_translator
from src.services.vector_service import vector_service
from src.services.graph_service import SchemaGraphService
from src.services.sql_generator import sql_generator
from src.db.executor import sql_executor
from src.services.ast_service import ast_service

class PipelineOrchestrator:
    def __init__(self):
        self.database_name: Optional[str] = None
        self.full_schema = schema_extractor.extract_full_schema()
        self.all_table_names = list(self.full_schema.keys())
        
        # Ensure vectors and graph are built if schema is available
        if self.full_schema:
            vector_service.ingest_schema(self.full_schema)
            self.graph_service = SchemaGraphService(self.full_schema)
        else:
            self.graph_service = SchemaGraphService({})

    def process_query(
        self, 
        user_query: str, 
        user_role: str = "STANDARD_USER", 
        execute: bool = False,
        is_followup: bool = False,
        previous_sql: Optional[str] = None,
        previous_query: Optional[str] = None,
        previous_tables: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        if not self.full_schema:
            return {
                "status": "error",
                "message": "No database connected. Please connect a database via 'Connect Database' first."
            }
        try:
            # ── OPTIMIZATION: Cross-Question / Follow-up Path ──
            # Reuses context to strictly avoid spiking API RPM & token limits
            if is_followup and previous_sql:
                candidate_set = set(previous_tables or [])
                
                # Check for explicit table mentions in the follow-up text
                lower_query = user_query.lower()
                for table_name in self.all_table_names:
                    if table_name.lower() in lower_query:
                        candidate_set.add(table_name)
                
                if candidate_set:
                    pruned_table_names = self.graph_service.get_connecting_tables(list(candidate_set))
                else:
                    pruned_table_names = list(candidate_set)

                subgraph_schema = {t: self.full_schema[t] for t in pruned_table_names if t in self.full_schema}
                
                # If we have valid subgraph, refine directly using 1 single LLM call with minimal tokens
                if subgraph_schema:
                    generated_sql = sql_generator.refine_sql(
                        followup_query=user_query,
                        previous_sql=previous_sql,
                        previous_query=previous_query,
                        schema_subset=subgraph_schema
                    )
                else:
                    # Fallback to standard pipeline if previous tables were empty
                    enriched_query = query_translator.expand_query(user_query, self.all_table_names)
                    candidate_tables = vector_service.search_schemas(enriched_query, top_k_tables=15)
                    pruned_table_names = self.graph_service.get_connecting_tables(candidate_tables)
                    subgraph_schema = {t: self.full_schema[t] for t in pruned_table_names if t in self.full_schema}
                    generated_sql = sql_generator.generate_sql(user_query, subgraph_schema)
            else:
                # ── Standard Pipeline Flow ──
                # Step 1: Pre-Retrieval Translation (HyDE)
                enriched_query = query_translator.expand_query(user_query, self.all_table_names)
                
                # Step 2: Hybrid Retrieval
                candidate_tables = vector_service.search_schemas(enriched_query, top_k_tables=15)
                
                # Step 3: Graph Traversal
                pruned_table_names = self.graph_service.get_connecting_tables(candidate_tables)
                
                # Step 4: Extract exact DDL for the LLM context
                subgraph_schema = {t: self.full_schema[t] for t in pruned_table_names if t in self.full_schema}
                
                # Step 5: Generate the SQL
                generated_sql = sql_generator.generate_sql(user_query, subgraph_schema)
            
            # Step 6: AST Security Validation
            is_valid, validation_msg = ast_service.validate(generated_sql, subgraph_schema, user_role=user_role or "STANDARD_USER")
            
            if not is_valid:
                return {
                    "status": "blocked",
                    "query": user_query,
                    "sql": generated_sql,
                    "validation_message": validation_msg,
                    "context_tables_used": pruned_table_names,
                    "is_followup": is_followup
                }
            
            # Step 7: Execution is opt-in (only executed if requested, e.g. from Workbench)
            execution_result = None
            if execute:
                execution_result = sql_executor.execute_query(generated_sql)
            
            return {
                "status": "success",
                "query": user_query,
                "sql": generated_sql,
                "execution": execution_result,
                "context_tables_used": pruned_table_names,
                "is_followup": is_followup,
                "validation_message": "AST verified: query is secure and conforms to dialect syntax."
            }
            
        except Exception as e:
            traceback.print_exc()
            return {"status": "error", "message": str(e)}

orchestrator = PipelineOrchestrator()
