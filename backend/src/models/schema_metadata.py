# app/models/schema_metadata.py
from pydantic import BaseModel # type: ignore
from typing import List

class ColumnMetadata(BaseModel):
    name: str
    type: str

class ForeignKeyMetadata(BaseModel):
    constrained_columns: List[str]
    referred_table: str
    referred_columns: List[str]

class TableMetadata(BaseModel):
    columns: List[ColumnMetadata]
    primary_keys: List[str]
    foreign_keys: List[ForeignKeyMetadata]