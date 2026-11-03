# src/api/routes.py
import time
import re
import sqlglot
from sqlglot import exp
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from sqlalchemy import create_engine, inspect, text
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
from src.models.schema_metadata import TableMetadata, ColumnMetadata, ForeignKeyMetadata
from src.api.dependencies import get_current_user

router = APIRouter()

# In-memory telemetry log for executed queries (persisted to MongoDB if connected)
telemetry_log: List[Dict[str, Any]] = []

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

class RawSqlRequest(BaseModel):
    sql: str

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
    
    # AST validation on raw SQL
    is_valid, validation_msg = ast_service.validate(sql, orchestrator.full_schema, user_role=user_role)
    if not is_valid:
        return {
            "status": "blocked",
            "sql": sql,
            "validation_message": validation_msg
        }

    start_time = time.perf_counter()
    execution_result = sql_executor.execute_query(sql)
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
    
    return sql_executor.explain_query(sql, mode=request.mode or "analyze")

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

        # 3. Update runtime services to point to the new connected database
        orchestrator.full_schema = extracted_schema
        orchestrator.all_table_names = list(extracted_schema.keys())
        orchestrator.graph_service = SchemaGraphService(extracted_schema)
        schema_extractor.engine = new_engine
        sql_executor.engine = new_engine
        
        # Build vectors for the new tables
        vector_service.ingest_schema(extracted_schema)

        # 4. Format schema for the frontend graph
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

        return {
            "status": "success",
            "alias": request.alias,
            "database_uri": uri,
            "table_count": len(extracted_schema),
            "schema": formatted_schema
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Database connection error: {str(e)}")

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
                model="gemini-3.5-flash-lite",
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

@router.get("/schema")
def get_schema_endpoint(current_user: dict = Depends(get_current_user)):
    """Returns the database schema graph data (tables, columns, foreign keys)."""
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
        "database": "AdventureWorks",
        "table_count": len(schema),
        "schema": schema
    }

@router.get("/telemetry")
def get_telemetry_endpoint(current_user: dict = Depends(get_current_user)):
    """Returns runtime telemetry statistics from MongoDB Atlas and live session."""
    user_role = current_user.get("role", "STANDARD_USER")
    org_id = current_user.get("org_id")
    
    # 1. Fetch persisted records from MongoDB Atlas
    mongo_items = []
    try:
        # Standard users see their org's queries, admins see enterprise-wide
        target_org = None if user_role == "ADMIN" else org_id
        mongo_items = mongo_service.get_recent_telemetry(org_id=target_org, limit=50)
    except Exception as e:
        print(f"[Telemetry Fetch Error] {e}")

    # 2. Collect sanitized in-memory logs
    sanitized_memory = []
    for item in telemetry_log:
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
            # Ensure tables_used is populated accurately for past & present queries
            current_tables = item.get("tables_used") or item.get("tablesUsed") or []
            if (not current_tables or len(current_tables) > 8) and item.get("sql"):
                extracted = extract_tables_from_sql(item.get("sql"))
                item["tables_used"] = extracted if extracted else current_tables
            else:
                item["tables_used"] = current_tables
            combined.append(item)

    recent = combined[:25]
    total_queries = max(len(combined), len(telemetry_log))
    avg_latency = round(sum(item.get("latency_ms", 15.0) for item in recent) / len(recent), 2) if recent else 18.4

    return {
        "total_queries": total_queries,
        "avg_latency_ms": avg_latency,
        "recent_queries": recent
    }

@router.delete("/telemetry/{item_id}")
def delete_telemetry_endpoint(item_id: str, current_user: dict = Depends(get_current_user)):
    """Deletes a specific query/telemetry record and plan from MongoDB Atlas and in-memory cache."""
    global telemetry_log
    telemetry_log = [item for item in telemetry_log if str(item.get("id")) != item_id and str(item.get("_id", "")) != item_id]
    mongo_deleted = mongo_service.delete_telemetry_item(item_id)
    return {"status": "success", "deleted_id": item_id, "mongo_deleted": mongo_deleted}

@router.delete("/telemetry")
def clear_telemetry_endpoint(current_user: dict = Depends(get_current_user)):
    """Clears all query telemetry records and plans."""
    global telemetry_log
    user_role = current_user.get("role", "STANDARD_USER")
    org_id = current_user.get("org_id")
    target_org = None if user_role == "ADMIN" else org_id
    
    telemetry_log.clear()
    mongo_service.clear_telemetry(org_id=target_org)
    return {"status": "success", "message": "Telemetry history cleared."}
