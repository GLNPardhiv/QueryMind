# src/api/routes.py
import os
import time
import re
import sqlglot
from sqlglot import exp
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from sqlalchemy import create_engine, inspect, text, MetaData, Table, Column, Integer, String, Text, Float, DateTime
from google import genai
from google.genai import types

from src.core.config import config
from src.services.orchestrator import orchestrator
from src.services.ast_service import ast_service
from src.services.vector_service import vector_service
from src.services.graph_service import SchemaGraphService
from src.db.inspector import schema_extractor
from src.db.executor import sql_executor
from src.db.mongodb import mongo_service
from src.db.ddl_parser import parse_ddl_to_metadata
from src.models.schema_metadata import TableMetadata, ColumnMetadata, ForeignKeyMetadata
from src.api.dependencies import get_current_user

router = APIRouter()

# In-memory telemetry log for executed queries (persisted to MongoDB if connected)
telemetry_log: List[Dict[str, Any]] = []

# Multi-tenant isolated schema registry per organization
active_org_schemas: Dict[str, Dict[str, Any]] = {}

def populate_sqlite_data(engine, raw_sql: str) -> int:
    """
    Extracts and executes all INSERT statements from a SQL file into the SQLite database.
    Handles single-line and multi-line INSERTs, replaces MySQL escapes, and batches inside transactions.
    """
    if not raw_sql or "insert into" not in raw_sql.lower():
        return 0

    insert_statements: List[str] = []
    in_insert = False
    current_stmt_lines: List[str] = []

def clean_mysql_insert_for_sqlite(sql: str) -> str:
    """
    Properly converts MySQL INSERT statement syntax and escape sequences into valid SQLite SQL:
    1. Handles MySQL backslash escapes correctly (distinguishing \\' from \\\\').
    2. Converts b'0' and b'1' bit literals to 0 and 1.
    3. Strips _binary and _utf8mb4 character set introducers.
    """
    out = []
    i = 0
    n = len(sql)
    in_string = False

    while i < n:
        ch = sql[i]
        if not in_string:
            # Check for bit literals b'0' or b'1'
            if (ch == 'b' or ch == 'B') and i + 2 < n and sql[i+1] == "'":
                end_quote = sql.find("'", i + 2)
                if end_quote != -1 and end_quote - (i + 2) <= 64:
                    bit_str = sql[i+2:end_quote]
                    if all(b in '01' for b in bit_str):
                        val = int(bit_str, 2) if bit_str else 0
                        out.append(str(val))
                        i = end_quote + 1
                        continue

            # Check for _binary or _utf8mb4 introducers
            if ch == '_' and (sql[i:i+8].lower() == "_binary'" or sql[i:i+8].lower() == "_binary "):
                if sql[i:i+8].lower() == "_binary'":
                    out.append("'")
                    in_string = True
                    i += 8
                    continue
                else:
                    i += 8
                    continue

            if ch == '_' and sql[i:i+9].lower() == "_utf8mb4'":
                out.append("'")
                in_string = True
                i += 9
                continue

            if ch == "'":
                in_string = True
                out.append("'")
                i += 1
                continue

            out.append(ch)
            i += 1
        else:
            # Inside single-quoted string
            if ch == '\\':
                if i + 1 < n:
                    nxt = sql[i+1]
                    if nxt == "'":
                        out.append("''")
                        i += 2
                        continue
                    elif nxt == '\\':
                        out.append("\\")
                        i += 2
                        continue
                    elif nxt == '0':
                        out.append(" ")
                        i += 2
                        continue
                    else:
                        out.append(nxt)
                        i += 2
                        continue
                else:
                    out.append(ch)
                    i += 1
            elif ch == "'":
                if i + 1 < n and sql[i+1] == "'":
                    out.append("''")
                    i += 2
                    continue
                in_string = False
                out.append("'")
                i += 1
            else:
                out.append(ch)
                i += 1

    return "".join(out)

def extract_insert_statements(sql: str) -> List[str]:
    """
    Robust, quote-aware scanner to extract complete INSERT/REPLACE statements.
    Ensures that semicolons, newlines, and non-ASCII binary bytes (e.g. \x85 in GUIDs/blobs)
    inside string literals never prematurely terminate or split statements.
    """
    stmts: List[str] = []
    n = len(sql)
    i = 0
    pattern = re.compile(r'\b(INSERT\s+(?:IGNORE\s+)?INTO|REPLACE\s+INTO)\b', re.IGNORECASE)

    while i < n:
        m = pattern.search(sql, i)
        if not m:
            break

        start_idx = m.start()
        j = start_idx
        in_quote = False
        quote_char = None
        while j < n:
            ch = sql[j]
            if not in_quote:
                if ch == "'" or ch == '"':
                    in_quote = True
                    quote_char = ch
                elif ch == ';':
                    stmts.append(sql[start_idx:j+1])
                    j += 1
                    break
                elif ch == '-' and j + 1 < n and sql[j+1] == '-':
                    eol = sql.find('\n', j)
                    j = eol if eol != -1 else n
                    continue
            else:
                if ch == '\\':
                    j += 2
                    continue
                elif ch == quote_char:
                    if j + 1 < n and sql[j+1] == quote_char:
                        j += 2
                        continue
                    in_quote = False
            j += 1
        i = j

    return stmts

