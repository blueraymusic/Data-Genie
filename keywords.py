"""Small, explicit command grammar for the supported SQLite workbench requests."""

import re

from sql_tools import quote_identifier, tokens


IDENTIFIER = r"[A-Za-z_][A-Za-z_0-9]*"
TABLE_NAME = rf'(?:{IDENTIFIER}|"(?:[^"]|"")+")'
NUMERIC_TYPES = ("INT", "REAL", "NUM", "DEC", "FLOAT", "DOUBLE")


class KeywordError(ValueError):
    pass


def unquoted(text):
    masked = list(text)
    for kind, _, start, end in tokens(text):
        if kind in {"string", "identifier", "comment"}:
            masked[start:end] = "\x01" * (end - start)
    return "".join(masked)


def split_outside(text, pattern):
    matches = list(re.finditer(pattern, unquoted(text), re.IGNORECASE))
    result = []
    start = 0
    for match in matches:
        result.append(text[start:match.start()].strip())
        start = match.end()
    result.append(text[start:].strip())
    return result


def split_requests(text):
    parts = split_outside(text.strip(), r"\s+(?:and\s+then|then|and(?=\s+(?:insert|create|update|delete|drop|add)\b))\s+")
    if not all(parts) or len(parts) > 10:
        raise KeywordError("Use between one and ten complete commands, separated by 'then'.")
    return parts


def literal(value, column=None):
    value = value.strip()
    quoted = value.startswith(("'", '"'))
    if quoted:
        quote = value[0]
        if len(value) < 2 or value[-1] != quote:
            raise KeywordError("Close the quoted value before continuing.")
        parsed = tokens(value)
        if len(parsed) != 1 or parsed[0][0] not in {"string", "identifier"} or parsed[0][3] != len(value):
            raise KeywordError("Use one quoted value; escape a quote by doubling it.")
        inner = value[1:-1].replace(quote + quote, quote)
        result = "'" + inner.replace("'", "''") + "'"
    elif value.lower() == "null":
        return "NULL"
    elif re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", value):
        result = value
    elif re.search(r"[;]|\b(?:and|or)\b", value, re.IGNORECASE):
        raise KeywordError("Quote text values and use supported column comparisons.")
    else:
        result = "'" + value.replace("'", "''") + "'"
    if column:
        datatype = (column.get("type") or "").upper()
        content = inner if quoted else value
        if "INT" in datatype and not re.fullmatch(r"[+-]?\d+", content):
            raise KeywordError(f"{column['name']} requires an integer value.")
        if any(kind in datatype for kind in ("REAL", "NUM", "DEC", "FLOAT", "DOUBLE")):
            try:
                float(content)
            except ValueError as exc:
                raise KeywordError(f"{column['name']} requires a numeric value.") from exc
        if "BLOB" in datatype:
            raise KeywordError("Use SQL with a hexadecimal literal for binary values.")
    return result


def is_numeric(column):
    return any(kind in (column.get("type") or "").upper() for kind in NUMERIC_TYPES)


def is_date(column):
    name = column["name"].lower()
    declared_type = (column.get("type") or "").upper()
    return ("DATE" in declared_type or "TIME" in declared_type
            or name in {"date", "time", "timestamp", "month", "year"}
            or name.endswith(("_date", "_time", "_timestamp", "_month", "_year", "_at")))


def resolve_table(name, tables):
    if name.startswith('"') and name.endswith('"'):
        name = name[1:-1].replace('""', '"')
    found = next((table for table in tables if table.lower() == name.lower()), None)
    if not found:
        raise KeywordError(f"Unknown table: {name}.")
    return found


def column_by_name(name, columns):
    found = next((column for column in columns if column["name"].lower() == name.lower()), None)
    if not found:
        raise KeywordError(f"Unknown column: {name}.")
    return found


def assignments(text, columns):
    result = []
    seen = set()
    for item in split_outside(text, r","):
        match = re.fullmatch(rf"\s*({IDENTIFIER})\s*=\s*(.+)\s*", item, re.DOTALL)
        if not match:
            raise KeywordError("Use column=value assignments separated by commas.")
        column = column_by_name(match[1], columns)
        if column["name"] in seen:
            raise KeywordError(f"Assign {column['name']} only once.")
        seen.add(column["name"])
        result.append((column["name"], literal(match[2], column)))
    return result


