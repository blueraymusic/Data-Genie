"""A single small worker keeps the student deployment's memory use bounded."""
import os

bind = "0.0.0.0:" + os.environ.get("PORT", "8000")
workers = 1
worker_class = "gthread"
threads = 4
timeout = 180
graceful_timeout = 180
accesslog = "-"
errorlog = "-"
# Do not trust forwarded headers from arbitrary clients.
forwarded_allow_ips = "127.0.0.1,::1"
