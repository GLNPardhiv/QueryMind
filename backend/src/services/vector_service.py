# src/services/vector_service.py
import os
import re
import chromadb
from typing import Dict, List
from sqlalchemy import create_engine, text
from rank_bm25 import BM25Okapi

from src.models.schema_metadata import TableMetadata
from src.services.embedding_service import embedding_service
from src.core.config import config
from src.services.reranker_service import reranker_service

def tokenize(text: str) -> List[str]:
    return [t.lower() for t in re.findall(r'\w+', text)]

class VectorService:
    def __init__(self, persist_dir: str = "./chroma_data"):
        os.makedirs(persist_dir, exist_ok=True)
        self.client = chromadb.PersistentClient(path=persist_dir)
        self.engine = create_engine(config.DATABASE_URI)
        
        # IN-MEMORY REGISTRY INITIALIZED HERE
        self.schema_registry: Dict[str, TableMetadata] = {}
        
        embed_fn = embedding_service.get_embedding_function()
        self.column_collection = self.client.get_or_create_collection(
            name="schema_columns",
            embedding_function=embed_fn
        )
        
        self.bm25: BM25Okapi = None
        self.bm25_metadatas: List[Dict] = []
        self.bm25_documents: List[str] = []

    def _build_bm25(self, documents: List[str], metadatas: List[Dict]):
        self.bm25_documents = documents
        self.bm25_metadatas = metadatas
        self.bm25 = BM25Okapi([tokenize(doc) for doc in documents])

    def _get_distinct_samples(self, table_name: str, column_name: str, limit: int = 3) -> List[str]:
        try:
            with self.engine.connect() as conn:
                query = text(f"SELECT DISTINCT `{column_name}` FROM `{table_name}` WHERE `{column_name}` IS NOT NULL LIMIT {limit}")
                result = conn.execute(query)
                return [str(row[0]) for row in result.fetchall() if str(row[0]).strip()]
        except Exception:
            return []

    def ingest_schema(self, schema_data: Dict[str, TableMetadata]):
        # POPULATE THE REGISTRY HERE
        self.schema_registry = schema_data
        
        # Fast path: If already indexed in ChromaDB, build BM25 instantly from stored documents
        try:
            if self.column_collection.count() > 0:
                stored = self.column_collection.get(include=["documents", "metadatas"])
                if stored and stored.get("documents"):
                    self._build_bm25(stored["documents"], stored["metadatas"])
                    return
        except Exception as e:
            print(f"[VectorService Cache Notice] Re-ingesting schema: {e}")

        ids, documents, metadatas = [], [], []

        for table_name, meta in schema_data.items():
            clean_table = table_name.lower()
            for col in meta.columns:
                col_name = col.name.lower()
                samples = []
                if any(t in col.type.lower() for t in ["varchar", "char", "text"]):
                    samples = self._get_distinct_samples(table_name, col.name)

                doc_string = f"Table: {clean_table} | Column: {col_name} ({col.type})"
                if samples: doc_string += f" | Sample Values: {', '.join(samples)}"

                ids.append(f"{clean_table}.{col_name}")
                documents.append(doc_string)
                metadatas.append({"table_name": clean_table, "column_name": col_name})

        if ids:
            self.column_collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
            self._build_bm25(documents, metadatas)

    def search_schemas(self, enriched_query: str, top_k_tables: int = 8) -> List[str]:
        if not self.bm25: return []
        
        # 1. Dense Semantic Search (Widen the net to 150 COLUMNS)
        dense_results = self.column_collection.query(
            query_texts=[enriched_query],
            n_results=min(150, self.column_collection.count()),
            include=["metadatas"]
        )
        
        # 2. Sparse BM25 Search (Widen the net to 150 COLUMNS)
        tokenized_query = tokenize(enriched_query)
        bm25_scores = self.bm25.get_scores(tokenized_query)
        bm25_ranked = sorted(zip(self.bm25_metadatas, bm25_scores), key=lambda x: x[1], reverse=True)

        # 3. Reciprocal Rank Fusion (RRF)
        table_scores: Dict[str, float] = {}

        if dense_results["metadatas"] and dense_results["metadatas"][0]:
            for rank, meta in enumerate(dense_results["metadatas"][0]):
                tbl = meta["table_name"]
                table_scores[tbl] = table_scores.get(tbl, 0.0) + (1.0 / (60 + rank + 1))

        for rank, (meta, score) in enumerate(bm25_ranked[:150]):
            if score > 0:
                tbl = meta["table_name"]
                table_scores[tbl] = table_scores.get(tbl, 0.0) + (1.0 / (60 + rank + 1))

        # Extract top 20 DISTINCT TABLES from the fused column scores
        sorted_candidates = sorted(table_scores.items(), key=lambda x: x[1], reverse=True)
        top_candidates = [tbl for tbl, score in sorted_candidates[:20]]

        # 4. Generate clean, full-table context for the Cross-Encoder directly from the registry
        consolidated_docs = []
        for tbl in top_candidates:
            # LOOKUP NOW WORKS BECAUSE REGISTRY EXISTS
            meta = self.schema_registry.get(tbl, self.schema_registry.get(tbl.capitalize()))
            if meta:
                cols = [f"{c.name} ({c.type})" for c in meta.columns]
                consolidated_docs.append(f"Table: {tbl} | Columns: {', '.join(cols)}")
            else:
                consolidated_docs.append(f"Table: {tbl}")

        # 5. Cross-Encoder Reranking
        return reranker_service.rerank_tables(enriched_query, top_candidates, consolidated_docs, top_k_tables)

vector_service = VectorService()