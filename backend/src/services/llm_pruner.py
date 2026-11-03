# app/services/llm_pruner.py
import json
from typing import List
from google import genai
from google.genai import types
from src.core.config import config

class LLMSchemaPruner:
    def __init__(self):
        # Initialize the official Google GenAI client using your API key
        self.client = genai.Client(api_key=config.LLM_API_KEY)

    def prune_candidates(self, query: str, vector_candidates: List[str]) -> List[str]:
        if not vector_candidates:
            return []

        # Prompt explicitly asks for a JSON object with a specific key
        prompt = f"""
You are a database routing assistant. Identify the minimum set of tables required to answer the query.

User Query: "{query}"

Candidate Tables: {', '.join(vector_candidates)}

Return ONLY a valid JSON object in this format:
{{"tables": ["table1", "table2"]}}
"""
        try:
            # Call the native Gemini generation method
            response = self.client.models.generate_content(
                model="gemini-3.8-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    # Force Gemini to strictly return valid JSON output
                    response_mime_type="application/json"
                )
            )
            
            content = response.text.strip()
            selected_tables = json.loads(content).get("tables", [])
            return [tbl.lower() for tbl in selected_tables]
            
        except Exception as e:
            print(f"[LLM Pruner Error] Falling back to raw vector candidates. {e}")
            return vector_candidates

llm_pruner = LLMSchemaPruner()
