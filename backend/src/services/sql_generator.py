# src/services/sql_generator.py
import re
from typing import Dict, Optional
from google import genai
from google.genai import types
from src.core.config import config
from src.models.schema_metadata import TableMetadata

class SQLGeneratorService:
    def __init__(self):
        # Initialize the official Google GenAI client using your API key
        self.client = genai.Client(api_key=config.LLM_API_KEY)
        self.model_candidates = ["gemini-flash-lite-latest", "gemini-flash-latest"]

    def _format_schema(self, schema_subset: Dict[str, TableMetadata]) -> str:
        formatted = []
        for table_name, meta in schema_subset.items():
            cols = [f"{col.name} ({col.type})" for col in meta.columns]
            table_def = f"Table: {table_name}\nColumns: {', '.join(cols)}"
            if meta.foreign_keys:
                fks = [f"{','.join(fk.constrained_columns)} -> {fk.referred_table}({','.join(fk.referred_columns)})" for fk in meta.foreign_keys]
                table_def += f"\nForeign Keys: {', '.join(fks)}"
            formatted.append(table_def)
        return "\n\n".join(formatted)

    def _call_gemini(self, prompt: str) -> str:
        last_error = None
        for model_name in self.model_candidates:
            try:
                response = self.client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.0
                    )
                )
                raw_sql = response.text.strip()
                return re.sub(r"```[sS][qQ][lL]?\s*|\s*```", "", raw_sql).strip()
            except Exception as e:
                err_str = str(e)
                last_error = e
                # Fall back to next candidate if model not found or unavailable
                if "404" in err_str or "NOT_FOUND" in err_str or "no longer available" in err_str:
                    continue
                # If other transient error, retry next candidate as fallback
                continue
        raise last_error or RuntimeError("No Gemini model candidate succeeded.")

    def generate_sql(self, user_query: str, schema_subset: Dict[str, TableMetadata]) -> str:
        schema_context = self._format_schema(schema_subset)
        
        prompt = f"""
You are a deterministic SQL engine. Write a highly optimized MySQL query to answer the user's question.

STRICT CONSTRAINTS:
1. ONLY use the tables and columns provided in the SCHEMA CONTEXT below. Do not invent columns.
2. USE THE ABSOLUTE MINIMUM NUMBER OF TABLES. Just because a table is provided in the context does NOT mean you should use it. 
3. DO NOT ADD REDUNDANT JOINS. If all required SELECT and WHERE data exists in a single table, query only that table.
4. Return ONLY the raw SQL query. Do not wrap it in markdown block quotes (```sql). No explanations.

USER QUESTION: "{user_query}"

SCHEMA CONTEXT:
{schema_context}
"""
        try:
            return self._call_gemini(prompt)
        except Exception as e:
            return f"-- SQL Generation Error: {str(e)}"

    def refine_sql(
        self, 
        followup_query: str, 
        previous_sql: str, 
        previous_query: Optional[str], 
        schema_subset: Dict[str, TableMetadata]
    ) -> str:
        schema_context = self._format_schema(schema_subset)
        
        prompt = f"""
You are an expert SQL engineer.
A user previously asked a database question and received a MySQL query.
Now the user is asking a follow-up cross-question or correction about that query.

PREVIOUS QUESTION: "{previous_query or 'N/A'}"
PREVIOUS SQL:
{previous_sql}

USER FOLLOW-UP / CORRECTION: "{followup_query}"

STRICT CONSTRAINTS:
1. Modify or rewrite the PREVIOUS SQL query strictly according to the USER FOLLOW-UP instruction.
2. Maintain valid MySQL syntax.
3. ONLY use the tables and columns provided in the SCHEMA CONTEXT below. Do not invent columns.
4. Keep the query optimized and avoid redundant joins.
5. Return ONLY the raw SQL query. Do not wrap it in markdown block quotes (```sql). No explanations.

SCHEMA CONTEXT:
{schema_context}
"""
        try:
            return self._call_gemini(prompt)
        except Exception as e:
            return f"-- SQL Refinement Error: {str(e)}"

sql_generator = SQLGeneratorService()
