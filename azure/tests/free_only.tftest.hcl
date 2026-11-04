mock_provider "azurerm" {
  mock_data "azurerm_resource_group" {
    defaults = {
      name     = "data_genie"
      location = "eastus2"
      id       = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/data_genie"
    }
  }
  mock_resource "azurerm_service_plan" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/data_genie/providers/Microsoft.Web/serverFarms/test" }
  }
  mock_resource "azurerm_mssql_server" {
    defaults = {
      id                          = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/data_genie/providers/Microsoft.Sql/servers/test"
      fully_qualified_domain_name = "test.database.windows.net"
    }
  }
}

mock_provider "azapi" {
  mock_resource "azapi_resource" {
    defaults = {
      output = { properties = { useFreeLimit = true, freeLimitExhaustionBehavior = "AutoPause" } }
    }
  }
}

mock_provider "random" {}

run "free_only_plan" {
  command = plan
  assert {
    condition     = azurerm_service_plan.hosting.sku_name == "F1"
    error_message = "The default hosting tier must remain free."
  }
  assert {
    condition     = azapi_resource.free_state.body.properties.useFreeLimit == true && azapi_resource.free_state.body.properties.freeLimitExhaustionBehavior == "AutoPause"
    error_message = "SQL must opt into the free offer and stop at its limits."
  }
  assert {
    condition     = azapi_resource.free_state.body.sku.name == "GP_S_Gen5" && azapi_resource.free_state.body.sku.tier == "GeneralPurpose" && azapi_resource.free_state.body.sku.family == "Gen5" && azapi_resource.free_state.body.sku.capacity == 2
    error_message = "SQL must use the canonical serverless SKU with a separate two-vCore maximum."
  }
  assert {
    condition     = azurerm_linux_web_app.app.site_config[0].always_on == false
    error_message = "Always On is unavailable in F1 and must stay disabled."
  }
}

run "invalid_azure_name" {
  command = plan
  variables { app_name = "Invalid Name" }
  expect_failures = [var.app_name]
}

run "custom_sql_server" {
  command = plan
  variables { sql_server_name = "genie-custom-state-sql" }
  assert {
    condition     = azurerm_mssql_server.state.name == "genie-custom-state-sql"
    error_message = "A reserved SQL server name must be replaceable without renaming the web app."
  }
}

run "invalid_sql_server_name" {
  command = plan
  variables { sql_server_name = "Invalid/Server" }
  expect_failures = [var.sql_server_name]
}

run "budgeted_student_credit_hosting" {
  command = plan
  variables { app_service_sku = "B1" }
  assert {
    condition     = azurerm_service_plan.hosting.sku_name == "B1" && azurerm_service_plan.hosting.os_type == "Linux" && azurerm_service_plan.hosting.worker_count == 1
    error_message = "The credit option must stay on a single Linux B1 instance."
  }
  assert {
    condition     = azapi_resource.free_state.body.properties.useFreeLimit == true && azapi_resource.free_state.body.properties.freeLimitExhaustionBehavior == "AutoPause"
    error_message = "Using credit for hosting must not enable SQL overages."
  }
  assert {
    condition     = azurerm_linux_web_app.app.site_config[0].always_on == true
    error_message = "B1 should keep the app warm using its included Always On capability."
  }
}

run "larger_paid_tier_rejected" {
  command = plan
  variables { app_service_sku = "P1v3" }
  expect_failures = [var.app_service_sku]
}

run "custom_https_origin" {
  command = plan
  variables { public_url = "https://data-genie.space" }
  assert {
    condition     = azurerm_linux_web_app.app.app_settings["GENIE_PUBLIC_URL"] == "https://data-genie.space"
    error_message = "The canonical origin must survive subsequent infrastructure applies."
  }
}

run "invalid_public_origin" {
  command = plan
  variables { public_url = "http://data-genie.space/path" }
  expect_failures = [var.public_url]
}

run "microsoft_sign_in_settings" {
  command = plan
  variables {
    public_url             = "https://data-genie.space"
    microsoft_client_id    = "00000000-0000-0000-0000-000000000002"
    microsoft_redirect_uri = "https://data-genie.space/api/auth/microsoft/callback"
  }
  assert {
    condition     = azurerm_linux_web_app.app.app_settings["GENIE_MICROSOFT_CLIENT_ID"] == var.microsoft_client_id && azurerm_linux_web_app.app.app_settings["GENIE_MICROSOFT_TENANT"] == "common" && azurerm_linux_web_app.app.app_settings["GENIE_MICROSOFT_REDIRECT_URI"] == var.microsoft_redirect_uri
    error_message = "Reviewed Microsoft sign-in settings must survive infrastructure applies."
  }
}

run "invalid_microsoft_tenant" {
  command = plan
  variables { microsoft_tenant = "https://untrusted.example/tenant" }
  expect_failures = [var.microsoft_tenant]
}

run "invalid_microsoft_callback" {
  command = plan
  variables { microsoft_redirect_uri = "http://data-genie.space/api/auth/microsoft/callback" }
  expect_failures = [var.microsoft_redirect_uri]
}
