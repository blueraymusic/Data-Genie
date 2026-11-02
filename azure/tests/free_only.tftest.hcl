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
}

run "larger_paid_tier_rejected" {
  command = plan
  variables { app_service_sku = "P1v3" }
  expect_failures = [var.app_service_sku]
}
