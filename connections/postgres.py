"""Bounded PostgreSQL connections and SQL validation, separate from SQLite."""

from contextlib import contextmanager
from datetime import date, datetime, time
from decimal import Decimal
import ipaddress
import logging
from urllib.parse import parse_qsl, unquote, urlsplit
from uuid import UUID

from sql_tools import json_value, tokens, main_verb, unique_columns
from .errors import ConnectionFailure, missing_postgres_support


SSL_MODES = {"disable", "require", "verify-full"}


def _result_row(cursor):
    names = unique_columns([column.name for column in cursor.description or []])
    return lambda values: dict(zip(names, values))


SAFE_FUNCTIONS = {
    "ABS", "AVG", "COUNT", "SUM", "MIN", "MAX", "ROUND", "FLOOR", "CEIL", "CEILING",
    "COALESCE", "NULLIF", "CAST", "TRY_CAST", "CASE", "IF", "LOWER", "UPPER", "LENGTH",
    "CHAR_LENGTH", "TRIM", "LTRIM", "RTRIM", "SUBSTRING", "CONCAT", "CONCAT_WS", "REPLACE",
    "CURRENT_DATE", "CURRENT_TIMESTAMP", "CURRENT_TIME", "NOW", "DATE_TRUNC", "TIMESTAMP_TRUNC",
    "EXTRACT", "TO_CHAR", "TO_DATE", "TO_TIMESTAMP", "AGE", "DATE_PART", "GREATEST", "LEAST",
    "ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD", "FIRST_VALUE", "LAST_VALUE", "NTILE",
    "STRING_AGG", "GROUP_CONCAT", "ARRAY_AGG", "JSON_AGG", "JSONB_AGG", "JSON_BUILD_OBJECT",
    "JSONB_BUILD_OBJECT", "JSON_EXTRACT", "JSON_EXTRACT_SCALAR", "GEN_RANDOM_UUID", "PERCENTILE_CONT",
    "PERCENTILE_DISC", "STDDEV", "STDDEV_POP", "STDDEV_SAMP", "VARIANCE", "ARRAY_SIZE",
    "POWER", "SQRT", "MOD", "SIGN", "INT_DIV", "STARTSWITH", "ENDSWITH", "DATE", "TIMESTAMP",
    "TIME_TO_STR", "STR_TO_TIME", "STR_TO_DATE", "DATE_ADD", "DATE_SUB", "TIMESTAMP_ADD", "TIMESTAMP_SUB",
    "RAND", "RANDOM", "GENERATE_SERIES", "EXPLODING_GENERATE_SERIES", "EXISTS",
}


def connection_config(payload):
    """Accept only explicit connection fields, never libpq service/file options."""
    raw = str(payload.get("connection_url") or "").strip()
    try:
        parsed = urlsplit(raw)
        port = parsed.port if parsed.port is not None else 5432
        if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname or not parsed.username or not parsed.password or not parsed.path.strip("/"):
            raise ValueError()
        if parsed.fragment or len(raw) > 4096 or not 1 <= port <= 65535:
            raise ValueError()
    except ValueError:
        raise ValueError("Use a PostgreSQL URL with a host, user, password, and database name.") from None
    options = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if set(options) - {"sslmode", "channel_binding", "sslrootcert"}:
        raise ValueError("Only sslmode, channel_binding, and sslrootcert=system are supported URL options.")
    binding = options.get("channel_binding", "prefer")
    if binding not in {"disable", "prefer", "require"}:
        raise ValueError("Use channel_binding=prefer or require for PostgreSQL authentication.")
    if "sslrootcert" in options and options["sslrootcert"] != "system":
        raise ValueError("Only the system certificate store is supported; certificate file paths are not accepted.")
    local = parsed.hostname.lower() == "localhost"
    try:
        local = local or ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        pass
    ssl = options.get("sslmode", "disable" if local else "verify-full")
    if options.get("sslrootcert") == "system":
        ssl = "verify-full"
    if ssl not in SSL_MODES or (ssl == "disable" and not local):
        raise ValueError("Use sslmode=require or verify-full for an external PostgreSQL host.")
    schema = str(payload.get("schema_name") or "public").strip()
    name = str(payload.get("database_name") or unquote(parsed.path[1:])).strip()
    if not schema or len(schema.encode()) > 63 or "\0" in schema:
        raise ValueError("Choose a PostgreSQL schema name of up to 63 bytes.")
    if not name or len(name) > 150 or "\0" in name or "://" in name:
        raise ValueError("Choose a connection name of up to 150 characters.")
    return {"host": parsed.hostname, "port": port, "user": unquote(parsed.username),
            "password": unquote(parsed.password or ""), "dbname": unquote(parsed.path[1:]),
            "sslmode": ssl, "channel_binding": binding, "schema_name": schema, "name": name,
            "read_only": payload.get("allow_changes") is not True}