def conditions(text, columns):
    result = []
    for item in split_outside(text, r"\s+and\s+"):
        match = re.fullmatch(rf"\s*({IDENTIFIER})\s*(>=|<=|!=|<>|=|>|<|\bcontains\b|\blike\b|\bis\s+not\b|\bis\b)\s*(.+)\s*", item, re.IGNORECASE | re.DOTALL)
        if not match:
            raise KeywordError("Use filters like 'where quantity > 2 and item = \"widget\"'.")
        column = column_by_name(match[1], columns)
        op, value = match[2].lower(), match[3].strip()
        if op in {"contains", "like"}:
            if value.startswith(("'", '"')):
                raw = literal(value)[1:-1].replace("''", "'")
            else:
                raw = value
            rendered = "'" + ("%" + raw + "%").replace("'", "''") + "'"
            op = "LIKE"
        else:
            rendered = literal(value, column)
            if rendered == "NULL":
                if op in {"=", "is"}:
                    op = "IS"
                elif op in {"!=", "<>", "is not"}:
                    op = "IS NOT"
                else:
                    raise KeywordError("Use = NULL or != NULL for a null filter.")
        result.append(f"{quote_identifier(column['name'])} {op.upper()} {rendered}")
    return " AND ".join(result)


def read_clauses(question, columns):
    masked = unquoted(question)
    match = re.search(r"\s+where\s+", masked, re.IGNORECASE)
    sort = re.search(r"\s+(?:sort|order)\s+by\s+", masked, re.IGNORECASE)
    limit = re.search(r"\s+limit\s+", masked, re.IGNORECASE)
    starts = [m.start() for m in (match, sort, limit) if m]
    base = question[:min(starts)] if starts else question
    where_sql, order_sql = "", ""
    if match:
        end = min([m.start() for m in (sort, limit) if m and m.start() > match.start()] or [len(question)])
        where_sql = " WHERE " + conditions(question[match.end():end], columns)
    if sort:
        end = limit.start() if limit and limit.start() > sort.start() else len(question)
        values = re.fullmatch(rf"({IDENTIFIER})(?:\s+(asc|desc))?", question[sort.end():end].strip(), re.IGNORECASE)
        if not values:
            raise KeywordError("Sort by one column followed by ASC or DESC.")
        column = column_by_name(values[1], columns)
        order_sql = f" ORDER BY {quote_identifier(column['name'])} {(values[2] or 'ASC').upper()}"
    row_limit = 50
    if limit:
        value = question[limit.end():].strip()
        if not value.isdigit() or not 1 <= int(value) <= 500:
            raise KeywordError("The display limit must be between 1 and 500.")
        row_limit = int(value)
    return base.strip(), where_sql, order_sql, row_limit


def result_plan(sql, summary, visualization="table"):
    return {"sql": sql, "summary": summary, "visualization": visualization}


def metadata_plan(question, tables):
    if re.fullmatch(r"(?:tables|what\s+tables|list\s+tables|show\s+tables)\??", question.strip(), re.IGNORECASE):
        return result_plan("SELECT name AS table_name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", "Tables in this database.")
    match = re.fullmatch(rf"show\s+(?:columns|schema)\s+(?:(?:from|in|of)\s+)?({TABLE_NAME})", question.strip(), re.IGNORECASE)
    match = match or re.fullmatch(
        rf"(?:show|describe|display)(?: me)? (?:the )?(?:structure|schema|columns) (?:of|for|in|from) (?:the )?({TABLE_NAME})(?: table)?\??",
        question.strip(), re.IGNORECASE,
    )
    if match:
        table = resolve_table(match[1], tables)
        table_literal = "'" + table.replace("'", "''") + "'"
        return result_plan(f"SELECT name,type,pk AS primary_key FROM pragma_table_info({table_literal})", f"Columns in {table}.")
    return None


def wants_database_structure(question):
    """Recognize whole-database inspection requests before an AI planner sees them."""
    text = re.sub(r"\s+", " ", str(question or "").strip().lower()).rstrip("?")
    return bool(re.fullmatch(
        r"(?:show|describe|display|what is|what's|give me|list) (?:me )?(?:the )?(?:database|db)(?:'s)? (?:structure|schema)|"
        r"(?:show|describe|display|what is|what's|give me|list) (?:me )?(?:the )?(?:structure|schema) (?:of|for|in) (?:the )?(?:database|db)|"
        r"(?:database|db) (?:structure|schema)|schema", text
    ))


