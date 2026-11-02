data "azurerm_resource_group" "existing" {
  name = var.resource_group_name
}

locals {
  location = var.location != "" ? var.location : data.azurerm_resource_group.existing.location
  tags     = { project = "Data-Genie", environment = "student-free" }
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

resource "azurerm_service_plan" "free" {
  name                = "${var.app_name}-free"
  resource_group_name = data.azurerm_resource_group.existing.name
  location            = local.location
  os_type             = "Linux"
  sku_name            = "F1"
  tags                = local.tags
}

resource "azurerm_mssql_server" "state" {
  name                          = "${var.app_name}-sql"
  resource_group_name           = data.azurerm_resource_group.existing.name
  location                      = local.location
  version                       = "12.0"
  administrator_login           = "genieadmin"
  administrator_login_password  = random_password.sql.result
  minimum_tls_version           = "1.2"
  public_network_access_enabled = true
  tags                          = local.tags
}

# The AzureRM database resource does not expose the free-offer safeguards.
# Use the ARM API explicitly; omitting useFreeLimit would create a paid DB.
resource "azapi_resource" "free_state" {
  type      = "Microsoft.Sql/servers/databases@2023-08-01"
  name      = "data-genie-state"
  parent_id = azurerm_mssql_server.state.id
  location  = local.location
  tags      = local.tags
  body = {
    sku = { name = "GP_S_Gen5_2", tier = "GeneralPurpose", family = "Gen5", capacity = 2 }
    properties = {
      useFreeLimit                     = true
      freeLimitExhaustionBehavior      = "AutoPause"
      autoPauseDelay                   = 60
      minCapacity                      = 0.5
      maxSizeBytes                     = 34359738368
      requestedBackupStorageRedundancy = "Local"
      zoneRedundant                    = false
    }
  }
  response_export_values = ["properties.useFreeLimit", "properties.freeLimitExhaustionBehavior"]
  lifecycle {
    prevent_destroy = true
    postcondition {
      condition     = self.output.properties.useFreeLimit == true && self.output.properties.freeLimitExhaustionBehavior == "AutoPause"
      error_message = "Azure must confirm the free offer and AutoPause. No paid fallback is allowed."
    }
  }
}

resource "azurerm_linux_web_app" "app" {
  name                                           = var.app_name
  resource_group_name                            = data.azurerm_resource_group.existing.name
  location                                       = local.location
  service_plan_id                                = azurerm_service_plan.free.id
  https_only                                     = true
  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false
  site_config {
    always_on           = false
    ftps_state          = "Disabled"
    minimum_tls_version = "1.2"
    app_command_line    = "python -m gunicorn -c azure/gunicorn.conf.py backend.wsgi:application"
    application_stack { python_version = "3.12" }
  }
  app_settings = {
    SCM_DO_BUILD_DURING_DEPLOYMENT = "true"
    GENIE_CLOUD_STATE              = "azure_sql"
    GENIE_DATA_DIR                 = "/tmp/data-genie"
    GENIE_CONNECTION_KEY           = replace(replace(base64sha256(random_password.connection_key.result), "+", "-"), "/", "_")
    GENIE_SQL_HOST                 = azurerm_mssql_server.state.fully_qualified_domain_name
    GENIE_SQL_DATABASE             = azapi_resource.free_state.name
    GENIE_SQL_USER                 = azurerm_mssql_server.state.administrator_login
    GENIE_SQL_PASSWORD             = random_password.sql.result
    GEMINI_API_KEY                 = var.gemini_api_key
    GEMINI_MODEL                   = var.gemini_model
  }
  tags = local.tags
}

# SQL starts with no public firewall rules. The deployment script reads the web
# app's actual possible egress IPs after creation and permits only those IPs.
# They are unknown during the first plan, so a Terraform for_each cannot use them.
