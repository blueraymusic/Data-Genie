data "azurerm_resource_group" "existing" {
  name = var.resource_group_name
}

locals {
  location = var.location != "" ? var.location : data.azurerm_resource_group.existing.location
  tags     = { project = "Data-Genie", environment = "student", hosting_sku = var.app_service_sku }
}

resource "random_password" "sql" {
  length           = 32
  min_lower        = 2
  min_upper        = 2
  min_numeric      = 2
  min_special      = 2
  override_special = "!#$%&*+-=?_"
}

resource "random_password" "connection_key" {
  length  = 64
  special = true
}

moved {
  from = azurerm_service_plan.free
  to   = azurerm_service_plan.hosting
}

resource "azurerm_service_plan" "hosting" {
  # Keep the existing Azure name so selecting B1 upgrades this plan in place.
  name                = "${var.app_name}-free"
  resource_group_name = data.azurerm_resource_group.existing.name
  location            = local.location
  os_type             = "Linux"
  sku_name            = var.app_service_sku
  worker_count        = 1
  tags                = local.tags
}

resource "azurerm_mssql_server" "state" {
  name                          = var.sql_server_name != "" ? var.sql_server_name : "${var.app_name}-sql"
  resource_group_name           = data.azurerm_resource_group.existing.name
  location                      = local.location
  version                       = "12.0"
  administrator_login           = "genieadmin"
  administrator_login_password  = random_password.sql.result
  minimum_tls_version           = "1.2"
  public_network_access_enabled = true
  tags                          = local.tags
}

# Declare the selected billing model explicitly. Keep this historical resource
# address and prevent_destroy so opting into Basic updates the existing DB.
resource "azapi_resource" "free_state" {
  type      = "Microsoft.Sql/servers/databases@2023-08-01"
  name      = "data-genie-state"
  parent_id = azurerm_mssql_server.state.id
  location  = local.location
  tags      = local.tags
  body = {
    # Match ARM's canonical SKU name; the maximum vCore count is capacity.
    sku = merge({
      name     = var.sql_state_tier == "basic" ? "Basic" : "GP_S_Gen5"
      tier     = var.sql_state_tier == "basic" ? "Basic" : "GeneralPurpose"
      capacity = var.sql_state_tier == "basic" ? 5 : 2
    }, var.sql_state_tier == "free" ? { family = "Gen5" } : {})
    properties = merge({
      useFreeLimit                     = var.sql_state_tier == "free"
      maxSizeBytes                     = var.sql_state_tier == "basic" ? 2147483648 : 34359738368
      requestedBackupStorageRedundancy = "Local"
      zoneRedundant                    = false
      }, var.sql_state_tier == "free" ? { freeLimitExhaustionBehavior = "AutoPause" } : {},
    var.sql_state_tier == "free" ? { autoPauseDelay = 60, minCapacity = 0.5 } : {})
  }
  response_export_values = ["sku", "properties.maxSizeBytes", "properties.useFreeLimit", "properties.freeLimitExhaustionBehavior"]
  lifecycle {
    prevent_destroy = true
    postcondition {
      condition = var.sql_state_tier == "basic" ? (
        try(self.output.sku.name, "") == "Basic" && try(self.output.sku.capacity, 0) == 5 &&
        try(self.output.properties.maxSizeBytes, 0) == 2147483648
        ) : (
        try(self.output.properties.useFreeLimit, false) == true && try(self.output.properties.freeLimitExhaustionBehavior, "") == "AutoPause"
      )
      error_message = "Azure must confirm the selected free AutoPause or fixed Basic plan. No serverless overage fallback is allowed."
    }
  }
}

resource "azurerm_linux_web_app" "app" {
  name                = var.app_name
  resource_group_name = data.azurerm_resource_group.existing.name
  location            = local.location
  service_plan_id     = azurerm_service_plan.hosting.id
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.runtime.id]
  }
  key_vault_reference_identity_id                = azurerm_user_assigned_identity.runtime.id
  depends_on                                     = [azurerm_key_vault_access_policy.web_app]
  https_only                                     = true
  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false
  site_config {
    always_on           = var.app_service_sku == "B1"
    ftps_state          = "Disabled"
    minimum_tls_version = "1.2"
    app_command_line    = "python -m gunicorn -c azure/gunicorn.conf.py backend.wsgi:application"
    application_stack { python_version = "3.12" }
  }
  app_settings = {
    SCM_DO_BUILD_DURING_DEPLOYMENT = "true"
    GENIE_CLOUD_STATE              = "azure_sql"
    GENIE_DATA_DIR                 = "/tmp/data-genie"
    GENIE_CONNECTION_KEY           = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.app["connection-key"].versionless_id})"
    GENIE_SQL_HOST                 = azurerm_mssql_server.state.fully_qualified_domain_name
    GENIE_SQL_DATABASE             = azapi_resource.free_state.name
    GENIE_SQL_USER                 = azurerm_mssql_server.state.administrator_login
    GENIE_SQL_PASSWORD             = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.app["sql-password"].versionless_id})"
    GEMINI_API_KEY                 = var.gemini_api_key != "" ? "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.app["ai-key"].versionless_id})" : ""
    GEMINI_MODEL                   = var.gemini_model
    GENIE_PUBLIC_URL               = var.public_url
    GENIE_GOOGLE_CLIENT_ID         = var.google_client_id
    GENIE_GOOGLE_CLIENT_SECRET     = var.google_client_secret != "" ? "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.app["google-secret"].versionless_id})" : ""
    GENIE_GOOGLE_REDIRECT_URI      = var.google_redirect_uri
    BREVO_API_KEY                  = var.brevo_api_key != "" ? "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.app["brevo-key"].versionless_id})" : ""
    BREVO_SENDER_EMAIL             = var.brevo_sender_email
  }
  tags = local.tags
}

# SQL starts with no public firewall rules. The deployment script reads the web
# app's current egress IPs after creation and permits only those IPs.
# They are unknown during the first plan, so a Terraform for_each cannot use them.
