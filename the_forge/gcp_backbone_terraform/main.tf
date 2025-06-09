// Main Terraform configuration for The Forge GCP Backbone

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 4.0" // Specify a suitable version
    }
  }
  // Configure backend for Terraform state storage (e.g., GCS bucket)
  // backend "gcs" {
  //   bucket  = "your-terraform-state-bucket-name" // To be created and specified
  //   prefix  = "the_forge/terraform_state"
  // }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

// --- Resource Stubs ---

// Google Cloud Storage (GCS) Buckets
// Example:
// resource "google_storage_bucket" "raw_data" {
//   name          = "${var.gcp_project_id}-raw-data"
//   location      = var.gcp_region
//   force_destroy = false // Set to true for ephemeral dev environments if needed
//   storage_class = "STANDARD"
//   versioning {
//     enabled = true
//   }
//   uniform_bucket_level_access = true
//   // Add lifecycle rules, CMEK, etc. as needed
// }
// TODO: Define buckets for: raw-data, cleaned-data, training-artifacts, model-registry, paper-pdfs, terraform-state

// Google BigQuery
// Example Dataset:
// resource "google_bigquery_dataset" "forge_metadata" {
//   dataset_id                  = "forge_metadata"
//   friendly_name               = "Forge Metadata"
//   description                 = "Central metadata for The Forge project"
//   location                    = var.gcp_region
//   delete_contents_on_destroy  = false // Be cautious with this in production
// }
// TODO: Define datasets and tables with schemas for: projects, datasets, models, papers, deployments

// IAM Roles and Service Accounts
// Example: Assigning the Storage Object Admin role to the specified service account
// This allows the service account to manage objects in GCS buckets.
// resource "google_project_iam_member" "storage_admin_for_rick_gpt" {
//   project = var.gcp_project_id
//   role    = "roles/storage.objectAdmin"
//   member  = "serviceAccount:rick-gpt-433807@appspot.gserviceaccount.com"
// }

// Example: Granting the service account access to run Vertex AI Custom Jobs and access GCS
// resource "google_project_iam_member" "vertex_ai_custom_job_user_for_rick_gpt" {
//   project = var.gcp_project_id
//   role    = "roles/aiplatform.customCodeServiceAgent" // A common role for custom jobs
//   member  = "serviceAccount:rick-gpt-433807@appspot.gserviceaccount.com"
// }

// TODO: Define specific IAM roles (e.g., roles/bigquery.dataEditor, roles/cloudtasks.enqueuer,
//       roles/secretmanager.secretAccessor, roles/aiplatform.user, etc.)
//       and assign them to serviceAccount:rick-gpt-433807@appspot.gserviceaccount.com
//       or, preferably, create dedicated service accounts for each Forge module/service
//       following the Principle of Least Privilege. Each dedicated service account would then
//       be granted only the permissions it needs for its specific tasks.
//       For example, the Orchestrator might need BigQuery and Cloud Tasks permissions,
//       while UDACE might need GCS and Secret Manager permissions.

// Networking
// TODO: Define VPC, subnets, firewall rules

// Security
// TODO: Define configurations for Google Secret Manager
