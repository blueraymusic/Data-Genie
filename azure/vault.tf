# Keep the existing generated SQL password and connection encryption key unchanged.
# Azure resolves references using this application's own managed identity.
data "azurerm_client_config" "current" {}

resource "azurerm_user_assigned_identity" "runtime" {
  name                = "data-genie-runtime"
  location            = local.location
  resource_group_name = data.azurerm_resource_group.existing.name
  tags                = local.tags
}

resource "azurerm_key_vault" "app" {
  name                       = "dg-${substr(sha256(var.app_name), 0, 18)}"
  location                   = local.location
  resource_group_name        = data.azurerm_resource_group.existing.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = false
  soft_delete_retention_days = 7
  purge_protection_enabled   = true
  tags                       = local.tags
  lifecycle { prevent_destroy = true }
}

resource "azurerm_key_vault_access_policy" "terraform" {
  key_vault_id       = azurerm_key_vault.app.id
  tenant_id          = data.azurerm_client_config.current.tenant_id
  object_id          = data.azurerm_client_config.current.object_id
  secret_permissions = ["Get", "List", "Set", "Delete", "Recover"]
}

locals {
  vault_values = {
    sql-password     = random_password.sql.result
    connection-key   = replace(replace(base64sha256(random_password.connection_key.result), "+", "-"), "/", "_")
    ai-key           = var.gemini_api_key != "" ? var.gemini_api_key : "disabled"
    microsoft-secret = var.microsoft_client_secret != "" ? var.microsoft_client_secret : "disabled"
    brevo-key        = var.brevo_api_key != "" ? var.brevo_api_key : "disabled"
  }
}

resource "azurerm_key_vault_secret" "app" {
  for_each     = toset(["sql-password", "connection-key", "ai-key", "microsoft-secret", "brevo-key"])
  name         = each.key
  value        = local.vault_values[each.key]
  key_vault_id = azurerm_key_vault.app.id
  depends_on   = [azurerm_key_vault_access_policy.terraform]
}

resource "azurerm_key_vault_access_policy" "web_app" {
  key_vault_id       = azurerm_key_vault.app.id
  tenant_id          = data.azurerm_client_config.current.tenant_id
  object_id          = azurerm_user_assigned_identity.runtime.principal_id
  secret_permissions = ["Get"]
}
