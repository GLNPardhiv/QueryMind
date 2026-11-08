import os
from typing import Optional, List, Dict, Any
from urllib.parse import quote_plus
from pydantic_settings import BaseSettings, SettingsConfigDict # type: ignore

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
env_path = os.path.join(backend_dir, ".env")

class Settings(BaseSettings):
    # Relational Database credentials (Optional - external databases connected dynamically)
    DB_USER: Optional[str] = None
    DB_PASSWORD: Optional[str] = None
    DB_HOST: Optional[str] = None
    DB_PORT: Optional[int] = 3306
    DB_NAME: Optional[str] = None
    
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
    def DATABASE_URI(self) -> Optional[str]:
        """Constructs the SQLAlchemy connection string securely if database credentials are provided."""
        if not self.DB_USER or not self.DB_HOST or not self.DB_NAME:
            return None
        encoded_password = quote_plus(self.DB_PASSWORD or "")
        return f"mysql+pymysql://{self.DB_USER}:{encoded_password}@{self.DB_HOST}:{self.DB_PORT or 3306}/{self.DB_NAME}"

config = Settings()
