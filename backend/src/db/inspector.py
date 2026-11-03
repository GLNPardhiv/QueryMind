# app/db/inspector.py
from sqlalchemy import create_engine, inspect # type: ignore
from typing import Dict

# Import the configuration and models from your other modules
from src.core.config import config
from src.models.schema_metadata import TableMetadata, ColumnMetadata, ForeignKeyMetadata

class SchemaExtractor:
    def __init__(self):
        # Initialize the engine using the secure URI from Phase 1
        self.engine = create_engine(config.DATABASE_URI)

    def extract_full_schema(self) -> Dict[str, TableMetadata]:
        """
        Connects to the database system catalog, extracts metadata for all tables,
        and returns a dictionary mapped to Pydantic models.
        """
        inspector = inspect(self.engine)
        schema_data = {}
        
        # 1. Fetch all table names in the database
        tables = inspector.get_table_names()
        
        for table in tables:
            # 2. Extract and format Columns
            raw_columns = inspector.get_columns(table)
            columns = [
                ColumnMetadata(name=col["name"], type=str(col["type"]))
                for col in raw_columns
            ]
            
            # 3. Extract Primary Keys
            pk_info = inspector.get_pk_constraint(table)
            primary_keys = pk_info.get("constrained_columns", [])
            
            # 4. Extract and format Foreign Keys
            raw_fks = inspector.get_foreign_keys(table)
            foreign_keys = [
                ForeignKeyMetadata(
                    constrained_columns=fk["constrained_columns"],
                    referred_table=fk["referred_table"],
                    referred_columns=fk["referred_columns"]
                )
                for fk in raw_fks
            ]
            
            # 5. Validate and store using the Pydantic TableMetadata model
            schema_data[table] = TableMetadata(
                columns=columns,
                primary_keys=primary_keys,
                foreign_keys=foreign_keys
            )
            
        return schema_data

# Instantiate a global extractor to be used by the pipeline
schema_extractor = SchemaExtractor()