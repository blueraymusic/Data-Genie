"""Resolve everyday read requests using the table the user selected."""

import re

import keywords
from request_validation import RequestClarification
from sql_tools import quote_identifier


def contextual_read(question, tables, schema, selected_table=None):
    text = re.sub(r"\s+", " ", question.lower().strip()).rstrip("?.!")
    preview = re.fullmatch(
        r"(?:show|display|preview|list)(?: me)?(?: all)?(?: the| my)? (?:data|rows|records)", text
    )
    chart = re.fullmatch(
        r"(?:(?:let's|lets|please|can you) )?(?:visualize|visualise|visulize|chart|graph|plot)"
        r"(?: me)?(?: the| my)? (?:data|rows|records)", text
    )
    if not (preview or chart):
        return None
    if not tables:
        raise RequestClarification("This database has no tables yet. Create a table or connect a database before asking about its data.")
    table = selected_table or (tables[0] if len(tables) == 1 else None)
    if not table:
        raise RequestClarification(
            "Which table would you like to explore?",
            [f"show {quote_identifier(name)}" for name in tables[:6]],
        )
    if preview:
        return keywords.result_plan(f"SELECT * FROM {quote_identifier(table)} LIMIT 50", f"Preview of the selected table, {table}.")
    columns = schema(table)["columns"]
    categories = [column for column in columns if not column.get("primary_key")
                  and not keywords.is_numeric(column) and not keywords.is_date(column)
                  and re.fullmatch(keywords.IDENTIFIER, column["name"])
                  and "email" not in column["name"].lower()]
    categories.sort(key=lambda column: column["name"].lower() not in {"category", "state", "status", "type", "country", "city"})
    suggestions = [f"count {quote_identifier(table)} by {column['name']}" for column in categories[:2]]
    measures = [column for column in columns if keywords.is_numeric(column)
                and not column.get("primary_key") and not column["name"].lower().endswith("_id")
                and column["name"].lower() != "id"
                and re.fullmatch(keywords.IDENTIFIER, column["name"])]
    if measures and any(keywords.is_date(column) for column in columns):
        suggestions = [f"total {measures[0]['name']} in {quote_identifier(table)} by month"] + suggestions
    raise RequestClarification(
        f"What would you like to chart in {table}? Choose a grouping or measure, or preview the rows.",
        suggestions[:2] + [f"show {quote_identifier(table)}"],
    )


def recovery_choices(tables, selected_table=None, suggestions=None):
    suggestions = suggestions or ([f"show {quote_identifier(name)}" for name in tables[:6]] if not selected_table else [
        f"show {quote_identifier(selected_table)}", f"count {quote_identifier(selected_table)}",
        f"show columns from {quote_identifier(selected_table)}",
    ])
    if not tables:
        suggestions = ["create a table notes with a body"]
    choices = []
    for request in suggestions:
        label = request
        for name in tables:
            if request == f"show {quote_identifier(name)}":
                label = "Preview rows" if selected_table == name else name
            elif request == f"count {quote_identifier(name)}":
                label = "Count rows"
            elif request == f"show columns from {quote_identifier(name)}":
                label = "View columns"
        if request == "create a table notes with a body":
            label = "Create a first table"
        choices.append({"label": label, "request": request})
    return choices
