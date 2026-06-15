# Upstream Issue Triage

Triage of the 56 open issues on the original (archived) repo
[cribeiro84/azure-devops-pull-request-hub](https://github.com/cribeiro84/azure-devops-pull-request-hub/issues),
prioritized for the **PR Hub** fork (GotWoods).

Each item was cross-referenced against what the fork has already shipped
(auto-refresh, automatic filter persistence / removed Save-Clear buttons,
per-tab configurable sort, dedup-on-refresh, "Top Completed/Abandoned" total
cap, all-projects support, background per-row detail loading, removed Work
Items icon, refresh-flicker fix).

> Caveat: every **P0** item is "verify in the running fork, *then* close" —
> calls were made from the commit log, not a live run.

---

## P0 — Verify already-fixed, then close (fastest cleanup)

| Issue | Report | Why likely fixed in fork |
|---|---|---|
| #197 | Auto refresh | Auto-refresh on page return + configurable interval |
| #280 / #241 | Duplicate repos in dropdown after refresh | Dedup-on-refresh |
| #231 | Save sorting | Per-tab sort is now a saved preference |
| #167 | Completed/Abandoned ordered oldest-first show wrong PRs | Per-tab default newest-first (keep #239 for a completion-*date* column) |
| #285 / #134 | Can't save filter when empty / button placement | Save/Clear buttons removed; filters auto-persist |
| #202 | Multi-project filter not remembered | Filters auto-remembered + spans all projects |
| #206 | Select-all in project filter | All accessible projects managed |

**Verify-maybe** (changed behavior may have resolved them): #255 (filters
revert to a stale copy), #188 (project/repo selection flow), #249 (favourites
pain reduced), #168 (relative times).

---

## P1 — Real bugs to fix, in priority order

1. **#266 — NetworkException during load** (17 comments, highest engagement).
   Two halves: (a) environmental (proxy/cookie/referrer blocking), and (b) a
   real scalability bug — hundreds of near-simultaneous per-repo API calls get
   throttled in large orgs (1600+ repos). Suggested fix: switch to the
   **get-pull-requests-by-project** API to collapse hundreds of calls into one.
   Overlaps **#211** (not all PRs shown at very large scale). Directly related
   to the fork's recent performance work.
2. **#251 — Changing sorting causes filters to be ignored.** Contributor
   root-caused it: re-sort re-splices from the *unfiltered* cached list instead
   of the filtered provider. **One fix also resolves #215 and #216.**
3. **#146 — Group approval shown when the PR author is in the group.** Confirmed,
   still reproduced; author's own vote shouldn't satisfy a required group.
4. **#210 — Decline-to-review doesn't update the hub.** Owner-acknowledged;
   reviewer still shows waiting/No-Vote after declining (decline ≠ reject).
5. **#204 — Incomplete PR URLs on on-prem Azure DevOps Server.** Drops the IIS
   app path + collection name. Confirmed by 2 users on ADS 2019/2020.
6. **#290 — Tag filter only shows tags from loaded PRs, very slow at high
   counts.** Wants all tags fetched up front rather than aggregated per-PR.
7. **#158 — False "Require a merge strategy" policy failure** when branch policy
   excludes Basic Merge. ADO returns it as rejected/blocking; hub could
   special-case it.
8. **#289 — New-comment icon fires on your own comments.** Should ignore
   self-authored changes.
9. **#189 — Error banner "X" throws and won't dismiss.** Small; corroborated
   inside #266.
10. **#142 — Alternate-status filters use OR; users want AND** (e.g. "no
    conflicts AND not draft"). Tied to #216.
11. **#201 / #160 — Layout overflow / label misalignment** (cosmetic).

---

## P2 — Close as user error / environment

All browser-privacy / proxy / caching, not code bugs. Close together with a
single troubleshooting note (third-party cookies, tracking protection,
websocket/referrer blocking, clear site cookies):

- #281 — broken reviewer avatars (resolved in comments as env)
- #250 — "Unable to contact the server" (proxy/firewall/websocket)
- #247 — VS800075 stale cached project id (fixed by clearing cookies)
- #286 — native ADO 500 when disabling a repo (out of scope)
- #219 — duplicated policies (owner could not reproduce; stale)

---

## P3 — Feature quick wins

- #191 — reset elapsed time when a draft is published
- #253 — also surface the hub under Overview (not just Repos)
- #288 — middle-click to open a PR (needs the PR name re-made into a real link first)

---

## P4 — Larger feature requests (grouped)

- **Reporting:** #230 export CSV, #144 summary counts
- **Columns / sort:** #227 last-updated column, #239 completion-date column +
  rename "When", #265 X/M reviewers approved, #198 file count
- **Policy / build in list:** #207 + #159 (overlap — build/per-policy icons)
- **Filtering:** #287 date range, #68 + #176 branch/repo wildcards (overlap),
  #143 status filter, #97 persist creator roster, #155 multiple named filters,
  #154 one-click inline filters, #249 favourited-repos filter
- **Aging:** #153 highlight PRs older than X, #190 work-day-only elapsed time
- **Platform:** #245 persist preferences via VSS SDK (cross-device sync),
  #20 dashboard widget, #291 dedicated PR tag chips in rows

---

## Cross-issue notes (fix once, close many)

- **#215, #216** share the same root cause as **#251** (re-sort reads the
  unfiltered cache) — fix once.
- **#250**, the environmental half of **#266**, **#281**, and **#247** are all
  the same browser-privacy class — close together.
- Overlaps: **#207 ≈ #159** (build/policy status in list); **#167 ≈ #239**
  (completion-date sorting/column); **#68 ≈ #176** (pattern-based repo/branch
  filtering); **#202 / #206 / #188** are the project-filter cluster the fork's
  all-projects model largely reshaped.
