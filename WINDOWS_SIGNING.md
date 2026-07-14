# Windows Code Signing — What We Need From Azure

We sign the **RDSS Folder Mapper** Windows desktop installer with **Azure Trusted
Signing** so it is publicly trusted and no longer triggers SmartScreen "Unknown
Publisher" warnings. The GitHub Actions release pipeline is already wired to sign
automatically once the items below exist. This page is the request to the Azure
tenant / subscription owners.

## What we need provisioned

1. **Trusted Signing account** (Azure resource `Microsoft.CodeSigning`)
   - A resource group + Trusted Signing account in a supported region
     (e.g. Australia East / East US).
   - A **Certificate Profile** of type **Public Trust** under that account
     (organisation validation), issued to **Queensland University of Technology**.

2. **Organisation identity validation**
   - Trusted Signing requires a one-time identity validation of QUT before a
     Public Trust profile can issue certificates. This typically needs an
     authorised signatory and may take a few business days. Please initiate this.

3. **Microsoft Entra ID app registration (service principal) for CI**
   - A dedicated app registration used only by GitHub Actions to sign.
   - Generate a **client secret** for it (note the expiry date so we can rotate).
   - Grant it the **Trusted Signing Certificate Profile Signer** role, scoped to
     the Trusted Signing account (or the specific certificate profile).

## What to hand back to us

Once provisioned, please provide these values so we can store them in GitHub. The
three **secrets** are sensitive; the four **variables** are not.

| Type | Name | Description |
| --- | --- | --- |
| Secret | `AZURE_TENANT_ID` | Entra tenant (directory) ID |
| Secret | `AZURE_CLIENT_ID` | App registration (service principal) client ID |
| Secret | `AZURE_CLIENT_SECRET` | Client secret for that app registration |
| Variable | `AZURE_TS_ENDPOINT` | Trusted Signing account endpoint, e.g. `https://aue.codesigning.azure.net` |
| Variable | `AZURE_TS_ACCOUNT` | Trusted Signing account name |
| Variable | `AZURE_TS_PROFILE` | Certificate profile name |
| Variable | `WIN_PUBLISHER_NAME` | Publisher name exactly as on the certificate (e.g. `Queensland University of Technology`) |

We add these under the repository's **Settings → Secrets and variables →
Actions**. No certificate files or private keys are ever exported — signing runs
against the managed service via the service principal.

## How it is used (for context)

On each tagged release, the Windows CI job authenticates to Entra ID with the
service principal, and `electron-builder` calls Azure Trusted Signing
(`Invoke-TrustedSigning`) to sign the installer. If the secret is absent (e.g. a
fork or a run before setup is complete), the build still succeeds but produces an
**unsigned** installer — nothing breaks in the meantime.

## Good to know

- **Cost:** Trusted Signing is ~US$9.99/month per account, plus a small
  per-signature allowance that comfortably covers our release cadence.
- **Secret rotation:** the client secret expires; please set a calendar reminder
  and send us the new value before expiry so releases keep signing.
- **Least privilege:** the service principal only needs the *Certificate Profile
  Signer* role — no broader subscription access is required.

---

**Contact:** RDSS Folder Mapper maintainers · Repository:
`eresearchqut/rdss-folder-mapper`
