// Input variables for The Forge GCP Backbone

variable "gcp_project_id" {
  description = "The GCP project ID to deploy resources into."
  type        = string
  // default     = "your-gcp-project-id" // Or set via environment variable TF_VAR_gcp_project_id
}

variable "gcp_region" {
  description = "The GCP region for deploying resources."
  type        = string
  default     = "us-central1" // Example default
}

// TODO: Add other variables as needed (e.g., bucket names, BigQuery dataset names)
