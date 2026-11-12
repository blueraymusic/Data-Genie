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

variable "microsoft_client_id" {
  type        = string
  default     = ""
  description = "Optional Microsoft sign-in application ID. This is separate from the Terraform and DevOps identities."
  validation {
    condition     = var.microsoft_client_id == "" || can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", var.microsoft_client_id))
    error_message = "Use the Microsoft sign-in application's UUID, or leave it empty to disable sign-in."
  }
}

variable "microsoft_client_secret" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Optional Microsoft sign-in client secret value. Supply through a sensitive workspace variable; it is stored in private Terraform state and Azure app settings."
}

variable "microsoft_tenant" {
  type        = string
  default     = "common"
  description = "common supports personal and work/school Microsoft accounts. Use a tenant UUID to restrict sign-in to one directory. Match the app registration's supported account types."
  validation {
    condition     = var.microsoft_tenant == "common" || can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", var.microsoft_tenant))
    error_message = "Use common or a Microsoft Entra tenant UUID."
  }
}

variable "microsoft_redirect_uri" {
  type        = string
  default     = ""
  description = "Exact registered Web callback on the hosted public origin, for example https://data-genie.space/api/auth/microsoft/callback. Leave empty when Microsoft sign-in is disabled."
  validation {
    condition     = var.microsoft_redirect_uri == "" || can(regex("^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?/api/auth/microsoft/callback$", var.microsoft_redirect_uri))
    error_message = "Use an HTTPS URL ending in /api/auth/microsoft/callback, without a query or fragment."
  }
}

variable "public_url" {
  type        = string
  default     = ""
  description = "Canonical HTTPS origin. Set only after its DNS, App Service hostname binding and managed certificate are working. Empty uses the Azure hostname."
  validation {
    condition     = var.public_url == "" || can(regex("^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.public_url))
    error_message = "Use an HTTPS origin without a path, port or trailing slash."
  }
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

variable "brevo_api_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Brevo transactional email key. Supply privately; the web app receives a Key Vault reference."
}
variable "brevo_sender_email" {
  type        = string
  default     = "no-reply@data-genie.space"
  description = "Verified Brevo sender for Blueray Inc. signup verification."
}