def plan(question, tables, schema):
    question = question.strip()
    metadata = metadata_plan(question, tables)
    if metadata:
        return metadata

    quoted = re.fullmatch(rf'/?(create|update|remove)\s+(?:({IDENTIFIER})\s+)?"([^"]*)"(?:\s+"([^"]*)")?', question, re.IGNORECASE)
    if quoted:
        action, named_table, old, new = quoted.groups()
        if named_table:
            table = resolve_table(named_table, tables)
        elif len(tables) == 1:
            table = tables[0]
        else:
            raise KeywordError("Name a table before the quoted column name.")
        columns = schema(table)["columns"]
        name = re.sub(r"[^A-Za-z_0-9]+", "_", (new if action.lower() == "update" else old).strip()).strip("_").lower()
        if not name:
            raise KeywordError("A column name cannot be empty.")
        if name[0].isdigit():
            name = "_" + name
        if action.lower() == "create":
            return result_plan(f"ALTER TABLE {quote_identifier(table)} ADD COLUMN {quote_identifier(name)} TEXT DEFAULT NULL", f"Add {name} to {table}.", "text")
        column = column_by_name(old.strip(), columns)
        if action.lower() == "remove":
            sql = f"ALTER TABLE {quote_identifier(table)} DROP COLUMN {quote_identifier(column['name'])}"
        elif new is not None:
            sql = f"ALTER TABLE {quote_identifier(table)} RENAME COLUMN {quote_identifier(column['name'])} TO {quote_identifier(name)}"
        else:
            raise KeywordError('Rename with update table "old" "new".')
        return result_plan(sql, f"Change columns in {table}.", "text")

    create = re.fullmatch(rf"create\s+(?:a\s+)?table\s+({TABLE_NAME})(?:\s*\((.+)\)|\s+with\s+(.+))?", question, re.IGNORECASE | re.DOTALL)
    if create:
        name, parenthesized, described = create.groups()
        if name.startswith('"'):
            name = name[1:-1].replace('""', '"')
        if any(name.lower() == table.lower() for table in tables):
            raise KeywordError(f"Table {name} already exists.")
        definitions = parenthesized or described or "id INTEGER PRIMARY KEY"
        return result_plan(f"CREATE TABLE {quote_identifier(name)} ({definitions})", f"Create table {name} with the specified columns.", "text")

    add = re.fullmatch(rf"(?:create|add|alter)\s+(?:a\s+)?column\s+({IDENTIFIER})(?:\s+(TEXT|INTEGER|INT|REAL|NUMERIC|BLOB))?\s+(?:to|in|on)\s+({TABLE_NAME})", question, re.IGNORECASE)
    if add:
        column, datatype, name = add.groups()
        table = resolve_table(name, tables)
        return result_plan(f"ALTER TABLE {quote_identifier(table)} ADD COLUMN {quote_identifier(column)} {(datatype or 'TEXT').upper()} DEFAULT NULL", f"Add {column} to {table}.", "text")

    drop = re.fullmatch(rf"drop\s+(?:the\s+)?table\s+({TABLE_NAME})", question, re.IGNORECASE)
    if drop:
        table = resolve_table(drop[1], tables)
        return result_plan(f"DROP TABLE {quote_identifier(table)}", f"Permanently drop {table}.", "text")

    delete = re.fullmatch(rf"delete(?:\s+all)?(?:\s+rows)?\s+from\s+({TABLE_NAME})(?:\s+where\s+(.+))?", question, re.IGNORECASE | re.DOTALL)
    if delete:
        table = resolve_table(delete[1], tables)
        suffix = " WHERE " + conditions(delete[2], schema(table)["columns"]) if delete[2] else ""
        return result_plan(f"DELETE FROM {quote_identifier(table)}{suffix}", f"Delete {'matching' if suffix else 'every'} row{'s' if suffix else ''} from {table}.", "text")

    insert = re.fullmatch(rf"(?:insert\s+into|add\s+(?:a\s+)?record\s+to)\s+({TABLE_NAME})\s+(.+)", question, re.IGNORECASE | re.DOTALL)
    if insert:
        table = resolve_table(insert[1], tables)
        pairs = assignments(insert[2], schema(table)["columns"])
        names = ", ".join(quote_identifier(name) for name, _ in pairs)
        values = ", ".join(value for _, value in pairs)
        return result_plan(f"INSERT INTO {quote_identifier(table)} ({names}) VALUES ({values})", f"Insert one row into {table}.", "text")

    update = re.match(rf"^update\s+({TABLE_NAME})\s+set\s+", question, re.IGNORECASE)
    if update:
        table = resolve_table(update[1], tables)
        pieces = split_outside(question[update.end():], r"\s+where\s+")
        if len(pieces) != 2:
            raise KeywordError("An update needs assignments followed by a WHERE filter.")
        columns = schema(table)["columns"]
        pairs = assignments(pieces[0], columns)
        set_sql = ", ".join(f"{quote_identifier(name)} = {value}" for name, value in pairs)
        return result_plan(f"UPDATE {quote_identifier(table)} SET {set_sql} WHERE {conditions(pieces[1], columns)}", f"Update matching rows in {table}.", "text")

    if not re.match(r"^(?:show|list|preview|get|data|records|rows|count|how\s+many|number\s+of\s+rows|analyze|trend|compare|average|avg|sum|total|min|minimum|max|maximum|top|highest|lowest)\b", question, re.IGNORECASE):
        raise KeywordError("Use show, count, analyze, compare, trend, create table, insert, update, delete or drop table.")
    plain = unquoted(question)
    mentioned = [(match.start(), table) for table in tables for match in [re.search(rf"\b{re.escape(table)}\b", plain, re.IGNORECASE)] if match]
    for kind, value, start, _ in tokens(question):
        if kind == "identifier" and value.startswith('"'):
            named = value[1:-1].replace('""', '"')
            mentioned.extend((start, table) for table in tables if table.lower() == named.lower())
    if not mentioned:
        raise KeywordError("Name an available table in your request.")
    table = min(mentioned)[1]
    columns = schema(table)["columns"]
    base, where_sql, order_sql, row_limit = read_clauses(question, columns)
    quoted_table = quote_identifier(table)

    join = re.search(r"\b(?:join|with)\s+", unquoted(base), re.IGNORECASE)
    if join:
        target_name = re.fullmatch(TABLE_NAME, base[join.end():].strip())
        if not target_name:
            raise KeywordError("Join one named table at a time, or use explicit SQL.")
        other = resolve_table(target_name[0], tables)
        if other == table:
            raise KeywordError("Self joins need explicit SQL aliases in the SQL workspace.")
        links = []
        for left, right in ((table, other), (other, table)):
            for key in schema(left).get("foreign_keys", []):
                if key["table"].lower() == right.lower() and key.get("single_column", True):
                    referenced = key.get("to")
                    if not referenced:
                        referenced = next((c["name"] for c in schema(right)["columns"] if c.get("primary_key")), None)
                    if referenced:
                        links.append((left, key["from"], right, referenced))
        if len(links) != 1:
            raise KeywordError("This join needs exactly one single-column foreign-key link; use explicit SQL otherwise.")
        if where_sql or order_sql:
            raise KeywordError("Use the SQL workspace for filtered or sorted joins.")
        left, source, right, target = links[0]
        projection = ", ".join(f"{quote_identifier(t)}.{quote_identifier(c['name'])} AS {quote_identifier(t + '.' + c['name'])}" for t in (table, other) for c in schema(t)["columns"])
        sql = f"SELECT {projection} FROM {quoted_table} JOIN {quote_identifier(other)} ON {quote_identifier(left)}.{quote_identifier(source)} = {quote_identifier(right)}.{quote_identifier(target)} LIMIT {row_limit}"
        return result_plan(sql, f"Join {table} and {other} using their foreign-key link.")

    if re.match(r"^(?:count|how\s+many|number\s+of\s+rows)\b", base, re.IGNORECASE):
        grouped = re.search(rf"\bby\s+({IDENTIFIER})\s*$", unquoted(base), re.IGNORECASE)
        if grouped:
            column = column_by_name(grouped[1], columns)
            label = quote_identifier(column["name"])
            return result_plan(f"SELECT {label} AS label, COUNT(*) AS value FROM {quoted_table}{where_sql} GROUP BY {label} ORDER BY value DESC LIMIT 20", f"Row count in {table}, grouped by {column['name']}.", "bar")
        return result_plan(f"SELECT COUNT(*) AS row_count FROM {quoted_table}{where_sql}", f"Row count for {table}.")

    group = re.search(rf"\bby\s+({IDENTIFIER})\b", unquoted(base), re.IGNORECASE)
    group_column = column_by_name(group[1], columns) if group and group[1].lower() not in {"month", "monthly"} else None
    measure_text = base[:group.start()] if group else base
    numeric = [column for column in columns if is_numeric(column) and (not group_column or column["name"] != group_column["name"])]
    explicit = [(match.start(), column) for column in numeric for match in [re.search(rf"\b{re.escape(column['name'])}\b", unquoted(measure_text), re.IGNORECASE)] if match]
    foreign_key_names = {key["from"].lower() for key in schema(table).get("foreign_keys", [])}
    non_id = [column for column in numeric if not column.get("primary_key")
              and not column["name"].lower().endswith("_id")
              and column["name"].lower() != "id"
              and column["name"].lower() not in foreign_key_names]
    value_column = min(explicit, key=lambda item: item[0])[1] if explicit else next(iter(non_id), None)
    function = "AVG" if re.match(r"^(?:average|avg)\b", base, re.IGNORECASE) else "MIN" if re.match(r"^(?:minimum|min)\b", base, re.IGNORECASE) else "MAX" if re.match(r"^(?:maximum|max)\b", base, re.IGNORECASE) else "SUM"
    analytic = bool(re.match(r"^(?:analyze|trend|compare|average|avg|sum|total|min|minimum|max|maximum|top|highest|lowest)\b", base, re.IGNORECASE))
    date = next((column for column in columns if is_date(column)), None)
    monthly = bool(re.search(r"\b(?:by\s+month|monthly|trend|over\s+time)\b", base, re.IGNORECASE)) or (base.lower().startswith("analyze ") and date is not None and not group_column)
    if analytic and monthly and value_column and date:
        sql = f"SELECT substr({quote_identifier(date['name'])}, 1, 7) AS period, {function}({quote_identifier(value_column['name'])}) AS total FROM {quoted_table}{where_sql} GROUP BY period ORDER BY period"
        return result_plan(sql, f"Monthly {function} of {value_column['name']} in {table}.", "line")
    if analytic and value_column:
        if not group_column and re.match(r"^(?:analyze|compare|top|highest|lowest)\b", base, re.IGNORECASE):
            group_column = next((c for c in columns if c["name"] != value_column["name"] and not is_numeric(c) and not c.get("primary_key")), None)
        if group_column:
            direction = "ASC" if base.lower().startswith("lowest") else "DESC"
            sql = f"SELECT {quote_identifier(group_column['name'])} AS label, {function}({quote_identifier(value_column['name'])}) AS value FROM {quoted_table}{where_sql} GROUP BY {quote_identifier(group_column['name'])} ORDER BY value {direction} LIMIT 20"
            return result_plan(sql, f"{function} of {value_column['name']} by {group_column['name']} in {table}.", "bar")
        return result_plan(f"SELECT {function}({quote_identifier(value_column['name'])}) AS result FROM {quoted_table}{where_sql}", f"{function} of {value_column['name']} in {table}.")
    if analytic and not base.lower().startswith("analyze"):
        raise KeywordError("Name a numeric column for this calculation.")

    projection = "*"
    selected = re.fullmatch(rf"(?:show|list|get)\s+(.+?)\s+(?:from|in)\s+({TABLE_NAME})", base, re.IGNORECASE)
    if selected and selected[1].lower() not in {"all", "data", "rows", "records", "*"}:
        resolve_table(selected[2], [table])
        names = [part.strip() for part in split_outside(selected[1], r",|\s+and\s+")]
        projection = ", ".join(quote_identifier(column_by_name(name, columns)["name"]) for name in names)
    return result_plan(f"SELECT {projection} FROM {quoted_table}{where_sql}{order_sql} LIMIT {row_limit}", f"Preview of {table}.")
