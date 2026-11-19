# Storage plan within approximately US$15/month

**Later decision, 17 November:** the user approved an approximately $20/month total budget funded by existing student credit, including permanently leaving the SQL free offer for fixed Basic SQL (5 DTUs / 2 GiB). The Blob design below remains an alternative proposal, not an implemented migration. The reviewed SQL configuration is now available through `sql_state_tier=basic`; set that variable before the next HCP Terraform plan. A serverless `BillOverUsage` opt-in cannot be switched back to monthly-limit AutoPause and must not be treated as a reversible recovery toggle.

Status: proposal only. No storage resource, billing setting, access grant or production data has been changed by this plan. Prices checked on 16 November 2026 for France Central, in USD, before taxes.

## Current release and blocker

Application commit `0680a03` was pushed to GitHub `dev` and published by [Azure run 37](https://dev.azure.com/as4dc/blueray/_build/results?buildId=37). Its remaining readiness retries were canceled after publication with the user's approval. The public origin serves its exact JavaScript/CSS, `/healthz` responds successfully, and the sign-in-provider endpoint works. This does **not** establish that accounts and workspaces are healthy: the cloud-backed session check times out.

Azure SQL reports `Paused`. Its historical metrics reached 100,000 consumed vCore-seconds and zero remaining allowance on 15 November, before this release. The application logs record SQL error 42119. This is the monthly free-offer pause described by [Microsoft's free-tier FAQ](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-tier-faq). Keep `useFreeLimit=true` and `AutoPause`; do not silently enable SQL overage billing.

## Recommended direction

Keep all proposed resources in the existing **Azure for Students subscription**, funded by its remaining student credit. Do not create a separate paid subscription, upgrade the offer or remove its spending protection. [Student credit](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0170p/) and the SQL monthly free allowance are separate limits: the current SQL `AutoPause` setting stops the database at its free allowance even when subscription credit remains. This proposal does not authorize enabling `BillOverUsage` to spend that credit on SQL overages. Confirm remaining credit and projected total subscription usage before any infrastructure apply; the approximately $15/month target is not a guarantee of available annual credit.

Keep the existing single Linux B1 App Service instance, domain and managed identity. Replace Azure SQL's role as the application's **snapshot store** with a private Standard GPv2 Azure Blob Storage account, Hot tier, LRS, in France Central. SQLite continues to run on `/tmp` inside the app. Blob Storage holds durable application state; it does not replace users' external PostgreSQL servers or change their SQL dialect.

This fits the current architecture better than adding another database engine: `backend/cloud_state.py` already persists bounded filesystem state. The proposed adapter changes that durability boundary while leaving accounts, workspaces, reports and database formats intact. Do not place the active SQLite files directly on App Service's shared `/home` mount.

### Data and concurrency design

- One active writer process owns a 60-second lease on a small state manifest, renewed every 30 seconds. The existing single-worker/single-instance restriction stays. A replacement worker must acquire ownership before serving application data; the previous worker must stop serving if ownership expires. Azure leases protect writes; **the application must also fence reads**, which Azure does not do automatically.
- Keep the local request lock. Commit changed file chunks first, then atomically publish a manifest using both the lease ID and its expected ETag. Return success only after the durable commit. Reject stale generations and restore the previous local state after failed persistence. Never silently start with an empty installation.
- Store unchanged data as immutable, content-addressed chunks rather than uploading the entire ZIP on every keystroke. A manifest records each file's size, chunk hashes and revision. Enforce the existing 64 MiB/256-file state bounds, reject unsafe paths and verify hashes during recovery.
- Serve routine live-refresh reads from the current local state while ownership is valid. Investigate the existing `browser_logins.last_seen` write on every authenticated poll: read polling must not cause a full durable state rewrite. Any heartbeat batching must preserve revocation and idle-expiry security and have explicit restart tests.
- Retain 24 hourly recovery points and seven daily recovery points. Garbage-collect only chunks unreferenced by the current state and retained manifests. Do not enable unlimited per-keystroke blob versions or overwrite snapshots; those would invalidate the storage estimate. Review the resulting recovery-point policy before replacing SQL backups.
- Use the existing app managed identity, scoped to the dedicated container, with no browser SAS tokens or public blobs. Preserve the existing connection-encryption key and Key Vault configuration. An eventual access grant requires its own reviewed apply.

Azure supports [ETag-based conditional writes and blob leases](https://learn.microsoft.com/en-us/azure/storage/blobs/concurrency-manage), including [15–60 second lease durations](https://learn.microsoft.com/en-us/rest/api/storageservices/lease-blob). These primitives support the design; they do not implement the fencing, recovery and cost controls for us.

## Cost envelope

Microsoft's [Retail Prices API](https://prices.azure.com/api/retail/prices) currently lists France Central Linux B1 at $0.018/hour. The relevant General Block Blob v2 Hot LRS rates are $0.0192/GB-month for the first storage tier, $0.059 per 10,000 write operations, and $0.0047 per 10,000 read/other operations. See [App Service pricing](https://azure.microsoft.com/en-us/pricing/details/app-service/linux/) and [Blob pricing](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/).

This is an illustrative workload envelope, **not measured application usage or an unlimited-service promise**:

| Item | Monthly assumption | Estimated cost |
| --- | --- | ---: |
| Existing Linux B1 | 744 hours, a 31-day month | $13.392 |
| Blob state and retained recovery chunks | 10 GB average total | $0.192 |
| Data write operations | 100,000 operations, including chunks and manifest commits | $0.590 |
| Lease renewals | 89,280; conservatively charged at the higher write rate | $0.527 |
| Read operations | 100,000 | $0.047 |
| **Hosting + state storage** | Within this envelope | **$14.748** |

For a 730-hour month, the same envelope is approximately $14.50. The remaining roughly $0.25 in the 31-day case is narrow headroom for the existing Key Vault and small incidental operations. Taxes, domain renewal, paid AI usage, paid email, cross-region transfer and optional paid monitoring are outside this estimate. Do not add those services assuming they fit. No VM, registry, private endpoint, paid log workspace or new SQL tier is proposed.

100,000 operations does **not** mean 100,000 user edits: one commit may upload several chunks plus a manifest. Large imports, active report collaboration, heartbeat persistence and recovery downloads must be measured. Configure usage counters and cost alerts, and review projected spend before approaching the envelope. A cost alert is not a hard billing cap. If realistic load testing cannot fit this envelope, revise the plan rather than promising $15.

## Migration that preserves existing accounts

The existing SQL snapshot is authoritative. Do not redirect production to an empty Blob container, delete SQL, recreate user accounts or upload the laptop's separate fixture accounts.

1. Implement the adapter and test it locally with isolated fixtures; keep the SQL adapter available for rollback. Add Terraform changes as a reviewable plan, without applying them.
2. Obtain a complete verified export of the existing SQL-backed state. The exhausted free offer currently prevents this. Use an already verified complete backup if one exists; otherwise wait for the monthly reset, or separately review a temporary paid recovery window. This proposal does not authorize that paid window. A scratch directory alone is not proof of the last committed state.
3. During a brief maintenance window, block new writes, export the final state, hash and retain it, upload the initial manifest/chunks, and test a restore in a separate scratch directory. Compare account, workspace, membership, database and report counts; verify encrypted connections remain usable without printing credentials.
4. Switch only after those checks pass. Confirm anonymous session readiness, existing-account login, scoped access, SQL reads/confirmed writes, two-person report editing and recovery after worker replacement. Keep the SQL resource and exported rollback snapshot intact until acceptance and retention review.
5. Rollback must account for all post-cutover writes. Freeze and export the Blob state before reverting; never simply point to an older SQL snapshot and discard acknowledged edits.

With no readable authoritative backup and no paid recovery approval, a data-preserving immediate cutover is blocked. The expected next monthly reset is **1 December 2026 at 00:00 UTC**, which is **30 November at 6:00 p.m. America/Chicago**. Verify access after reset before scheduling the migration.

## Acceptance gates before implementation approval

- At most one writer survives overlapping deployment, renewal failure, expiry and restart tests; stale readers/writers fail closed.
- Acknowledged writes survive process termination, interrupted uploads, retries and manifest conflicts without replaying external PostgreSQL side effects.
- Existing API/data formats, access restrictions, pending SQL confirmations, account recovery and live report merging remain compatible.
- A representative maximum-size state, large uploads and simultaneous editors meet responsiveness goals and stay within the measured operation envelope.
- A restore exercise succeeds, including retained recovery points and cleanup of abandoned uploads.
- The reviewed infrastructure plan shows only the intended storage account/container and narrowly scoped app access; existing SQL remains protected and its billing behavior remains unchanged.

This plan is ready for implementation review. It does not restore the currently paused production database by itself.
