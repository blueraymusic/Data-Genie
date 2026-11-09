output "app_url" {
  value = var.public_url != "" ? var.public_url : "https://${azurerm_linux_web_app.app.default_hostname}"
}

output "app_name" {
  value = azurerm_linux_web_app.app.name
}

output "resource_group_name" {
  value = data.azurerm_resource_group.existing.name
}

output "sql_server_name" {
  value = azurerm_mssql_server.state.name
}

output "app_service_sku" {
  value = azurerm_service_plan.hosting.sku_name
}

output "invitation_email_enabled" {
  value = var.invitation_email_enabled
}

output "invitation_email_sender" {
  value = local.invitation_email_sender
}
