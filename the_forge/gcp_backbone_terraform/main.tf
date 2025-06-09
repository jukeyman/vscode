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
// TODO: Define specific IAM roles (e.g., data-ingestor-role, model-trainer-role)
// TODO: Define service accounts and bind roles

// Networking
// TODO: Define VPC, subnets, firewall rules

// Security
// TODO: Define configurations for Google Secret Manager
