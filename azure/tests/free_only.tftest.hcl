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
    condition     = azurerm_service_plan.free.sku_name == "F1"
    error_message = "The web app must never use a paid service-plan SKU."
  }
  assert {
    condition     = azapi_resource.free_state.body.properties.useFreeLimit == true && azapi_resource.free_state.body.properties.freeLimitExhaustionBehavior == "AutoPause"
    error_message = "SQL must opt into the free offer and stop at its limits."
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
