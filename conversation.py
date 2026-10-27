"""Small read-only follow-ups for Keywords mode; Gemini handles wider dialogue."""

import re

import keywords
from request_validation import RequestClarification
from sql_tools import quote_identifier, tokens


def previous_read(turns):
    for turn in reversed(turns):
        for command in reversed(turn["commands"]):
            if command["status"] == "executed":
                return (turn, command) if command["operation"] == "SELECT" else None
    return None


def latest_executed(turns):
    for turn in reversed(turns):
        for command in reversed(turn["commands"]):
            if command["status"] == "executed":
                return turn, command
    return None


def pending_task(turns):
    """Keep the user's original request distinct from an assistant's assumptions."""
    candidates = []
    for turn in reversed(turns):
        if turn.get("commands"):
            break
        if turn.get("task") and len(re.findall(r"\w+", turn["task"])) >= 2:
            return turn["task"]
        question = turn.get("question", "")
        if len(re.findall(r"\w+", question)) >= 2:
            candidates.append(question)
    return candidates[-1][:1500] if candidates else ""


def query_scope(sql, question):
    """Remove an automatic preview cap, but keep limits the user requested."""
    if re.search(r"\b(?:limit|first|top|last|highest|lowest)\b|\b(?:show|list|display|give)(?: me)?(?: only)? (?:50|fifty)\b", question, re.IGNORECASE):
        return sql
    parts, depth = tokens(sql), 0
    for index, (kind, value, start, _) in enumerate(parts):
        if kind == "symbol":
            depth += (value == "(") - (value == ")")
        if depth == 0 and kind == "word" and value.lower() == "limit":
            if index == len(parts) - 2 and parts[index + 1][1] == "50":
                return sql[:start].rstrip()
    return sql


def describe_read(sql, tables, question=""):
    """Describe actual query context; ignore quoted text that merely says WHERE."""
    parts = tokens(sql)
    filters = []
    in_filter = False
    for index, (kind, value, _, _) in enumerate(parts):
        if kind == "word" and value.lower() == "where":
            in_filter = True
        elif kind == "word" and value.lower() in {"group", "order", "limit", "union"}:
            in_filter = False
        if not in_filter or kind not in {"word", "identifier"}:
            continue
        if index and parts[index - 1][1].lower() == "collate":
            continue
        tail = index + 1
        if tail + 1 < len(parts) and parts[tail][1].lower() == "collate":
            tail += 2
        if tail + 1 >= len(parts) or parts[tail][1] != "=":
            continue
        literal = parts[tail + 1]
        if literal[0] not in {"string", "number"}:
            continue
        name = value.strip('"`[]').replace('""', '"').replace('_', ' ')
        content = literal[1][1:-1].replace("''", "'") if literal[0] == "string" else literal[1]
        label = f"{name}: {content}"
        if label not in filters:
            filters.append(label[:100])
    return {"tables": list(tables), "filters": filters[:4], "request": question[:200]}


def conversation_context(turns):
    previous = latest_executed(turns)
    if not previous:
        return None
    turn, command = previous
    if command["operation"] == "SELECT":
        return describe_read(command["sql"], command["tables"], turn["question"])
    if command["operation"] == "DROP":
        return None
    targets = [target["table_name"] for target in command.get("targets", []) if target["access_type"] in {"write", "define"}]
    return {"tables": targets or command["tables"], "filters": [], "request": turn["question"]}


def followup_plan(question, turns, selected_table, columns_for_query):
    text = question.strip().rstrip("?.!")
    location = re.fullmatch(
        r"(?:which (?:ones|of them|of these)|show (?:me )?(?:those|the ones)) "
        r"(?:(?:are|that are) )?(?:in|from) (.+)", text, re.IGNORECASE
    )
    count = re.fullmatch(r"(?:how many(?: (?:are there|of them|of those|of these))?|count (?:them|those|these))", text, re.IGNORECASE)
    order = re.fullmatch(r"(?:sort|order)(?: (?:them|those|these))? by (\w+)(?: (asc|desc|ascending|descending))?", text, re.IGNORECASE)
    projection = re.fullmatch(r"(?:show|only show)(?: me)? (?:only |just )?(?:their |the )?(names?)(?: only)?", text, re.IGNORECASE)
    if not any((location, count, order, projection)):
        return None
    previous = previous_read(turns)
    if previous:
        turn, command = previous
        if selected_table and selected_table not in command["tables"]:
            raise RequestClarification("The selected table changed. Name the table you want to follow up on, or start a new question.")
        source = query_scope(command["sql"], turn["question"])
    elif selected_table and not any(turn["commands"] for turn in turns):
        source = "SELECT * FROM " + quote_identifier(selected_table)
    else:
        raise RequestClarification("Start by asking for the rows you want to work with, then follow up on that result.")
    columns = columns_for_query(source)
    wrapped = f"({source}) AS previous_result"
    if count:
        return keywords.result_plan(f"SELECT COUNT(*) AS row_count FROM {wrapped}", "Count of the rows from your previous query.")
    if location:
        locations = [name for name in columns if name.lower() in {"state", "city", "country", "region", "province", "location"}]
        if len(locations) != 1:
            raise RequestClarification("Name the location column you want to filter, such as state or city. Gemini can handle more detailed follow-ups.")
        value = keywords.literal(location[1])
        return keywords.result_plan(f"SELECT * FROM {wrapped} WHERE {quote_identifier(locations[0])} COLLATE NOCASE = {value} LIMIT 50", "Filter your previous query by " + locations[0] + ".")
    requested = order[1] if order else "name"
    column = next((name for name in columns if name.lower() == requested.lower()), None)
    if not column:
        raise RequestClarification(f"The previous query did not return a {requested} column. Ask for that column or use Gemini for a broader follow-up.")
    if order:
        direction = "DESC" if (order[2] or "").lower() in {"desc", "descending"} else "ASC"
        return keywords.result_plan(f"SELECT * FROM {wrapped} ORDER BY {quote_identifier(column)} {direction} LIMIT 50", "Sort the rows from your previous query.")
    return keywords.result_plan(f"SELECT {quote_identifier(column)} FROM {wrapped} LIMIT 50", "Names from your previous query.")
