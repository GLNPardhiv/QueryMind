import re
import sqlglot
from sqlglot import exp
from typing import Dict, List
from src.models.schema_metadata import TableMetadata, ColumnMetadata, ForeignKeyMetadata

def extract_ddl_only(sql_text: str) -> str:
    """
    Fast pre-processor that strips comments, ignores INSERTs, LOCKs, UNLOCKs,
    and non-schema statements, and isolates only CREATE TABLE and relevant ALTER TABLE statements.
    Transforms a 50MB database dump with 100,000s of rows into a clean, lightweight DDL string
    in single-digit milliseconds without loading heavy ASTs.
    """
    if not sql_text:
        return ""

    extracted: List[str] = []
    in_stmt = False
    stmt_type = None
    current_lines: List[str] = []
    depth = 0
    target_prefixes = (
        'create table',
        'create or replace table',
        'create temporary table',
        'alter table'
    )

    for line in sql_text.splitlines():
        trimmed = line.strip()
        if not trimmed:
            continue

        cleaned = trimmed
        if cleaned.startswith('/*') and '*/' in cleaned:
            cleaned = cleaned[cleaned.find('*/') + 2:].strip()
        lower = cleaned.lower()

        if not in_stmt:
            # Skip single-line comments and directives when outside statements
            if lower.startswith('--') or lower.startswith('#') or lower.startswith('/*'):
                continue
            for p in target_prefixes:
                if lower.startswith(p):
                    in_stmt = True
                    stmt_type = 'create' if 'create' in p else 'alter'
                    current_lines = [cleaned]
                    depth = cleaned.count('(') - cleaned.count(')')
                    if stmt_type == 'create' and depth <= 0 and ';' in cleaned:
                        extracted.append('\n'.join(current_lines))
                        in_stmt = False
                        current_lines = []
                    elif stmt_type == 'alter' and cleaned.endswith(';'):
                        extracted.append('\n'.join(current_lines))
                        in_stmt = False
                        current_lines = []
                    break
        else:
            current_lines.append(trimmed)
            depth += trimmed.count('(') - trimmed.count(')')
            if stmt_type == 'create':
                if depth <= 0 and ';' in trimmed:
                    extracted.append('\n'.join(current_lines))
                    in_stmt = False
                    current_lines = []
            elif stmt_type == 'alter':
                if trimmed.endswith(';'):
                    extracted.append('\n'.join(current_lines))
                    in_stmt = False
                    current_lines = []

    if current_lines:
        extracted.append('\n'.join(current_lines))

    # If extraction found target statements, return the isolated DDL; otherwise fallback to original
    return '\n\n'.join(extracted) if extracted else sql_text

