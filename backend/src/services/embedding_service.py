# app/services/embedding_service.py
from chromadb.utils import embedding_functions # type: ignore

class EmbeddingService:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self.embed_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=model_name
        )

    def get_embedding_function(self):
        return self.embed_fn

embedding_service = EmbeddingService()