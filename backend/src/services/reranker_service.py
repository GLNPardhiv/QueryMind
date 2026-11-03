# app/services/reranker_service.py
from sentence_transformers import CrossEncoder
from typing import List, Dict

class RerankerService:
    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"):
        self.reranker = CrossEncoder(model_name)

    def rerank_tables(self, query: str, candidate_tables: List[str], table_docs: List[str], top_k: int = 5) -> List[str]:
        if not candidate_tables:
            return []
        
        # Build query-document pairs for deep self-attention scoring
        pairs = [[query, doc] for doc in table_docs]
        scores = self.reranker.predict(pairs)
        
        # Sort candidate tables by Cross-Encoder score
        scored_candidates = sorted(zip(candidate_tables, scores), key=lambda x: x[1], reverse=True)
        
        # Maintain order and return top_k
        return [table for table, score in scored_candidates[:top_k]]

reranker_service = RerankerService()