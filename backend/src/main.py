# src/main.py
import sys
import os
from pathlib import Path
from contextlib import asynccontextmanager

# Ensure backend root is in Python sys.path so imports work from any working directory
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from src.db.mongodb import mongo_service
from src.api.routes import router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Enforce strict MongoDB Atlas connectivity before accepting any incoming requests
    if not mongo_service.is_connected():
        raise RuntimeError("FATAL: MongoDB Atlas connection check failed. Server will not start.")
    print("[QueryMind] MongoDB Atlas connection verified. Server ready to accept traffic.")
    yield
    print("[QueryMind] Server shutting down.")

app = FastAPI(
    title="Enterprise Text-to-SQL API",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "mongodb": "connected"
    }

if __name__ == "__main__":
    uvicorn.run("src.main:app", host="127.0.0.1", port=8000, reload=True)
