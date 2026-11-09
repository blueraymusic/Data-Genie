"""HTTP workspace endpoints; all mutations use WorkspaceStore's live owner checks."""

import re
from contextlib import contextmanager
from urllib.parse import urlencode

from . import cloud_state, email_delivery, settings, workbench
from .workspaces import WorkspaceStore, AUTHORIZATION_LOCK


def store():
    return WorkspaceStore(workbench.get_repository())


def invitation_route(path):
    return re.fullmatch(r"/api/workspaces/([A-Za-z0-9-]+)/invite", path)


@contextmanager
def durable():
    """Persist short state changes without holding the cloud lock while sending."""
    if settings.value("GENIE_CLOUD_STATE") == "azure_sql":
        failure = None
        with cloud_state.transaction():
            try:
                yield
            except (ValueError, PermissionError) as error:
                failure = error
        if failure:
            raise failure
    else:
        yield


def invite(handler, path):
    match = invitation_route(path)
    if not match:
        return False
    with durable():
        user = handler.account()
        handler.require_csrf()
        payload = handler.read_json(32 * 1024)
        invitation = store().invite(user["account_id"], match[1], payload.get("email"), payload.get("role", "member"))
        origin = settings.public_url() or "http://" + handler.headers["Host"]
        url = origin + "/workspaces?" + urlencode({"invite": invitation["invitation_id"], "token": invitation["token"]})
        retry_after = None
        enabled = email_delivery.public_settings()["enabled"]
        if enabled:
            try:
                email_delivery.reserve_attempt(workbench.get_repository(), user["account_id"], invitation["email"], invitation["invitation_id"])
            except email_delivery.EmailRateLimited as error:
                retry_after = error.retry_after
        # Commit the invitation and any spent allowance before contacting Azure.
    if enabled and retry_after is None:
        display_name = " ".join(filter(None, (user.get("first_name"), user.get("last_name"))))
        result = email_delivery.send_invitation(invitation, display_name, url)
    else:
        result = {"email_status": "failed" if retry_after else "not_configured"}
    try:
        with durable():
            email_delivery.record_result(workbench.get_repository(), invitation["invitation_id"], result)
            public = email_delivery.invitation_status(workbench.get_repository(), invitation["invitation_id"])
    except cloud_state.StateUnavailable:
        raise cloud_state.StateUnavailable(
            "Your invitation was created, but its email status could not be saved. Check Teams and with the recipient before sending another invitation.",
            retry_safe=False) from None
    if retry_after:
        public.update(email_message="Email send limit reached. Copy the private link, or wait before sending another invitation.",
                      retry_after=retry_after)
    handler.json({**invitation, "invitation_url": url, **public}, 201)
    return True


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
        detail = store().get_workspace(account_id, match[1])
        detail["email"] = email_delivery.public_settings()
        if detail["workspace"]["role"] == "owner":
            statuses = email_delivery.workspace_statuses(workbench.get_repository(), match[1])
            detail["invitations"] = [{**invitation, **statuses.get(invitation["invitation_id"],
                {"email_status": "not_configured"})} for invitation in detail["invitations"]]
        handler.json(detail)
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
    match = re.fullmatch(r"/api/workspaces/([A-Za-z0-9-]+)/(invite|members|remove|grants|invitations/revoke|open|attach)", path)
    if not match:
        handler.json({"error": "Not found."}, 404)
        return True
    workspace_id, action = match.groups()
    if action == "invite":
        raise ValueError("Use the invitation handler.")
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
