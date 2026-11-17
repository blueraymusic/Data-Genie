# Microsoft sign-in is retired

Data Genie now uses optional [Google sign-in](google-sign-in.md) alongside email and password. Microsoft signup, login, and account-linking buttons have been removed.

The historical Terraform inputs and Key Vault `microsoft-secret` resource remain for state compatibility. They no longer configure runtime Microsoft sign-in. Removing that unused secret, its historical state, or an external Entra registration is a separate reviewed cleanup; do not delete Azure deployment identities or agent connections.