def populate_sqlite_data(engine, raw_sql: str) -> int:
    """
    Parses and executes INSERT statements from the imported raw SQL into the SQLite database.
    """
    if not raw_sql:
        return 0

    insert_statements = extract_insert_statements(raw_sql)
    if not insert_statements:
        return 0

    inserted_count = 0
    raw_conn = engine.raw_connection()
    try:
        # Register custom SQLite functions for MySQL compatibility
        try:
            import uuid as _uuid_mod
            import datetime as _dt_mod
            raw_conn.create_function("uuid", 0, lambda: str(_uuid_mod.uuid4()))
            raw_conn.create_function("now", 0, lambda: _dt_mod.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            raw_conn.create_function("utc_timestamp", 0, lambda: _dt_mod.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"))
            raw_conn.create_function("curdate", 0, lambda: _dt_mod.date.today().strftime("%Y-%m-%d"))
            raw_conn.create_function("curtime", 0, lambda: _dt_mod.datetime.now().strftime("%H:%M:%S"))
            raw_conn.create_function("str_to_date", 2, lambda d, fmt: str(d))
            raw_conn.create_function("date_format", 2, lambda d, fmt: str(d))
            raw_conn.create_function("unhex", 1, lambda h: bytes.fromhex(h) if h else None)
            raw_conn.create_function("concat", -1, lambda *args: "".join(str(a) for a in args if a is not None))
        except Exception:
            pass

        cursor = raw_conn.cursor()
        cursor.execute("PRAGMA foreign_keys = OFF;")
        cursor.execute("PRAGMA synchronous = OFF;")
        cursor.execute("PRAGMA journal_mode = MEMORY;")
        cursor.execute("BEGIN TRANSACTION;")

        for stmt in insert_statements:
            clean_stmt = clean_mysql_insert_for_sqlite(stmt).rstrip(";") + ";"
            clean_stmt = re.sub(r'^(?:INSERT\s+(?:OR\s+IGNORE\s+)?INTO)', 'INSERT OR IGNORE INTO', clean_stmt, flags=re.IGNORECASE)
            try:
                cursor.execute(clean_stmt)
                inserted_count += cursor.rowcount if cursor.rowcount > 0 else 1
            except Exception as e:
                print(f"[SQLite Statement Notice] {type(e).__name__}: {e}")

        raw_conn.commit()
    except Exception as e:
        print(f"[SQLite Data Population Notice] {e}")
        try:
            raw_conn.rollback()
        except Exception:
            pass
    finally:
        raw_conn.close()

    return inserted_count

def create_sqlite_engine_from_schema(org_id: str, extracted_schema: Dict[str, TableMetadata], raw_sql: str = "") -> Any:
    """
    Creates a dedicated SQLite database for this tenant/schema so raw SQL queries,
    data inspections, and workbench executions actually run and return results.
    Populates any INSERT INTO data rows found in the SQL file.
    """
    # 1. Dispose any existing engine for this tenant before touching the database file
    if org_id in active_org_schemas and active_org_schemas[org_id].get("engine"):
        try:
            active_org_schemas[org_id]["engine"].dispose()
        except Exception:
            pass

    if sql_executor.engine:
        try:
            sql_executor.engine.dispose()
        except Exception:
            pass
        sql_executor.engine = None

    import gc, time
    gc.collect()

    os.makedirs("./chroma_data", exist_ok=True)
    db_path = os.path.abspath(f"./chroma_data/tenant_{org_id}.db")
    if os.path.exists(db_path):
        removed = False
        for _ in range(5):
            try:
                os.remove(db_path)
                removed = True
                break
            except Exception:
                time.sleep(0.05)
        if not removed:
            try:
                # Fallback: connect and drop all existing tables and views so old schema never bleeds
                temp_engine = create_engine(f"sqlite:///{db_path}")
                with temp_engine.connect() as conn:
                    tables = inspect(temp_engine).get_table_names()
                    for tbl in tables:
                        conn.execute(text(f'DROP TABLE IF EXISTS "{tbl}";'))
                    conn.commit()
                temp_engine.dispose()
            except Exception as e:
                print(f"[SQLite Table Clean Notice] {e}")

    engine = create_engine(f"sqlite:///{db_path}")
    sqlite_meta = MetaData()

    for table_name, meta in extracted_schema.items():
        cols = []
        for col in meta.columns:
            t = col.type.upper()
            if "INT" in t:
                col_type = Integer
            elif "FLOAT" in t or "DECIMAL" in t or "DOUBLE" in t or "NUMERIC" in t:
                col_type = Float
            elif "DATE" in t or "TIME" in t:
                col_type = DateTime
            elif "TEXT" in t:
                col_type = Text
            else:
                col_type = String
            is_pk = col.name in meta.primary_keys
            cols.append(Column(col.name, col_type, primary_key=is_pk))
        Table(table_name, sqlite_meta, *cols, extend_existing=True)

    try:
        sqlite_meta.create_all(engine)
    except Exception as e:
        print(f"[SQLite Schema Creation Notice] {e}")

    # Populate any INSERT statements found in raw_sql
    rows_loaded = 0
    if raw_sql and "insert into" in raw_sql.lower():
        rows_loaded = populate_sqlite_data(engine, raw_sql)
        print(f"[SQLite Engine Ready] Successfully loaded {rows_loaded} rows from SQL data.")

    # Create helpful indexes on foreign key columns and ID columns for high performance JOINs
    try:
        raw_conn = engine.raw_connection()
        cursor = raw_conn.cursor()
        for tbl_name in extracted_schema.keys():
            cursor.execute(f"PRAGMA table_info('{tbl_name}')")
            col_infos = cursor.fetchall()
            for c in col_infos:
                c_name = c[1]
                is_pk = c[5]
                if not is_pk and (c_name.endswith('id') or c_name == 'rowguid'):
                    try:
                        cursor.execute(f'CREATE INDEX IF NOT EXISTS "idx_{tbl_name}_{c_name}" ON "{tbl_name}"("{c_name}");')
                    except Exception:
                        pass
        raw_conn.commit()
        raw_conn.close()
    except Exception as e:
        print(f"[SQLite Indexing Notice] {e}")

    setattr(engine, "rows_loaded", rows_loaded)
    return engine

def get_tenant_engine_and_schema(org_id: str):
    """
    Retrieves the tenant's active database engine and full schema.
    Auto-reconnects from MongoDB or local SQLite if the memory cache was cleared.
    """
    # 1. In-memory active org schema
    if org_id in active_org_schemas:
        info = active_org_schemas[org_id]
        if info.get("engine"):
            return info["engine"], info.get("full_schema", {})

    # 2. Check MongoDB for saved URI connection
    try:
        saved = mongo_service.get_tenant_db_connection(org_id)
        if saved and saved.get("uri"):
            uri = saved["uri"]
            new_engine = create_engine(uri)
            with new_engine.connect() as conn:
                conn.execute(text("SELECT 1"))

            # Re-extract schema
            inspector = inspect(new_engine)
            tables = inspector.get_table_names()
            extracted_schema = {}
            for table in tables:
                raw_columns = inspector.get_columns(table)
                columns = [ColumnMetadata(name=col["name"], type=str(col["type"])) for col in raw_columns]
                pk_info = inspector.get_pk_constraint(table)
                pks = pk_info.get("constrained_columns", [])
                raw_fks = inspector.get_foreign_keys(table)
                fks = [
                    ForeignKeyMetadata(
                        constrained_columns=fk["constrained_columns"],
                        referred_table=fk["referred_table"],
                        referred_columns=fk["referred_columns"]
                    )
                    for fk in raw_fks
                ]
                extracted_schema[table] = TableMetadata(columns=columns, primary_keys=pks, foreign_keys=fks)

            formatted_schema = {
                t: {
                    "columns": [{"name": c.name, "type": c.type} for c in m.columns],
                    "primary_keys": m.primary_keys,
                    "foreign_keys": [{"constrained_columns": fk.constrained_columns, "referred_table": fk.referred_table, "referred_columns": fk.referred_columns} for fk in m.foreign_keys]
                }
                for t, m in extracted_schema.items()
            }
            active_org_schemas[org_id] = {
                "full_schema": extracted_schema,
                "all_table_names": list(extracted_schema.keys()),
                "graph_service": SchemaGraphService(extracted_schema),
                "database_name": saved.get("alias", "External Database"),
                "engine": new_engine,
                "formatted_schema": formatted_schema
            }
            orchestrator.full_schema = extracted_schema
            orchestrator.all_table_names = list(extracted_schema.keys())
            sql_executor.engine = new_engine
            return new_engine, extracted_schema
    except Exception as e:
        print(f"[Auto-Reconnect Notice] {e}")

    # 3. Check for tenant SQLite file
    db_path = os.path.abspath(f"./chroma_data/tenant_{org_id}.db")
    if os.path.exists(db_path):
        try:
            sqlite_engine = create_engine(f"sqlite:///{db_path}")
            # If full_schema is missing in memory, auto-extract it directly from the SQLite database
            schema = active_org_schemas.get(org_id, {}).get("full_schema")
            if not schema:
                inspector = inspect(sqlite_engine)
                tables = inspector.get_table_names()
                schema = {}
                for table in tables:
                    raw_columns = inspector.get_columns(table)
                    columns = [ColumnMetadata(name=col["name"].lower(), type=str(col["type"])) for col in raw_columns]
                    pk_info = inspector.get_pk_constraint(table)
                    pks = [c.lower() for c in pk_info.get("constrained_columns", [])]
                    raw_fks = inspector.get_foreign_keys(table)
                    fks = [
                        ForeignKeyMetadata(
                            constrained_columns=[c.lower() for c in fk["constrained_columns"]],
                            referred_table=fk["referred_table"].lower() if fk.get("referred_table") else "",
                            referred_columns=[c.lower() for c in fk.get("referred_columns", [])]
                        )
                        for fk in raw_fks
                    ]
                    schema[table.lower()] = TableMetadata(columns=columns, primary_keys=pks, foreign_keys=fks)

                formatted_schema = {
                    t: {
                        "columns": [{"name": c.name, "type": c.type} for c in m.columns],
                        "primary_keys": m.primary_keys,
                        "foreign_keys": [{"constrained_columns": fk.constrained_columns, "referred_table": fk.referred_table, "referred_columns": fk.referred_columns} for fk in m.foreign_keys]
                    }
                    for t, m in schema.items()
                }
                active_org_schemas[org_id] = {
                    "full_schema": schema,
                    "all_table_names": list(schema.keys()),
                    "graph_service": SchemaGraphService(schema),
                    "database_name": "Imported DDL",
                    "engine": sqlite_engine,
                    "formatted_schema": formatted_schema
                }
                orchestrator.full_schema = schema
                orchestrator.all_table_names = list(schema.keys())
                orchestrator.graph_service = SchemaGraphService(schema)
                try:
                    vector_service.ingest_schema(schema, reset=True)
                except Exception:
                    pass

            sql_executor.engine = sqlite_engine
            return sqlite_engine, schema
        except Exception as e:
            print(f"[SQLite Auto-Extract Notice] {e}")

    # 4. Fallback to global sql_executor.engine
    return sql_executor.engine, orchestrator.full_schema

def extract_tables_from_sql(sql: Optional[str]) -> List[str]:
    """Extracts unique actual table names referenced in a SQL statement."""
    if not sql or not sql.strip():
        return []
    tables = []
    try:
        parsed = sqlglot.parse_one(sql, read="mysql")
        if parsed:
            cte_names = {cte.alias.lower() for cte in parsed.find_all(exp.CTE)}
            for tbl in parsed.find_all(exp.Table):
                t_name = tbl.name.strip('`"\'').lower()
                if t_name and t_name not in cte_names:
                    tables.append(t_name)
    except Exception:
        pass

    if not tables:
        # Regex fallback for non-standard queries
        matches = re.findall(r'\b(?:FROM|JOIN)\s+([`"]?)([a-zA-Z0-9_]+)\1', sql, re.IGNORECASE)
        for _, tbl in matches:
            t_name = tbl.strip('`"\'').lower()
            if t_name and t_name not in {"select", "where", "group", "order", "limit", "as"}:
                tables.append(t_name)

    # De-duplicate while preserving appearance order
    seen = set()
    return [t for t in tables if not (t in seen or seen.add(t))]

class QueryRequest(BaseModel):
    query: str
    is_followup: Optional[bool] = False
    previous_sql: Optional[str] = None
    previous_query: Optional[str] = None
    context_tables: Optional[List[str]] = None
    schema_context: Optional[Dict[str, Any]] = None
    database: Optional[str] = None

class RawSqlRequest(BaseModel):
    sql: str
    schema_context: Optional[Dict[str, Any]] = None
    database: Optional[str] = None

class UploadSqlRequest(BaseModel):
    filename: str
    content: str
    action: Optional[str] = "execute"  # "execute" or "analyze"

class ExplainRequest(BaseModel):
    sql: str
    mode: Optional[str] = "analyze"  # "analyze" (executes) or "estimate" (pure explain, no execution)

class ConnectDbRequest(BaseModel):
    uri: str
    alias: Optional[str] = "External Database"

class ImportDdlRequest(BaseModel):
    ddl: str
    alias: Optional[str] = "Imported DDL"

class CreateConversationRequest(BaseModel):
    id: str
    title: str

class RenameConversationRequest(BaseModel):
    title: str

class MessageRequest(BaseModel):
    id: Optional[str] = None
    sender: str
    text: Optional[str] = ""
    sql: Optional[str] = None
    status: Optional[str] = "success"
    execution: Optional[Dict[str, Any]] = None
    tablesUsed: Optional[List[str]] = []
    latencyMs: Optional[float] = None
    isFollowUp: Optional[bool] = False
    fileAttachment: Optional[Dict[str, Any]] = None
    timestamp: Optional[str] = ""

@router.post("/generate-sql")
def generate_sql_endpoint(
    request: QueryRequest,
    current_user: dict = Depends(get_current_user)
):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    
    start_time = time.perf_counter()
    user_role = current_user.get("role", "STANDARD_USER")
    user_id = current_user.get("user_id", "local_user")
    org_id = current_user.get("org_id", "default_org")
    
    target_engine, tenant_schema = get_tenant_engine_and_schema(org_id)
    if not tenant_schema and request.schema_context:
        extracted_schema = {}
        for tbl, data in request.schema_context.items():
            cols = [ColumnMetadata(name=c["name"], type=c.get("type", "VARCHAR")) for c in data.get("columns", [])]
            pks = data.get("primary_keys", [])
            fks = [
                ForeignKeyMetadata(
                    constrained_columns=fk.get("constrained_columns", []),
                    referred_table=fk.get("referred_table", ""),
                    referred_columns=fk.get("referred_columns", [])
                )
                for fk in data.get("foreign_keys", [])
            ]
            extracted_schema[tbl] = TableMetadata(columns=cols, primary_keys=pks, foreign_keys=fks)
        
        target_engine = create_sqlite_engine_from_schema(org_id, extracted_schema)
        active_org_schemas[org_id] = {
            "full_schema": extracted_schema,
            "all_table_names": list(extracted_schema.keys()),
            "graph_service": SchemaGraphService(extracted_schema),
            "database_name": request.database or "Connected Database",
            "engine": target_engine,
            "formatted_schema": request.schema_context
        }
        tenant_schema = extracted_schema
        sql_executor.engine = target_engine
        schema_extractor.engine = target_engine
        vector_service.ingest_schema(extracted_schema, reset=True)

    if tenant_schema:
        orchestrator.full_schema = tenant_schema
        orchestrator.all_table_names = list(tenant_schema.keys())
        if org_id in active_org_schemas and active_org_schemas[org_id].get("graph_service"):
            orchestrator.graph_service = active_org_schemas[org_id]["graph_service"]
        else:
            orchestrator.graph_service = SchemaGraphService(tenant_schema)

    # Generate and validate SQL without executing directly
    result = orchestrator.process_query(
        user_query=request.query, 
        user_role=user_role, 
        execute=False,
        is_followup=bool(request.is_followup),
        previous_sql=request.previous_sql,
        previous_query=request.previous_query,
        previous_tables=request.context_tables
    )
    elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
    
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message"))
        
    result["latency_ms"] = elapsed_ms
    result["executed_by"] = current_user.get("email", "anonymous")
    result["role"] = user_role
    result["org_id"] = org_id

    # Record telemetry in memory & MongoDB
    q_id = f"q-{int(time.time() * 1000)}-{len(telemetry_log) + 1}"
    actual_tables = extract_tables_from_sql(result.get("sql")) or result.get("context_tables_used", [])
    log_item = {
        "id": q_id,
        "timestamp": time.time(),
        "user_id": user_id,
        "org_id": org_id,
        "role": user_role,
        "query": request.query,
        "sql": result.get("sql"),
        "status": result.get("status"),
        "latency_ms": elapsed_ms,
        "row_count": 0,
        "is_followup": bool(request.is_followup),
        "tables_used": actual_tables
    }
    telemetry_log.append(log_item)
    mongo_service.log_telemetry(log_item)

    return result

@router.post("/raw-sql")
def execute_raw_sql_endpoint(
    request: RawSqlRequest,
    current_user: dict = Depends(get_current_user)
):
    sql = request.sql.strip()
    if not sql:
        raise HTTPException(status_code=400, detail="SQL cannot be empty.")
    
    user_role = current_user.get("role", "STANDARD_USER")
    user_id = current_user.get("user_id", "local_user")
    org_id = current_user.get("org_id", "default_org")
    
    target_engine, tenant_schema = get_tenant_engine_and_schema(org_id)
    if not tenant_schema and request.schema_context:
        extracted_schema = {}
        for tbl, data in request.schema_context.items():
            cols = [ColumnMetadata(name=c["name"], type=c.get("type", "VARCHAR")) for c in data.get("columns", [])]
            pks = data.get("primary_keys", [])
            fks = [
                ForeignKeyMetadata(
                    constrained_columns=fk.get("constrained_columns", []),
                    referred_table=fk.get("referred_table", ""),
                    referred_columns=fk.get("referred_columns", [])
                )
                for fk in data.get("foreign_keys", [])
            ]
            extracted_schema[tbl] = TableMetadata(columns=cols, primary_keys=pks, foreign_keys=fks)
        
        target_engine = create_sqlite_engine_from_schema(org_id, extracted_schema)
        active_org_schemas[org_id] = {
            "full_schema": extracted_schema,
            "all_table_names": list(extracted_schema.keys()),
            "graph_service": SchemaGraphService(extracted_schema),
            "database_name": request.database or "Connected Database",
            "engine": target_engine,
            "formatted_schema": request.schema_context
        }
        tenant_schema = extracted_schema
        sql_executor.engine = target_engine
        schema_extractor.engine = target_engine
        vector_service.ingest_schema(extracted_schema, reset=True)

    schema_for_val = tenant_schema or orchestrator.full_schema

    # AST validation on raw SQL
    is_valid, validation_msg = ast_service.validate(sql, schema_for_val, user_role=user_role)
    if not is_valid:
        return {
            "status": "blocked",
            "sql": sql,
            "validation_message": validation_msg
        }

    start_time = time.perf_counter()
    execution_result = sql_executor.execute_query(sql, engine=target_engine)
    elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

    # Record raw SQL execution into telemetry
    q_id = f"raw-{int(time.time() * 1000)}-{len(telemetry_log) + 1}"
    query_title = sql.replace('\n', ' ').strip()
    if len(query_title) > 60:
        query_title = query_title[:57] + "..."

    actual_tables = extract_tables_from_sql(sql)

    log_item = {
        "id": q_id,
        "timestamp": time.time(),
        "user_id": user_id,
        "org_id": org_id,
        "role": user_role,
        "query": f"SQL: {query_title}",
        "sql": sql,
        "status": execution_result.get("status", "success"),
        "latency_ms": elapsed_ms,
        "row_count": execution_result.get("row_count", 0),
        "is_followup": False,
        "tables_used": actual_tables
    }
    telemetry_log.append(log_item)
    mongo_service.log_telemetry(log_item)

    return {
        "status": "success",
        "sql": sql,
        "execution": execution_result,
        "latency_ms": elapsed_ms
    }

@router.post("/explain-sql")
def explain_sql_endpoint(
    request: ExplainRequest,
    current_user: dict = Depends(get_current_user)
):
    sql = request.sql.strip()
    if not sql:
        raise HTTPException(status_code=400, detail="SQL query cannot be empty.")
    
    org_id = current_user.get("org_id", "default_org")
    target_engine, _ = get_tenant_engine_and_schema(org_id)
    return sql_executor.explain_query(sql, mode=request.mode or "analyze", engine=target_engine)

@router.post("/connect-db")
def connect_db_endpoint(
    request: ConnectDbRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Validates, connects to, and extracts the complete schema for a new database URI.
    Updates the system's live orchestrator and returns all extracted tables.
    """
    user_role = current_user.get("role", "STANDARD_USER")
    if user_role != "ADMIN":
        raise HTTPException(status_code=403, detail="Only verified ADMIN users can connect external database URIs.")

    uri = request.uri.strip()
    if not uri:
        raise HTTPException(status_code=400, detail="Database connection URI cannot be empty.")

    try:
        # 1. Test live connectivity
        new_engine = create_engine(uri)
        with new_engine.connect() as conn:
            conn.execute(text("SELECT 1"))

        # 2. Extract full schema from the new catalog
        inspector = inspect(new_engine)
        tables = inspector.get_table_names()
        
        extracted_schema: Dict[str, TableMetadata] = {}
        for table in tables:
            raw_columns = inspector.get_columns(table)
            columns = [
                ColumnMetadata(name=col["name"], type=str(col["type"]))
                for col in raw_columns
            ]
            pk_info = inspector.get_pk_constraint(table)
            primary_keys = pk_info.get("constrained_columns", [])
            raw_fks = inspector.get_foreign_keys(table)
            foreign_keys = [
                ForeignKeyMetadata(
                    constrained_columns=fk["constrained_columns"],
                    referred_table=fk["referred_table"],
                    referred_columns=fk["referred_columns"]
                )
                for fk in raw_fks
            ]
            extracted_schema[table] = TableMetadata(
                columns=columns,
                primary_keys=primary_keys,
                foreign_keys=foreign_keys
            )

        # 3. Format schema for the frontend graph
        formatted_schema = {}
        for table_name, meta in extracted_schema.items():
            formatted_schema[table_name] = {
                "columns": [{"name": col.name, "type": col.type} for col in meta.columns],
                "primary_keys": meta.primary_keys,
                "foreign_keys": [
                    {
                        "constrained_columns": fk.constrained_columns,
                        "referred_table": fk.referred_table,
                        "referred_columns": fk.referred_columns
                    }
                    for fk in meta.foreign_keys
                ]
            }

        # 4. Save to tenant isolated schema registry and persist to MongoDB
        org_id = current_user.get("org_id", "default_org")
        mongo_service.save_tenant_db_connection(org_id, uri, request.alias)
        active_org_schemas[org_id] = {
            "full_schema": extracted_schema,
            "all_table_names": list(extracted_schema.keys()),
            "graph_service": SchemaGraphService(extracted_schema),
            "database_name": request.alias or "External Database",
            "engine": new_engine,
            "formatted_schema": formatted_schema
        }

        # 5. Update runtime services to point to the new connected database
        orchestrator.full_schema = extracted_schema
        orchestrator.all_table_names = list(extracted_schema.keys())
        orchestrator.graph_service = SchemaGraphService(extracted_schema)
        orchestrator.database_name = request.alias or "External Database"
        schema_extractor.engine = new_engine
        sql_executor.engine = new_engine
        vector_service.engine = new_engine
        
        # Build vectors for the new tables
        vector_service.ingest_schema(extracted_schema, reset=True)

        return {
            "status": "success",
            "alias": request.alias,
            "database_uri": uri,
            "table_count": len(extracted_schema),
            "schema": formatted_schema
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Database connection error: {str(e)}")

@router.post("/import-ddl")
def import_ddl_endpoint(
    request: ImportDdlRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Parses a full SQL DDL string, extracts tables, columns, primary keys, and foreign keys,
    and updates the runtime orchestrator, schema graph, and semantic vector engine.
    """
    ddl_text = request.ddl.strip()
    if not ddl_text:
        raise HTTPException(status_code=400, detail="DDL content cannot be empty.")

    extracted_schema = parse_ddl_to_metadata(ddl_text)
    if not extracted_schema:
        raise HTTPException(status_code=400, detail="No valid CREATE TABLE statements found in the provided DDL.")

    formatted_schema = {}
    for table_name, meta in extracted_schema.items():
        formatted_schema[table_name] = {
            "columns": [{"name": col.name, "type": col.type} for col in meta.columns],
            "primary_keys": meta.primary_keys,
            "foreign_keys": [
                {
                    "constrained_columns": fk.constrained_columns,
                    "referred_table": fk.referred_table,
                    "referred_columns": fk.referred_columns
                }
                for fk in meta.foreign_keys
            ]
        }

    org_id = current_user.get("org_id", "default_org")

    # Create a dedicated local SQLite database for this schema so queries execute cleanly
    sqlite_engine = create_sqlite_engine_from_schema(org_id, extracted_schema, ddl_text)

    rows_loaded = getattr(sqlite_engine, "rows_loaded", 0)

    active_org_schemas[org_id] = {
        "full_schema": extracted_schema,
        "all_table_names": list(extracted_schema.keys()),
        "graph_service": SchemaGraphService(extracted_schema),
        "database_name": request.alias or "Imported DDL",
        "engine": sqlite_engine,
        "formatted_schema": formatted_schema,
        "rows_loaded": rows_loaded
    }

    orchestrator.full_schema = extracted_schema
    orchestrator.all_table_names = list(extracted_schema.keys())
    orchestrator.graph_service = SchemaGraphService(extracted_schema)
    orchestrator.database_name = request.alias or "Imported DDL"
    schema_extractor.engine = sqlite_engine
    sql_executor.engine = sqlite_engine
    vector_service.engine = sqlite_engine
    vector_service.ingest_schema(extracted_schema, reset=True)

    return {
        "status": "success",
        "alias": request.alias or "Imported DDL",
        "table_count": len(extracted_schema),
        "rows_loaded": rows_loaded,
        "schema": formatted_schema
    }

@router.post("/upload-sql")
def upload_sql_file_endpoint(
    request: UploadSqlRequest,
    current_user: dict = Depends(get_current_user)
):
    raw_content = request.content.strip()
    if not raw_content:
        raise HTTPException(status_code=400, detail="SQL file is empty.")

    user_role = current_user.get("role", "STANDARD_USER")

    # If action is analyze, use Gemini to explain and audit the SQL file
    if request.action == "analyze":
        try:
            client = genai.Client(api_key=config.LLM_API_KEY)
            prompt = f"""
You are an expert database security engineer. Analyze the following SQL file:
FILENAME: {request.filename}

SQL CONTENT:
{raw_content[:4000]}

Please provide:
1. Short overview of what this SQL does.
2. The tables and columns it references.
3. Performance and indexing considerations.
4. Security rating (Safe / Needs Review) and read-only compliance.
Keep it concise and formatted in clean markdown bullet points.
"""
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt
            )
            analysis_text = response.text.strip()
        except Exception:
            analysis_text = f"Analyzed {request.filename}: Contains {len(raw_content.splitlines())} lines of SQL code."

        return {
            "status": "analyzed",
            "filename": request.filename,
            "sql": raw_content,
            "analysis": analysis_text
        }

    # Otherwise validate first statement
    cleaned = re.sub(r"--.*", "", raw_content)
    statements = [s.strip() for s in cleaned.split(";") if s.strip()]
    
    if not statements:
        raise HTTPException(status_code=400, detail="No executable SQL statements found in file.")

    primary_sql = statements[0]
    is_valid, validation_msg = ast_service.validate(primary_sql, orchestrator.full_schema, user_role=user_role)
    if not is_valid:
        return {
            "status": "blocked",
            "filename": request.filename,
            "sql": primary_sql,
            "validation_message": validation_msg,
            "statements_count": len(statements)
        }

    execution_result = None
    if request.action == "execute":
        start_time = time.perf_counter()
        execution_result = sql_executor.execute_query(primary_sql)
        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
    else:
        elapsed_ms = 8.0

    return {
        "status": "success",
        "filename": request.filename,
        "sql": primary_sql,
        "execution": execution_result,
        "statements_count": len(statements),
        "latency_ms": elapsed_ms
    }

# ── User Conversations & Messages (MongoDB Atlas Persistence) ──
@router.get("/conversations")
def get_conversations_endpoint(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("user_id", "local_user")
    return {
        "mongo_connected": mongo_service.is_connected(),
        "conversations": mongo_service.get_user_conversations(user_id)
    }

@router.post("/conversations")
def create_conversation_endpoint(
    request: CreateConversationRequest,
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user.get("user_id", "local_user")
    org_id = current_user.get("org_id", "default_org")
    return mongo_service.save_conversation(user_id, org_id, request.id, request.title)

@router.put("/conversations/{conv_id}")
def rename_conversation_endpoint(
    conv_id: str,
    request: RenameConversationRequest,
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user.get("user_id", "local_user")
    success = mongo_service.rename_conversation(user_id, conv_id, request.title)
    return {"status": "success" if success else "not_found"}

@router.delete("/conversations/{conv_id}")
def delete_conversation_endpoint(
    conv_id: str,
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user.get("user_id", "local_user")
    success = mongo_service.delete_conversation(user_id, conv_id)
    return {"status": "success" if success else "not_found"}

@router.get("/conversations/{conv_id}/messages")
def get_messages_endpoint(
    conv_id: str,
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user.get("user_id", "local_user")
    return {
        "conversation_id": conv_id,
        "messages": mongo_service.get_conversation_messages(user_id, conv_id)
    }

@router.post("/conversations/{conv_id}/messages")
def add_message_endpoint(
    conv_id: str,
    request: MessageRequest,
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user.get("user_id", "local_user")
    org_id = current_user.get("org_id", "default_org")
    saved = mongo_service.add_message(user_id, org_id, conv_id, request.model_dump())
    return {"status": "success", "message": saved}

@router.get("/system-status")
def system_status_endpoint(current_user: dict = Depends(get_current_user)):
    return {
        "mongo_connected": mongo_service.is_connected(),
        "database_name": config.MONGO_DB_NAME,
        "active_user": {
            "user_id": current_user.get("user_id"),
            "email": current_user.get("email"),
            "org_id": current_user.get("org_id"),
            "role": current_user.get("role")
        }
    }

@router.post("/disconnect-db")
def disconnect_db_endpoint(current_user: dict = Depends(get_current_user)):
    """Disconnects the active database and resets schema context."""
    org_id = current_user.get("org_id", "default_org")
    try:
        mongo_service.delete_tenant_db_connection(org_id)
    except Exception as e:
        print(f"[Disconnect Notice] Error deleting tenant db connection: {e}")

    # Dispose active SQLAlchemy engine before deleting the file
    existing_entry = active_org_schemas.pop(org_id, None)
    if existing_entry and existing_entry.get("engine"):
        try:
            existing_entry["engine"].dispose()
        except Exception as e:
            print(f"[Disconnect Notice] Error disposing tenant engine: {e}")

    if sql_executor.engine:
        try:
            sql_executor.engine.dispose()
        except Exception:
            pass
        sql_executor.engine = None
    schema_extractor.engine = None
    vector_service.engine = None

    import gc, time
    gc.collect()

    # Clean up local tenant sqlite file if present
    db_path = os.path.abspath(f"./chroma_data/tenant_{org_id}.db")
    if os.path.exists(db_path):
        removed = False
        for _ in range(5):
            try:
                os.remove(db_path)
                removed = True
                break
            except Exception:
                time.sleep(0.05)
        if not removed:
            try:
                temp_engine = create_engine(f"sqlite:///{db_path}")
                with temp_engine.connect() as conn:
                    tables = inspect(temp_engine).get_table_names()
                    for tbl in tables:
                        conn.execute(text(f'DROP TABLE IF EXISTS "{tbl}";'))
                    conn.commit()
                temp_engine.dispose()
            except Exception as e:
                print(f"[Disconnect Drop Notice] {e}")

    orchestrator.full_schema = {}
    orchestrator.all_table_names = []
    orchestrator.graph_service = SchemaGraphService({})
    orchestrator.database_name = None
    try:
        vector_service.ingest_schema({}, reset=True)
    except Exception:
        pass

    return {"status": "success", "message": "Database disconnected successfully."}

@router.get("/schema")
def get_schema_endpoint(current_user: dict = Depends(get_current_user)):
    """Returns the database schema graph data (tables, columns, foreign keys) isolated per tenant."""
    org_id = current_user.get("org_id", "default_org")
    if org_id not in active_org_schemas:
        get_tenant_engine_and_schema(org_id)
    user_schema_entry = active_org_schemas.get(org_id)
    
    if user_schema_entry and user_schema_entry.get("formatted_schema"):
        return {
            "database": user_schema_entry.get("database_name"),
            "table_count": len(user_schema_entry.get("formatted_schema", {})),
            "rows_loaded": user_schema_entry.get("rows_loaded", 0),
            "schema": user_schema_entry.get("formatted_schema", {})
        }

    # Fallback to orchestrator if this tenant matches current global session
    if orchestrator.full_schema:
        schema = {}
        for table_name, meta in orchestrator.full_schema.items():
            schema[table_name] = {
                "columns": [{"name": col.name, "type": col.type} for col in meta.columns],
                "primary_keys": meta.primary_keys,
                "foreign_keys": [
                    {
                        "constrained_columns": fk.constrained_columns,
                        "referred_table": fk.referred_table,
                        "referred_columns": fk.referred_columns
                    }
                    for fk in meta.foreign_keys
                ]
            }
        return {
            "database": orchestrator.database_name,
            "table_count": len(schema),
            "schema": schema
        }

    return {
        "database": None,
        "table_count": 0,
        "schema": {}
    }

@router.get("/telemetry")
def get_telemetry_endpoint(current_user: dict = Depends(get_current_user)):
    """Returns runtime telemetry statistics strictly isolated per user/organization."""
    user_role = current_user.get("role", "STANDARD_USER")
    org_id = current_user.get("org_id")
    user_id = current_user.get("user_id")
    
    # 1. Fetch persisted records from MongoDB Atlas strictly isolated
    mongo_items = []
    try:
        if user_role == "ADMIN":
            mongo_items = mongo_service.get_recent_telemetry(org_id=org_id, limit=50)
        else:
            mongo_items = mongo_service.get_recent_telemetry(user_id=user_id, limit=50)
    except Exception as e:
        print(f"[Telemetry Fetch Error] {e}")

    # 2. Collect sanitized in-memory logs strictly scoped to user/org
    sanitized_memory = []
    for item in telemetry_log:
        item_user = item.get("user_id")
        item_org = item.get("org_id")
        
        # Isolation boundary: Admins see queries inside their org; standard users see only their own
        if user_role == "ADMIN":
            if item_org and org_id and item_org != org_id:
                continue
        else:
            if item_user and user_id and item_user != user_id:
                continue

        cleaned = dict(item)
        if "_id" in cleaned:
            cleaned["_id"] = str(cleaned["_id"])
        sanitized_memory.append(cleaned)

    # 3. Merge uniquely by id (in-memory recent first, then mongo persisted)
    seen_ids = set()
    combined = []
    for item in list(reversed(sanitized_memory)) + mongo_items:
        item_id = str(item.get("id") or item.get("_id") or "")
        if item_id and item_id not in seen_ids:
            seen_ids.add(item_id)
            current_tables = item.get("tables_used") or item.get("tablesUsed") or []
            if (not current_tables or len(current_tables) > 8) and item.get("sql"):
                extracted = extract_tables_from_sql(item.get("sql"))
                item["tables_used"] = extracted if extracted else current_tables
            else:
                item["tables_used"] = current_tables
            combined.append(item)

    recent = combined[:25]
    total_queries = len(combined)
    avg_latency = round(sum(item.get("latency_ms", 15.0) for item in recent) / len(recent), 2) if recent else 18.4

    return {
        "total_queries": total_queries,
        "avg_latency_ms": avg_latency,
        "recent_queries": recent
    }

@router.delete("/telemetry/{item_id}")
def delete_telemetry_endpoint(item_id: str, current_user: dict = Depends(get_current_user)):
    """Deletes a specific query/telemetry record from MongoDB Atlas and in-memory cache, respecting user isolation."""
    global telemetry_log
    user_role = current_user.get("role", "STANDARD_USER")
    org_id = current_user.get("org_id")
    user_id = current_user.get("user_id")

    telemetry_log = [
        item for item in telemetry_log
        if not (
            (str(item.get("id")) == item_id or str(item.get("_id", "")) == item_id)
            and (item.get("user_id") == user_id or (user_role == "ADMIN" and item.get("org_id") == org_id))
        )
    ]
    mongo_deleted = mongo_service.delete_telemetry_item(
        item_id,
        user_id=None if user_role == "ADMIN" else user_id,
        org_id=org_id if user_role == "ADMIN" else None
    )
    return {"status": "success", "deleted_id": item_id, "mongo_deleted": mongo_deleted}

@router.delete("/telemetry")
def clear_telemetry_endpoint(current_user: dict = Depends(get_current_user)):
    """Clears query telemetry records strictly for the current organization or user."""
    global telemetry_log
    user_role = current_user.get("role", "STANDARD_USER")
    org_id = current_user.get("org_id")
    user_id = current_user.get("user_id")
    
    if user_role == "ADMIN":
        telemetry_log = [item for item in telemetry_log if item.get("org_id") != org_id]
        mongo_service.clear_telemetry(org_id=org_id)
    else:
        telemetry_log = [item for item in telemetry_log if item.get("user_id") != user_id]
        mongo_service.clear_telemetry(user_id=user_id)

    return {"status": "success", "message": "Telemetry history cleared."}
