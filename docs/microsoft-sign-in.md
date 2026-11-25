# Microsoft sign-in is retired

Data Genie now uses optional [Google sign-in](google-sign-in.md) alongside email and password. The hosted app uses email and password or Google. Microsoft sign-in routes are retired. Existing accounts with a usable password can continue signing in with it.

The historical Terraform inputs and Key Vault `microsoft-secret` resource remain for state compatibility. They no longer configure runtime Microsoft sign-in. Removing that unused secret, its historical state, or an external Entra registration is a separate reviewed cleanup; do not delete Azure deployment identities or agent connections.
