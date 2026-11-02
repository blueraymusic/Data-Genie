variable "resource_group_name" {
  type        = string
  default     = "data_genie"
  description = "Existing resource group; Terraform does not own or destroy it."
}

variable "app_name" {
  type        = string
  default     = "data-genie-blueray321"
  description = "Globally unique Azure web-app name."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,49}$", var.app_name))
    error_message = "Use a lowercase Azure name, 3–50 characters, starting with a letter."
  }
}

variable "location" {
  type        = string
  default     = ""
  description = "Optional region override when the selected hosting tier or SQL free offer is unavailable in the group's region. Never upgrades the SKU."
}

variable "app_service_sku" {
  type        = string
  default     = "F1"
  description = "F1 is free. Select Linux B1 explicitly to use student credit; one instance only. SQL retains its free-offer safeguards."
  validation {
    condition     = contains(["F1", "B1"], var.app_service_sku)
    error_message = "Only F1 or the explicitly budgeted Linux B1 hosting tier is allowed."
  }
}

variable "sql_server_name" {
  type        = string
  default     = ""
  description = "Optional globally unique SQL server name, for example when a failed regional deployment reserved the original name."
  validation {
    condition     = var.sql_server_name == "" || can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.sql_server_name))
    error_message = "Use 3–63 lowercase letters, numbers or hyphens, without a leading or trailing hyphen."
  }
}

variable "gemini_api_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Optional. Leave empty for Keywords mode and no AI-provider charges."
}

variable "gemini_model" {
  type    = string
  default = "gemini-3.5-flash-lite"
}

# HCP Terraform injects this object when dynamic Azure credentials are enabled.
# Do not add its file paths as workspace variables or copy tokens into the repo.
variable "tfc_azure_dynamic_credentials" {
  type = object({
    default = object({ client_id_file_path = string, oidc_token_file_path = string })
    aliases = map(object({ client_id_file_path = string, oidc_token_file_path = string }))
  })
  default   = null
  sensitive = true
}
