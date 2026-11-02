terraform {
  required_version = ">= 1.9, < 2.0"

  cloud {
    organization = "blueray321"
    workspaces { name = "Data-Genie" }
  }

  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
    azapi   = { source = "Azure/azapi", version = "~> 2.0" }
    random  = { source = "hashicorp/random", version = "~> 3.0" }
  }
}

provider "azurerm" {
  features {}
  use_oidc             = var.tfc_azure_dynamic_credentials != null ? true : null
  client_id_file_path  = try(var.tfc_azure_dynamic_credentials.default.client_id_file_path, null)
  oidc_token_file_path = try(var.tfc_azure_dynamic_credentials.default.oidc_token_file_path, null)
  # The existing student subscription must have Microsoft.Web and Microsoft.Sql
  # registered by its owner. This principal needs only resource-group access.
  resource_provider_registrations = "none"
}

provider "azapi" {
  use_oidc             = var.tfc_azure_dynamic_credentials != null ? true : null
  client_id            = var.tfc_azure_dynamic_credentials == null ? null : trimspace(file(var.tfc_azure_dynamic_credentials.default.client_id_file_path))
  oidc_token_file_path = try(var.tfc_azure_dynamic_credentials.default.oidc_token_file_path, null)
}
