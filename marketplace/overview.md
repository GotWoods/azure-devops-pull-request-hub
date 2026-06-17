# PR Hub

A fork of [Pull Request Manager Hub](https://github.com/cribeiro84/azure-devops-pull-request-hub) by cribeiro84, which is no longer maintained.

Please report any feedback/issue [here](https://github.com/GotWoods/azure-devops-pull-request-hub):

------

Manage your Pull Requests of all your projects and repositories at a single place without having to switch between each repository. Track its status and what's most important to focus on your code review process.

## Features

- Lists all Pull Requests across your repositories of the selected project
- Filter by:
  - Title
  - Pull Request ID
  - By Team Project
  - One or multiple repositories
  - Source Branches
  - Target Branches
  - Requestor
  - Reviewers
  - Your vote status
  - Alternate Status: Is Draft, Conflicts, Auto-Complete
  - Tags
- Search filters are remembered automatically between visits
- Independent sort order for Active and Completed/Abandoned PRs (e.g. Active oldest first, Completed newest first)
- Continue where you left - When you click to review a Pull Request (it always opens in a **new window**) the row will be kept highlighted
- Easily identify the reviewers of that Pull Request
- Last Commit push date
- You can now manage all Pull Requests across all projects you have access to
- Comments count + resolved ones (For instance: 1/2 resolved)
- Pull Request policies check (Reviewers, build, so on)
- Save current state
  - Selected search filters per project
    - Now you can save your filters per selected project
- Support to view Completed and Abandoned PRs
  - The current selected project will be remembered when you come back

## Updates (dd/MM/yyyy)

### 17/06/2026

- New: reviewers who declined a review now show a distinct "Declined to review" indicator instead of the blue waiting clock
- Performance: Pull Requests are now fetched per project in a single paged query instead of one request per repository
  - Fixes throttling errors (TF400893) that could break the list on large projects
  - Large projects no longer silently drop Pull Requests
- Bug fix: Pull Request, repository, branch and commit links now use the repository's own web URL, fixing broken links on on-prem Azure DevOps Server running behind a custom virtual directory or collection path
- Bug fix: re-sorting a column no longer clears your active filters
- Bug fix: setting the auto-refresh interval to 0 now fully disables automatic refreshing (including the refresh when you return to the page), and changing the interval now applies immediately without needing a page reload

### 15/06/2026

- Performance: the PR list loads noticeably faster on accounts with many repositories
  - Pull Request details (policies, comment counts, tags, auto-complete and new-commit indicators) now load in the background and fill in per row, so the list appears immediately instead of waiting for every detail to finish loading
  - Removed the linked Work Items icon and its lookups, cutting two API calls per Pull Request
- Bug fix: refreshing the list (manual or automatic) no longer flashes an empty "no Pull Requests" state before the rows reappear

### 10/06/2026

- Relaunched as **PR Hub** (fork of the archived Pull Request Manager Hub)
- New icon
- Search filters are now remembered automatically between visits - no need to click Save
- The PR list now refreshes automatically: when you return to the page, and on a configurable interval while it stays open (see the new "Auto-refresh interval" preference)
- Sort order is now configurable separately for Active and Completed/Abandoned PRs
  - Active defaults to oldest first, Completed/Abandoned to newest first
- Bug fix: the "Top Completed/Abandoned PRs" preference is now honored as a total across all repositories (it previously applied per repository)
- Bug fix: clearing the "Top Completed/Abandoned PRs" field no longer silently disables the limit
- Bug fix: hitting Refresh repeatedly before results loaded no longer duplicates every PR in the list
- Bug fix: the repository filter dropdown no longer shows duplicates after a refresh

### 09/04/2021

- Bug fixes reported in GitHub issues
- Duplicated items
- Disabled repos blocking extension to load

### 06/08/2020

- New Alternate Status: Has New Changes
- UI tweaks
- New icons (comments or commits) for Has Changes since your last visit to the PR

### 02/08/2020

- New Alternate Status: Ready for Completion and Not Ready for Completion
- UI tweaks
- Bug fixes: 
  - Wrong required reviewers marked 
  - Wrong count of reviewers approved
- Performance improvements
- Better PR Policy listing and check

### 28/07/2020

- Support for Completed and Abandoned PRs
- UI tweaks
- Performance improvements
- Filters now can be saved by selected Project
  - The current selected project will be remembered when you come back

### 22/07/2020

- UI tweaks
- Performance improvements
- Soring by Pull Request Creation Date (When column)

### 21/07/2020

- UI tweaks
- Code refactoring
- New features
  - Save current filters

### 12/07/2020

- UI tweaks
- Code refactoring
- New features
  - Tag list
  - Better async calls to fetch PR details
  - Column status sync with Policies and reviewers vote
  - Filter by Tags

### 03/02/2020

- UI tweaks
- Code refactoring
- New features
  - Comments count + resolved ones (For instance: 1/2 resolved)
  - Pull Request policies check (Reviewers, build, so on)

### 19/01/2020

- UI tweaks
- Minor improvements
- Code refactoring
- Performance improvements
- Replaced Is Draft filter by Alternate Status
  - It allows to filter by: Is Draft, Conflicts and Auto-Complete

### 11/01/2020

- UI tweaks
- Minor improvements
- Code refactoring
- Performance improvements

### 14/12/2019

- TFS/Azure DevOps Server url fixes
- Minor improvements

### 02/12/2019

- Minor fixes
- Sort project list filter by name
- TFS base URL fix

### 29/11/2019

- New filter: Project
- UI tweaks
- Minor fixes

### 26/11/2019

- Minor fixes
- UI tweaks
- Last Commit push date

### 23/11/2019

- Minor fixes
- UI tweaks

### 10/11/2019

- Minor fixes
- Added feature to highlight the row when it's clicked
- Added a help button to indicate what each PR status icon represents

### 08/11/2019

- Filter fixes

### 06/11/2019

- Filter fixes
- UI tweaks
- Code cleanup

### 02/10/2019

- Filter fixes
- New filter: Is Draft
- UI tweaks
- Code cleanup
- Removed support for TFS

### 28/09/2019

- Filter fixes
- Sort filter dropdown lists
- Filter by Pull Request ID
- Code cleanup

### 09/09/2019

- Minor fixes
- Screenshots

### 21/08/2019

- Public release of **Pull Request Manager Hub**

## Screenshots

### Pull Request Manager Hub home

![Pull Request Manager Hub - No filter](marketplace/screenshots/screenshot-01.png)

### ...using filters

![Pull Request Manager Hub - Filtering](marketplace/screenshots/screenshot-02.png)

### ...and light theme

![Pull Request Manager Hub - Light Theme](marketplace/screenshots/screenshot-03.png)
