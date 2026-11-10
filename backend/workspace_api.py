"""HTTP workspace endpoints; all mutations use WorkspaceStore's live owner checks."""

import re

from . import workbench
from .workspaces import WorkspaceStore, AUTHORIZATION_LOCK


def store():
    return WorkspaceStore(workbench.get_repository())


def owned_workspace(account_id, workspace_id=None):
    service = store()
    workspace = (service.get_workspace(account_id, workspace_id)["workspace"] if workspace_id is not None
                 else service.ensure_personal(account_id))
    if workspace["role"] != "owner":
        raise PermissionError("Only the workspace owner can add or connect databases.")
    return workspace["workspace_id"]


def attach_session(account_id, workspace_id, result):
    store().attach_database(account_id, workspace_id, result["database_id"])
    with workbench.session_scope(result["session_id"]):
        return workbench.database_info()


def get(handler, path, user):
    account_id = user["account_id"]
    if path == "/api/workspaces":
        handler.json(store().list_workspaces(account_id))
        return True
    match = re.fullmatch(r"/api/workspaces/([A-Za-z0-9-]+)", path)
    if match:
        handler.json(store().get_workspace(account_id, match[1]))
        return True
    return False


def post(handler, path, user):
    if not (path == "/api/workspaces" or path.startswith("/api/workspaces/")):
        return False
    payload = handler.read_json(32 * 1024)
    account_id = user["account_id"]
    service = store()
    if path == "/api/workspaces":
        handler.json(service.create_workspace(account_id, payload.get("name")), 201)
        return True
    if path == "/api/workspaces/invitations/accept":
        handler.json(service.accept_invitation(account_id, payload.get("invitation_id"), payload.get("token")))
        return True
    match = re.fullmatch(r"/api/workspaces/([A-Za-z0-9-]+)/(invite|members|remove|grants|invitations/revoke|open|attach|delete)", path)
    if not match:
        handler.json({"error": "Not found."}, 404)
        return True
    workspace_id, action = match.groups()
    if action == "invite":
        handler.json(service.invite(account_id, workspace_id, payload.get("email"), payload.get("role", "member")), 201)
    elif action == "delete":
        handler.json(service.delete_workspace(account_id, workspace_id, payload.get("name")))
    elif action == "members":
        handler.json(service.set_member_role(account_id, workspace_id, payload.get("account_id"), payload.get("role")))
    elif action == "remove":
        handler.json(service.remove_member(account_id, workspace_id, payload.get("account_id")))
    elif action == "grants":
        handler.json(service.set_grant(account_id, workspace_id, payload.get("account_id"), payload.get("database_id"), payload.get("permissions")))
    elif action == "invitations/revoke":
        handler.json(service.revoke_invitation(account_id, workspace_id, payload.get("invitation_id")))
    elif action == "attach":
        handler.json(service.attach_database(account_id, workspace_id, payload.get("database_id")))
    elif action == "open":
        with AUTHORIZATION_LOCK:
            current = handler.owned_session(handler.headers["X-Session-ID"], user, check_access=False) if handler.headers.get("X-Session-ID") else None
            session = service.open_database(account_id, workspace_id, payload.get("database_id"))
            try:
                with workbench.session_scope(session["session_id"]):
                    workbench._sync(session)
                    result = workbench.database_info()
            except Exception:
                workbench.get_repository().end_session(session["session_id"])
                raise
        if current and current["session_id"] != session["session_id"]:
            workbench.end_session(current["session_id"])
        handler.json(result)
    return True
