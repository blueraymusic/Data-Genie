output "app_url" {
  value = "https://${azurerm_linux_web_app.app.default_hostname}"
}

output "app_name" {
  value = azurerm_linux_web_app.app.name
}

output "resource_group_name" {
  value = data.azurerm_resource_group.existing.name
}
