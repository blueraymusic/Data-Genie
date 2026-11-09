# Optional invitation email. These Communication resources are global; their
# data-at-rest geography is Europe to match the France Central deployment.
resource "azurerm_email_communication_service" "invitations" {
  count = var.invitation_email_enabled ? 1 : 0

  name                = "${var.app_name}-email"
  resource_group_name = data.azurerm_resource_group.existing.name
  data_location       = "Europe"
  tags                = local.tags
}

resource "azurerm_email_communication_service_domain" "invitations" {
  count = var.invitation_email_enabled ? 1 : 0

  name                             = "AzureManagedDomain"
  email_service_id                 = azurerm_email_communication_service.invitations[0].id
  domain_management                = "AzureManaged"
  user_engagement_tracking_enabled = false
  tags                             = local.tags
}

resource "azurerm_communication_service" "invitations" {
  count = var.invitation_email_enabled ? 1 : 0

  name                = "${var.app_name}-mail"
  resource_group_name = data.azurerm_resource_group.existing.name
  data_location       = "Europe"
  tags                = local.tags
}

resource "azurerm_communication_service_email_domain_association" "invitations" {
  count = var.invitation_email_enabled ? 1 : 0

  communication_service_id = azurerm_communication_service.invitations[0].id
  email_service_domain_id  = azurerm_email_communication_service_domain.invitations[0].id
}

locals {
  invitation_email_sender = var.invitation_email_enabled ? "DoNotReply@${azurerm_email_communication_service_domain.invitations[0].mail_from_sender_domain}" : ""
}
