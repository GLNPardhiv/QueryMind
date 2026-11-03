import os
from typing import Optional, List, Dict, Any
from urllib.parse import quote_plus
from pydantic_settings import BaseSettings, SettingsConfigDict # type: ignore

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
env_path = os.path.join(backend_dir, ".env")

class Settings(BaseSettings):
    # Relational Database credentials (e.g. MySQL AdventureWorks)
    DB_USER: str
    DB_PASSWORD: str
    DB_HOST: str
    DB_PORT: int = 3306
    DB_NAME: str
    
    # LLM Settings
    LLM_API_KEY: str

    # MongoDB Atlas Settings (Enterprise Multi-Tenant Persistence)
    MONGO_URI: Optional[str] = None
    MONGO_DB_NAME: str = "querymind_enterprise"

    model_config = SettingsConfigDict(
        env_file=[".env", env_path], 
        env_file_encoding="utf-8", 
        extra="ignore"
    )

    @property
    def DATABASE_URI(self) -> str:
        """Constructs the SQLAlchemy connection string securely."""
        encoded_password = quote_plus(self.DB_PASSWORD)
        return f"mysql+pymysql://{self.DB_USER}:{encoded_password}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

config = Settings()
