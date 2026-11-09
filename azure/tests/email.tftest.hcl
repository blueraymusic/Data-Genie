# Every provider is mocked and every run is plan-only: no Azure access or writes.
mock_provider "azurerm" {}
mock_provider "azapi" {}
mock_provider "random" {}

run "email_is_disabled_by_default" {
  command = plan

  assert {
    condition = (
      !output.invitation_email_enabled && output.invitation_email_sender == "" &&
      length(azurerm_email_communication_service.invitations) == 0 &&
      length(azurerm_email_communication_service_domain.invitations) == 0 &&
      length(azurerm_communication_service.invitations) == 0 &&
      length(azurerm_communication_service_email_domain_association.invitations) == 0
    )
    error_message = "Email must not create any Communication resources unless explicitly enabled."
  }

  assert {
    condition = alltrue([
      for key in ["GENIE_EMAIL_CONNECTION_STRING", "GENIE_EMAIL_SENDER", "GENIE_EMAIL_REPLY_TO", "GENIE_EMAIL_DAILY_LIMIT"] :
      azurerm_linux_web_app.app.app_settings[key] == ""
    ])
    error_message = "Disabled email must leave all email app settings empty."
  }
}

run "enabled_email_preserves_hosting_and_sql_budget" {
  command = plan

  variables {
    invitation_email_enabled  = true
    invitation_email_reply_to = "support@example.test"
    app_service_sku           = "B1"
    location                  = "francecentral"
    public_url                = "https://data-genie.space"
  }

  assert {
    condition = (
      output.invitation_email_enabled &&
      length(azurerm_email_communication_service.invitations) == 1 &&
      length(azurerm_email_communication_service_domain.invitations) == 1 &&
      length(azurerm_communication_service.invitations) == 1 &&
      length(azurerm_communication_service_email_domain_association.invitations) == 1 &&
      azurerm_email_communication_service.invitations[0].resource_group_name == "data_genie" &&
      azurerm_communication_service.invitations[0].resource_group_name == "data_genie" &&
      azurerm_email_communication_service.invitations[0].data_location == "Europe" &&
      azurerm_communication_service.invitations[0].data_location == "Europe" &&
      azurerm_email_communication_service_domain.invitations[0].domain_management == "AzureManaged" &&
      !azurerm_email_communication_service_domain.invitations[0].user_engagement_tracking_enabled
    )
    error_message = "Enabled invitations must use one linked Azure-managed domain in the existing group and Europe geography, with tracking off."
  }

  assert {
    condition = (
      azurerm_linux_web_app.app.app_settings["GENIE_EMAIL_DAILY_LIMIT"] == "100" &&
      azurerm_linux_web_app.app.app_settings["GENIE_EMAIL_REPLY_TO"] == "support@example.test" &&
      azurerm_linux_web_app.app.app_settings["GENIE_PUBLIC_URL"] == "https://data-genie.space" &&
      azurerm_service_plan.hosting.sku_name == "B1" &&
      azurerm_service_plan.hosting.worker_count == 1 &&
      azapi_resource.free_state.body.properties.useFreeLimit &&
      azapi_resource.free_state.body.properties.freeLimitExhaustionBehavior == "AutoPause"
    )
    error_message = "Enabling email must retain the chosen single-instance host, canonical URL and SQL free-offer safeguards."
  }
}

run "reject_zero_daily_limit" {
  command = plan
  variables { invitation_email_daily_limit = 0 }
  expect_failures = [var.invitation_email_daily_limit]
}

run "reject_excess_daily_limit" {
  command = plan
  variables { invitation_email_daily_limit = 1001 }
  expect_failures = [var.invitation_email_daily_limit]
}

run "reject_fractional_daily_limit" {
  command = plan
  variables { invitation_email_daily_limit = 1.5 }
  expect_failures = [var.invitation_email_daily_limit]
}

run "reject_reply_header_injection" {
  command = plan
  variables { invitation_email_reply_to = "support@example.test\nBcc: another@example.test" }
  expect_failures = [var.invitation_email_reply_to]
}
