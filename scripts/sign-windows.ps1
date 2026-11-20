# Signs one file through Azure Artifact Signing. Tauri's bundler calls this (bundle.windows.signCommand, set by
# scripts/package.mjs when MOBIUS_SIGN_WINDOWS=1) on the shell after it has written the bundle type into it, on the
# programs beside it, and on the installer: signing before that change left the installed shell with a signature that
# no longer matched it (HashMismatch, v0.1.19).
#
# Needs the ArtifactSigning PowerShell module, an Azure sign-in (azure/login in the release workflow), and
# AZURE_SIGNING_ENDPOINT, AZURE_SIGNING_ACCOUNT and AZURE_CERTIFICATE_PROFILE.
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'
Import-Module ArtifactSigning
$params = @{
  Endpoint = $env:AZURE_SIGNING_ENDPOINT
  CodeSigningAccountName = $env:AZURE_SIGNING_ACCOUNT
  CertificateProfileName = $env:AZURE_CERTIFICATE_PROFILE
  Files = $File
  FileDigest = 'SHA256'
  TimestampRfc3161 = 'http://timestamp.acs.microsoft.com'
  TimestampDigest = 'SHA256'
  Description = 'Mobius'
  DescriptionUrl = 'https://github.com/BevActual/mobius'
  # Signed in through the Azure CLI (azure/login): the other ways of signing in are not tried.
  ExcludeEnvironmentCredential = $true
  ExcludeWorkloadIdentityCredential = $true
  ExcludeManagedIdentityCredential = $true
  ExcludeSharedTokenCacheCredential = $true
  ExcludeVisualStudioCredential = $true
  ExcludeVisualStudioCodeCredential = $true
  ExcludeAzurePowerShellCredential = $true
  ExcludeAzureDeveloperCliCredential = $true
  ExcludeInteractiveBrowserCredential = $true
}
Invoke-ArtifactSigning @params
$check = Get-AuthenticodeSignature $File
if ($check.Status -ne 'Valid') { throw "$File does not verify after signing: $($check.Status) $($check.StatusMessage)" }
Write-Host "Signed $(Split-Path $File -Leaf) as $($check.SignerCertificate.Subject)"