def parse_ddl_to_metadata(sql_text: str) -> Dict[str, TableMetadata]:
    """
    Parses a DDL script (CREATE TABLE and ALTER TABLE statements) into TableMetadata structures.
    Uses sqlglot with multi-dialect support and regex fallback.
    """
    # 0. Pre-filter out data rows, locks, and dumps so parsing is instant
    clean_sql = extract_ddl_only(sql_text)
    schema_data: Dict[str, TableMetadata] = {}
    
    # 1. Try parsing with sqlglot across common dialects
    parsed_statements = []
    for dialect in ["mysql", "postgres", "tsql", None]:
        try:
            stmts = sqlglot.parse(clean_sql, read=dialect)
            if any(isinstance(s, (exp.Create, exp.Alter)) for s in stmts if s):
                parsed_statements = stmts
                break
        except Exception:
            continue

    # First pass: CREATE TABLE
    for stmt in parsed_statements:
        if not stmt or not isinstance(stmt, exp.Create):
            continue
        if stmt.args.get("kind") != "TABLE":
            continue

        schema_expr = stmt.this
        if not isinstance(schema_expr, exp.Schema):
            continue

        table_obj = schema_expr.this
        tbl_name = getattr(table_obj, "name", str(table_obj)).strip('`"[]').lower()
        if "." in tbl_name:
            tbl_name = tbl_name.split(".")[-1].strip('`"[]')

        columns: List[ColumnMetadata] = []
        pks: List[str] = []
        fks: List[ForeignKeyMetadata] = []

        for expr in schema_expr.expressions:
            if isinstance(expr, exp.ColumnDef):
                c_name = expr.name.strip('`"[]').lower()
                c_type = expr.kind.sql() if expr.kind else "VARCHAR"
                columns.append(ColumnMetadata(name=c_name, type=c_type))
                for constr in expr.args.get("constraints", []):
                    if isinstance(constr.kind, exp.PrimaryKeyColumnConstraint):
                        pks.append(c_name)
            elif isinstance(expr, exp.PrimaryKey):
                for col in expr.expressions:
                    pks.append(col.name.strip('`"[]').lower())
            elif isinstance(expr, exp.ForeignKey):
                constrained = [c.name.strip('`"[]').lower() for c in expr.expressions]
                ref = expr.args.get("reference")
                if ref:
                    ref_tbl_obj = ref.this.this if hasattr(ref.this, "this") else ref.this
                    ref_tbl = getattr(ref_tbl_obj, "name", str(ref_tbl_obj)).strip('`"[]').lower()
                    if "." in ref_tbl:
                        ref_tbl = ref_tbl.split(".")[-1].strip('`"[]')
                    ref_cols = [c.name.strip('`"[]').lower() for c in (ref.expressions or [])]
                    if not ref_cols and hasattr(ref.this, "expressions") and ref.this.expressions:
                        ref_cols = [c.name.strip('`"[]').lower() for c in ref.this.expressions]
                    fks.append(ForeignKeyMetadata(
                        constrained_columns=constrained,
                        referred_table=ref_tbl,
                        referred_columns=ref_cols
                    ))
            elif isinstance(expr, exp.Constraint):
                for inner in expr.expressions:
                    if isinstance(inner, exp.ForeignKey):
                        constrained = [c.name.strip('`"[]').lower() for c in inner.expressions]
                        ref = inner.args.get("reference")
                        if ref:
                            ref_tbl_obj = ref.this.this if hasattr(ref.this, "this") else ref.this
                            ref_tbl = getattr(ref_tbl_obj, "name", str(ref_tbl_obj)).strip('`"[]').lower()
                            if "." in ref_tbl:
                                ref_tbl = ref_tbl.split(".")[-1].strip('`"[]')
                            ref_cols = [c.name.strip('`"[]').lower() for c in (ref.expressions or [])]
                            if not ref_cols and hasattr(ref.this, "expressions") and ref.this.expressions:
                                ref_cols = [c.name.strip('`"[]').lower() for c in ref.this.expressions]
                            fks.append(ForeignKeyMetadata(
                                constrained_columns=constrained,
                                referred_table=ref_tbl,
                                referred_columns=ref_cols
                            ))
                    elif isinstance(inner, exp.PrimaryKey):
                        for col in inner.expressions:
                            pks.append(col.name.strip('`"[]').lower())

        if tbl_name and columns:
            schema_data[tbl_name] = TableMetadata(
                columns=columns,
                primary_keys=pks,
                foreign_keys=fks
            )

    # Second pass: ALTER TABLE ... ADD CONSTRAINT / FOREIGN KEY
    for stmt in parsed_statements:
        if not stmt or not isinstance(stmt, exp.Alter):
            continue
        table_obj = stmt.this
        tbl_name = getattr(table_obj, "name", str(table_obj)).strip('`"[]').lower()
        if "." in tbl_name:
            tbl_name = tbl_name.split(".")[-1].strip('`"[]')

        if tbl_name not in schema_data:
            continue

        for act in stmt.args.get("actions", []):
            for fk in act.find_all(exp.ForeignKey):
                constrained = [c.name.strip('`"[]').lower() for c in fk.expressions]
                ref = fk.args.get("reference")
                if ref:
                    ref_tbl_obj = ref.this.this if hasattr(ref.this, "this") else ref.this
                    ref_tbl = getattr(ref_tbl_obj, "name", str(ref_tbl_obj)).strip('`"[]').lower()
                    if "." in ref_tbl:
                        ref_tbl = ref_tbl.split(".")[-1].strip('`"[]')
                    ref_cols = [c.name.strip('`"[]').lower() for c in (ref.expressions or [])]
                    if not ref_cols and hasattr(ref.this, "expressions") and ref.this.expressions:
                        ref_cols = [c.name.strip('`"[]').lower() for c in ref.this.expressions]
                    schema_data[tbl_name].foreign_keys.append(ForeignKeyMetadata(
                        constrained_columns=constrained,
                        referred_table=ref_tbl,
                        referred_columns=ref_cols
                    ))

    # 2. Regex fallback if sqlglot didn't find any tables
    if not schema_data:
        cleaned = re.sub(r'/\*[\s\S]*?\*/', '', clean_sql)
        cleaned = re.sub(r'--.*', '', cleaned)
        table_pattern = re.compile(
            r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[`"\[]?\w+[`"\]]?\.)?[`"\[]?(\w+)[`"\]]?\s*\(([\s\S]*?)\)(?:\s*[^;]*)?;',
            re.IGNORECASE
        )
        for match in table_pattern.finditer(cleaned):
            tbl_name = match.group(1).lower()
            body = match.group(2)
            
            lines = []
            curr = []
            depth = 0
            for char in body:
                if char == '(':
                    depth += 1
                elif char == ')':
                    depth -= 1
                if char == ',' and depth == 0:
                    lines.append(''.join(curr).strip())
                    curr = []
                else:
                    curr.append(char)
            if curr:
                lines.append(''.join(curr).strip())

            columns = []
            pks = []
            fks = []

            for line in lines:
                line_str = line.strip()
                if not line_str:
                    continue
                if re.match(r'^(?:CONSTRAINT\s+\w+\s+)?PRIMARY\s+KEY', line_str, re.IGNORECASE):
                    pk_match = re.search(r'\((.*?)\)', line_str)
                    if pk_match:
                        pks.extend([c.strip('`"[] \t') for c in pk_match.group(1).split(',')])
                elif re.match(r'^(?:CONSTRAINT\s+\w+\s+)?FOREIGN\s+KEY', line_str, re.IGNORECASE):
                    fk_match = re.search(r'FOREIGN\s+KEY\s*\((.*?)\)\s*REFERENCES\s+(?:[`"\[]?\w+[`"\]]?\.)?[`"\[]?(\w+)[`"\]]?\s*(?:\((.*?)\))?', line_str, re.IGNORECASE)
                    if fk_match:
                        constrained = [c.strip('`"[] \t') for c in fk_match.group(1).split(',')]
                        ref_tbl = fk_match.group(2).lower()
                        ref_cols = [c.strip('`"[] \t') for c in fk_match.group(3).split(',')] if fk_match.group(3) else []
                        fks.append(ForeignKeyMetadata(
                            constrained_columns=constrained,
                            referred_table=ref_tbl,
                            referred_columns=ref_cols
                        ))
                elif not re.match(r'^(?:CONSTRAINT|KEY|INDEX|UNIQUE|CHECK)', line_str, re.IGNORECASE):
                    parts = line_str.split()
                    if parts:
                        c_name = parts[0].strip('`"[] \t')
                        c_type = parts[1] if len(parts) > 1 else 'VARCHAR'
                        columns.append(ColumnMetadata(name=c_name, type=c_type))
                        if 'PRIMARY KEY' in line_str.upper():
                            pks.append(c_name)

            if tbl_name and columns:
                schema_data[tbl_name] = TableMetadata(
                    columns=columns,
                    primary_keys=pks,
                    foreign_keys=fks
                )

        # Regex fallback for ALTER TABLE ADD CONSTRAINT FOREIGN KEY
        alter_pattern = re.compile(
            r'ALTER\s+TABLE\s+(?:[`"\[]?\w+[`"\]]?\.)?[`"\[]?(\w+)[`"\]]?\s+ADD\s+(?:CONSTRAINT\s+[`"\[]?\w+[`"\]]?\s+)?FOREIGN\s+KEY\s*\((.*?)\)\s*REFERENCES\s+(?:[`"\[]?\w+[`"\]]?\.)?[`"\[]?(\w+)[`"\]]?\s*(?:\((.*?)\))?',
            re.IGNORECASE
        )
        for match in alter_pattern.finditer(cleaned):
            tbl_name = match.group(1).lower()
            constrained = [c.strip('`"[] \t') for c in match.group(2).split(',')]
            ref_tbl = match.group(3).lower()
            ref_cols = [c.strip('`"[] \t') for c in match.group(4).split(',')] if match.group(4) else []
            if tbl_name in schema_data:
                schema_data[tbl_name].foreign_keys.append(ForeignKeyMetadata(
                    constrained_columns=constrained,
                    referred_table=ref_tbl,
                    referred_columns=ref_cols
                ))

    return schema_data
