# src/services/query_translator.py
from typing import List
from google import genai
from google.genai import types
from src.core.config import config

class QueryTranslator:
    def __init__(self):
        self.client = genai.Client(api_key=config.LLM_API_KEY)
        self.model_candidates = ["gemini-3.5-flash-lite"]

    def expand_query(self, user_query: str, table_names: List[str]) -> str:
        """
        Uses an LLM to map natural language to EXACT schema table names 
        and relevant column synonyms.
        """
        tables_str = ", ".join(table_names)
        
        prompt = f"""
You are an enterprise database architect. Your job is to extract the correct exact table names from the provided schema that match the user's query, along with highly relevant column synonyms.

AVAILABLE TABLES:
{tables_str}

USER QUERY: "{user_query}"

Return a space-separated string containing ONLY the exact table names from the list above that are required, followed by 3-5 relevant column names (like emailaddress, linetotal, inventory). Do not use commas or markdown.
"""
        for model_name in self.model_candidates:
            try:
                response = self.client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.0
                    )
                )
                expanded_keywords = response.text.strip()
                return f"{user_query} {expanded_keywords}"
            except Exception as e:
                err_str = str(e)
                if "404" in err_str or "NOT_FOUND" in err_str or "no longer available" in err_str:
                    continue
                print(f"[Query Translator Error with {model_name}] {e}")
                continue

        return user_query

query_translator = QueryTranslator()