def _value(value):
    if isinstance(value, int) and abs(value) > 9007199254740991:
        return str(value)  # Preserve bigint IDs when the browser parses JSON.
    if isinstance(value, (date, datetime, time)):
        return value.isoformat()
    if isinstance(value, (Decimal, UUID)):
        return str(value)
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, dict):
        return {str(key): _value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_value(item) for item in value]
    if value is None or isinstance(value, (str, bool, int, float, bytes)):
        return json_value(value)
    return str(value)


def _is_cte_reference(table):
    """Resolve WITH aliases in their actual lexical scope, including DML scopes."""
    if table.db or table.catalog:
        return False
    ancestors = []
    parent = table.parent
    while parent is not None:
        ancestors.append(parent)
        parent = parent.parent
    ancestor_ids = {id(item) for item in ancestors}
    for parent in ancestors:
        clause = parent.args.get("with_")
        if clause is None:
            continue
        visible = clause.expressions
        if not clause.args.get("recursive"):
            defining = next((index for index, cte in enumerate(visible) if id(cte) in ancestor_ids), None)
            if defining is not None:
                visible = visible[:defining]
        if any(cte.alias_or_name == table.name for cte in visible):
            return True
    return False


class PostgresConnector:
    dialect = "postgresql"

    def __init__(self, config):
        self.config = config
        self._schema = None

    @contextmanager
    def connection(self, read_only=True):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError:
            raise missing_postgres_support() from None
        parameters = {key: self.config[key] for key in ("host", "port", "user", "password", "dbname", "sslmode")}
        parameters["channel_binding"] = self.config.get("channel_binding", "prefer")
        if self.config["sslmode"] == "verify-full":
            parameters["sslrootcert"] = "system"
        try:
            with psycopg.connect(**parameters, connect_timeout=5, prepare_threshold=None, row_factory=dict_row,
                                 application_name="Data Genie", options="-c statement_timeout=5000 -c lock_timeout=2000") as connection:
                connection.read_only = read_only
                # User tables are explicitly qualified below. Function lookup stays in pg_catalog.
                connection.execute("SELECT pg_catalog.set_config('search_path', 'pg_catalog', true)")
                yield connection
        except psycopg.Error as exc:
            code = exc.sqlstate or ""
            if code in {"28P01", "28000", "3D000"}:
                message = ("PostgreSQL rejected the saved login details. Enter the connection details again."
                           if code != "3D000" else "The saved PostgreSQL database no longer exists. Check its connection details.")
                raise ConnectionFailure(message, "postgres_credentials_invalid", "reconnect", 409) from None
            messages = {"28P01": "PostgreSQL rejected the username or password.",
                        "3D000": "The PostgreSQL database does not exist.",
                        "42501": "The PostgreSQL user does not have permission for this operation.",
                        "57014": "The PostgreSQL query timed out. Try a smaller request.",
                        "55P03": "PostgreSQL is busy with another change. Try again shortly.",
                        "25006": "This operation cannot run on a read-only connection."}
            message = messages.get(code)
            if not message and code.startswith(("22", "23", "42")):
                message = str(getattr(exc.diag, "message_primary", "") or "The SQL could not be executed.")[:300]
            if message:
                raise ValueError(message) from None
            raise ConnectionFailure(
                "Could not reach PostgreSQL. Make sure its server is running and the host, port, and SSL settings are correct, "
                "then try again. Your saved connection has not been removed.",
                "postgres_unavailable",
            ) from None

    def schema(self, refresh=False):
        if self._schema is not None and not refresh:
            return self._schema
        namespace = self.config["schema_name"]
        with self.connection() as connection:
            if not connection.execute("SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=%s AND pg_catalog.has_schema_privilege(oid,'USAGE')", (namespace,)).fetchone():
                raise ConnectionFailure("That PostgreSQL schema does not exist or is not accessible. Check the connection details.",
                                        "postgres_schema_unavailable", "reconnect", 409)
            records = connection.execute("""
                SELECT c.oid,c.relname,a.attnum,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
                       a.attnotnull,a.attidentity,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS column_default,
                       c.reltuples::bigint AS approximate_rows
                FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
                LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
                WHERE n.nspname=%s AND c.relkind IN ('r','p','v','m')
                  AND pg_catalog.has_table_privilege(c.oid,'SELECT')
                ORDER BY c.relname,a.attnum
            """, (namespace,)).fetchall()
            constraints = connection.execute("""
                SELECT c.relname,k.oid,k.contype,pg_catalog.pg_get_constraintdef(k.oid) AS definition,
                       r.relname AS target, rn.nspname AS target_schema,k.confupdtype,k.confdeltype,
                       ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY f(num,position)
                             JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=f.num ORDER BY f.position) AS columns,
                       ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY f(num,position)
                             JOIN pg_catalog.pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=f.num ORDER BY f.position) AS target_columns
                FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
                JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                LEFT JOIN pg_catalog.pg_class r ON r.oid=k.confrelid
                LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid=r.relnamespace WHERE n.nspname=%s
            """, (namespace,)).fetchall()
        tables = {}
        for row in records:
            table = tables.setdefault(row["relname"], {"name": row["relname"], "sql": "", "columns": [], "unique_indexes": [],
                "foreign_keys": [], "row_count": max(row["approximate_rows"], 0) if row["approximate_rows"] >= 0 else None,
                "row_count_estimated": True})
            default = row["column_default"] or ("GENERATED AS IDENTITY" if row["attidentity"] else None)
            table["columns"].append({"name": row["attname"], "type": row["data_type"], "not_null": row["attnotnull"],
                "notnull": row["attnotnull"], "primary_key": False, "pk": 0, "default": default, "dflt_value": default,
                "constraints": ["NOT NULL"] if row["attnotnull"] else [], "extra_constraints": []})
        actions = {"a": "NO ACTION", "r": "RESTRICT", "c": "CASCADE", "n": "SET NULL", "d": "SET DEFAULT"}
        for item in constraints:
            table = tables.get(item["relname"])
            if not table:
                continue
            columns = {column["name"]: column for column in table["columns"]}
            if item["contype"] == "u":
                table["unique_indexes"].append(item["columns"])
            for index, name in enumerate(item["columns"]):
                column = columns[name]
                if item["contype"] == "p":
                    column.update(primary_key=True, pk=index + 1)
                    column["constraints"].append("PRIMARY KEY")
                elif item["contype"] in {"c", "u"}:
                    kind = "CHECK" if item["contype"] == "c" else "UNIQUE"
                    column["constraints"].append(kind)
                    column["extra_constraints"].append((kind, item["definition"]))
                elif item["contype"] == "f":
                    target = item["target"] if item["target_schema"] == namespace else item["target_schema"] + "." + item["target"]
                    table["foreign_keys"].append({"id": item["oid"], "seq": index, "from": name,
                        "table": target, "to": item["target_columns"][index], "on_update": actions[item["confupdtype"]],
                        "on_delete": actions[item["confdeltype"]], "single_column": len(item["columns"]) == 1})
        if len({name.lower() for name in tables}) != len(tables):
            raise ValueError("This schema has table names differing only by case, which Data Genie does not support yet.")
        self._schema = list(tables.values())
        return self._schema

    def _parsed(self, sql):
        try:
            import sqlglot
            from sqlglot import exp
            from sqlglot.optimizer.normalize_identifiers import normalize_identifiers
        except ImportError:
            raise missing_postgres_support() from None
        # Unsupported-syntax warnings include raw SQL and may contain private literals.
        logging.getLogger("sqlglot").setLevel(logging.ERROR)
        try:
            expressions = sqlglot.parse(sql, read="postgres")
        except sqlglot.errors.ParseError:
            raise ValueError("The request did not produce valid PostgreSQL SQL. Try rephrasing it.") from None
        if len(expressions) != 1 or expressions[0] is None:
            raise ValueError("Use exactly one PostgreSQL statement.")
        root = normalize_identifiers(expressions[0], dialect="postgres")
        read = isinstance(root, exp.Query)
        write = isinstance(root, (exp.Insert, exp.Update, exp.Delete, exp.Create, exp.Alter, exp.Drop))
        if not read and not write:
            raise ValueError("That PostgreSQL operation is not available in Data Genie.")
        if read and any(isinstance(item, (exp.Insert, exp.Update, exp.Delete, exp.Create, exp.Alter, exp.Drop, exp.Into, exp.Lock)) for item in root.walk()):
            raise ValueError("Read queries cannot contain database changes or row locks.")
        if write and self.config["read_only"]:
            raise ValueError("This connection is read-only. Add a connection with changes enabled to modify data.")
        if any(isinstance(item, (exp.Insert, exp.Update, exp.Delete, exp.Create, exp.Alter, exp.Drop))
               for cte in root.find_all(exp.CTE) for item in cte.walk()):
            raise ValueError("Use separate statements for changes so each change has its own confirmation.")
        if isinstance(root, (exp.Create, exp.Alter, exp.Drop)) and str(root.args.get("kind", "")).upper() != "TABLE":
            raise ValueError("Only table changes are supported; functions, roles, and other server objects cannot be changed.")
        if any(isinstance(item, (exp.Command, exp.TemporaryProperty)) for item in root.walk()):
            raise ValueError("Temporary tables and server commands are not supported through this connection.")
        for item in root.find_all(exp.Func):
            name = item.name.upper() if isinstance(item, exp.Anonymous) else item.sql_name().upper()
            if name not in SAFE_FUNCTIONS:
                raise ValueError("That SQL function is not available through this connection: " + name)
            if isinstance(item.parent, exp.Dot) and item.parent.expression is item:
                namespace = item.parent.this
                if not isinstance(namespace, exp.Identifier) or namespace.name != "pg_catalog":
                    raise ValueError("Only built-in PostgreSQL functions from pg_catalog are supported.")
        known = {table["name"] for table in self.schema()}
        targets = []
        operation = "SELECT" if read else type(root).__name__.upper()
        primary = root.this.this if isinstance(root.this, exp.Schema) else root.this
        if isinstance(root, exp.Drop):
            dropping = root.args.get("tables") or [root.this]
            if len(dropping) != 1:
                raise ValueError("Drop one table per statement so each table gets its own confirmation.")
            primary = dropping[0]
        renames = list(root.find_all(exp.AlterRename))
        for rename in renames:
            if rename.this.db or rename.this.catalog:
                raise ValueError("Rename tables within the connected schema using an unqualified new name.")
            if primary.name != rename.this.name and primary.name.lower() == rename.this.name.lower():
                raise ValueError("Case-only table renames are not supported. Choose a different table name.")
        rename_destinations = {id(item.this) for item in renames}
        for table in root.find_all(exp.Table):
            if isinstance(table.this, exp.Func):
                if table.catalog or table.db not in {"", "pg_catalog"}:
                    raise ValueError("Only built-in PostgreSQL table functions are supported.")
                continue  # Functions were checked above; they cannot replace a real table target.
            if id(table) in rename_destinations:
                continue
            if table.catalog or (table.db and table.db != self.config["schema_name"]):
                raise ValueError("Use tables from the connected PostgreSQL schema.")
            is_target = not read and table is primary
            if not is_target and _is_cte_reference(table):
                continue
            if is_target and operation == "CREATE" and any(name.lower() == table.name.lower() and name != table.name for name in known):
                raise ValueError("A table with this name already exists using different letter case.")
            if table.name not in known and not (is_target and operation == "CREATE"):
                raise ValueError("Unknown table: " + table.name + ". Refresh the structure or name an available table.")
            access = "define" if is_target and operation in {"CREATE", "ALTER", "DROP"} else "write" if is_target else "read"
            target = {"table_name": table.name, "access_type": access}
            if target not in targets:
                targets.append(target)
            table.set("db", exp.to_identifier(self.config["schema_name"], quoted=True))
        if not targets:
            raise ValueError("The query must refer to a table in the connected database.")
        return root, {"kind": "SELECT" if read else "DDL" if operation in {"CREATE", "ALTER", "DROP"} else "DML",
                      "operation": operation, "access": "read" if read else "write", "targets": targets,
                      "has_aggregation": any(isinstance(item, exp.AggFunc) for item in root.walk())}

    def prepare(self, sql, validate_live=True):
        root, details = self._parsed(sql)
        if validate_live and details["operation"] in {"SELECT", "INSERT", "UPDATE", "DELETE"}:
            with self.connection() as connection:
                connection.execute("EXPLAIN (FORMAT JSON) " + root.sql(dialect="postgres")).fetchall()
        if details["access"] == "write":
            target = next((item["table_name"] for item in details["targets"] if item["access_type"] != "read"), None)
            details["preview"] = {"table": target, "affected_rows": None}
        return details

    def prepare_batch(self, plans):
        """Track planned schema names in memory; never execute writes to preview them."""
        from copy import deepcopy
        from sqlglot import exp
        original = self.schema()
        self._schema = deepcopy(original)
        prepared, validate_live = [], True
        try:
            for plan in plans:
                details = self.prepare(plan["sql"], validate_live=validate_live)
                if main_verb(plan["sql"]).upper() != details["operation"]:
                    raise ValueError("Start the statement with SELECT, WITH, or a supported table change.")
                clean_sql = plan["sql"].strip()
                parts = tokens(clean_sql)
                if parts and parts[-1][0] == "symbol" and parts[-1][1] == ";":
                    clean_sql = clean_sql[:parts[-1][2]].rstrip()
                prepared.append({**plan, **details, "sql": clean_sql})
                if details["kind"] != "DDL":
                    continue
                validate_live = False
                root, _ = self._parsed(plan["sql"])
                name = next(item["table_name"] for item in details["targets"] if item["access_type"] == "define")
                table = next((item for item in self._schema if item["name"] == name), None)
                if isinstance(root, exp.Create):
                    table = {"name": name, "columns": [], "foreign_keys": [], "row_count": None}
                    self._schema.append(table)
                elif isinstance(root, exp.Drop):
                    self._schema.remove(table)
                    continue
                for column in root.find_all(exp.ColumnDef):
                    table["columns"].append({"name": column.name, "type": column.args["kind"].sql(dialect="postgres"),
                        "primary_key": any(isinstance(item, exp.PrimaryKeyColumnConstraint) for item in column.walk()),
                        "not_null": any(isinstance(item, exp.NotNullColumnConstraint) for item in column.walk()),
                        "default": None, "constraints": []})
                for rename in root.find_all(exp.AlterRename):
                    table["name"] = rename.this.name
            return prepared
        finally:
            self._schema = original

    def execute(self, sql, operation="read", limit=500, offset=None):
        if isinstance(limit, bool) or not isinstance(limit, int) or not 0 <= limit <= 500:
            raise ValueError("Choose a result page size between 0 and 500.")
        if offset is not None and (isinstance(offset, bool) or not isinstance(offset, int) or offset < 0):
            raise ValueError("Choose a non-negative result offset.")
        root, details = self._parsed(sql)
        if details["access"] != operation:
            raise ValueError("The SQL operation changed. Prepare the request again.")
        statement = root.sql(dialect="postgres")
        if operation == "read":
            # Bound rows on the server, before psycopg buffers a result. Only checked ints
            # are rendered here; SQL percent literals must never become DB-API placeholders.
            statement = f"SELECT * FROM ({statement}) AS result_page LIMIT {limit + 1} OFFSET {offset or 0}"
        with self.connection(read_only=operation == "read") as connection:
            cursor = connection.cursor(row_factory=_result_row)
            cursor.execute(statement)
            columns = unique_columns([item.name for item in cursor.description]) if cursor.description else []
            fetched = cursor.fetchmany(limit + 1) if cursor.description else []
            changes = max(cursor.rowcount, 0) if operation == "write" else 0
            # Never leave a RETURNING cursor active when a confirmed transaction commits.
            if operation == "write" and cursor.description:
                while cursor.fetchmany(1000):
                    pass
        if operation == "write":
            self._schema = None
        return {"rows": [{key: _value(value) for key, value in row.items()} for row in fetched[:limit]],
                "columns": columns, "changes": changes, "truncated": len(fetched) > limit,
                "sql": sql, "executed_sql": statement}

    def columns(self, sql):
        return self.execute(sql, limit=0, offset=0)["columns"]
