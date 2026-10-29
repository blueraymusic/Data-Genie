"""Connection failures with safe messages and explicit recovery actions."""


class ConnectionFailure(ValueError):
    def __init__(self, message, code, recovery="retry", status=503):
        super().__init__(message)
        self.code = code
        self.recovery = recovery
        self.status = status

    def payload(self):
        return {"error": str(self), "code": self.code, "recovery": self.recovery}


def missing_postgres_support():
    return ConnectionFailure(
        "This server's Python is missing PostgreSQL support. Restart Data Genie with npm start "
        "to use its project environment, or install requirements-postgres.txt in this Python environment.",
        "postgres_support_missing", "restart_server",
    )
