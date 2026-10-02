import "./PullRequestTab.scss";

import * as React from "react";

import {
  AZDEVOPS_CLOUD_API_ORGANIZATION,
  AZDEVOPS_API_ORGANIZATION_RESOURCE,
  AZDEVOPS_CLOUD_API_ORGANIZATION_OLD,
  getCommonServiceIdsValue,
  getZeroDataActionTypeValue,
  getStatusSizeValue,
  FILTER_STORE_KEY_NAME,
} from "../models/constants";

import { Spinner, SpinnerSize } from "office-ui-fabric-react";

// Custom
import * as Data from "./PulRequestsTabData";
import * as PullRequestModel from "../models/PullRequestModel";

// Azure DevOps SDK
import * as DevOps from "azure-devops-extension-sdk";

// Azure DevOps API
import { IProjectPageService, getClient, IHostNavigationService } from "azure-devops-extension-api";
import { GitRestClient } from "azure-devops-extension-api/Git/GitClient";
import { CoreRestClient } from "azure-devops-extension-api/Core/CoreClient";
import {
  GitPullRequest,
  GitPullRequestSearchCriteria,
  IdentityRefWithVote,
  PullRequestStatus,
} from "azure-devops-extension-api/Git/Git";

// Azure DevOps UI
import { ListSelection } from "azure-devops-ui/List";
import { Observer } from "azure-devops-ui/Observer";
import { Dialog } from "azure-devops-ui/Dialog";
import { Filter, FILTER_CHANGE_EVENT } from "azure-devops-ui/Utilities/Filter";
import {
  DropdownMultiSelection,
} from "azure-devops-ui/Utilities/DropdownSelection";
import {
  ObservableArray,
  IReadonlyObservableValue,
} from "azure-devops-ui/Core/Observable";
import { Card } from "azure-devops-ui/Card";
import { Status, Statuses } from "azure-devops-ui/Status";
import {
  Table,
  ColumnSorting,
  SortOrder,
  sortItems,
  ITableColumn,
  TableColumnStyle,
} from "azure-devops-ui/Table";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { IdentityRef } from "azure-devops-extension-api/WebApi/WebApi";
import { ObservableValue } from "azure-devops-ui/Core/Observable";
import {
  TeamProjectReference,
  WebApiTagDefinition,
  ProjectInfo
} from "azure-devops-extension-api/Core/Core";
import { FilterBarHub } from "../components/FilterBarHub";
import { hasPullRequestFailure } from "../models/constants";
import { ContentSize } from "azure-devops-ui/Callout";
import { IHeaderCommandBarItem } from "azure-devops-ui/HeaderCommandBar";
import {
  ShowErrorMessage,
  UserPreferencesInstance,
  PREFERENCES_SAVED_EVENT,
} from "../common";
import {
  StatusColumn,
  TitleColumn,
  DetailsColumn,
  DateColumn,
  ReviewersColumn,
} from "../components/Columns";
import { IListBoxItem } from "azure-devops-ui/ListBox";
import { GitRepositoryModel } from '../models/PullRequestModel';
import { TeamRef } from "./PulRequestsTabData";
import { withAuthRetry, isTransientAuthError } from "../lib/retry";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";

export interface IPullRequestTabProps {
  prType: PullRequestStatus;
  projects: TeamProjectReference[];
  onCountChange: (count: number, capped?: boolean) => void;
  showToastMessage: (message: string) => void;
}

export class PullRequestsTab extends React.Component<
  IPullRequestTabProps,
  Data.IPullRequestsTabState
> {
  private baseUrl: string = "";
  private loadInProgress: boolean = false;
  // While true, the load skips the spinner and keeps the current table
  // contents visible until the fresh results land
  private silentRefresh: boolean = false;
  private silentRefreshFailed: boolean = false;
  private authFailed: boolean = false;
  private lastLoadCompleted: number = 0;
  private autoRefreshTimer: number | undefined;
  private previousPullRequests: PullRequestModel.PullRequestModel[] = [];
  private resultsCapped: boolean = false;
  // Distinct team-member identities across the loaded project(s); source for the
  // author/reviewer filter dropdowns on the completed/abandoned tabs.
  private memberIdentitiesById = new Map<string, IdentityRef>();
  // Keys (`c:{id}` creator / `r:{id}` reviewer) of people whose completed/
  // abandoned PRs have already been fetched on demand and merged into the pool.
  private fetchedPersonKeys = new Set<string>();
  // Serializes on-demand person fetches so concurrent filter runs don't
  // double-fetch/double-merge.
  private personFetchInFlight: Promise<void> | null = null;
  // Monotonic token so a slow on-demand filter run can't overwrite a newer one.
  private filterSequence = 0;
  // Set while a batch of models is being constructed so their initial
  // triggerState() callbacks don't each fire a full filterPullRequests() pass.
  private suppressFilterDuringBuild = false;
  private prRowSelecion = new ListSelection({
    selectOnFocus: true,
    multiSelect: false,
  });
  private isDialogOpen = new ObservableValue<boolean>(false);
  private filter: Filter;
  private selectedProjects = new DropdownMultiSelection();
  private selectedMyApprovalStatuses = new DropdownMultiSelection();
  private selectedAlternateStatusPr = new DropdownMultiSelection();
  private pullRequestItemProvider = new ObservableArray<
    | PullRequestModel.PullRequestModel
    | IReadonlyObservableValue<PullRequestModel.PullRequestModel | undefined>
  >();

  private readonly gitClient: GitRestClient;
  private readonly coreClient: CoreRestClient;
  // Root element of this tab, used to locate the scrolling ancestor so the
  // scroll position can be preserved across a background refresh
  private rootElementRef = React.createRef<HTMLDivElement>();

  constructor(props: IPullRequestTabProps) {
    super(props);

    this.selectedProjectChanged = this.selectedProjectChanged.bind(this);

    this.gitClient = getClient(GitRestClient);
    this.coreClient = getClient(CoreRestClient);

    this.state = {
      projects: props.projects,
      pullRequests: [],
      repositories: [],
      createdByList: [],
      teamsList: {},
      sourceBranchList: [],
      targetBranchList: [],
      reviewerList: [],
      tagList: [],
      loading: true,
      errorMessage: "",
      sessionExpired: false,
      pullRequestCount: 0,
      savedProjects: [],
      sortOrder: this.getDefaultSortOrder()
    };

    this.filter = new Filter();
  }

  private getDefaultSortOrder(): SortOrder {
    const sorting =
      this.props.prType === PullRequestStatus.Active
        ? UserPreferencesInstance.selectedActiveSorting
        : UserPreferencesInstance.selectedCompletedSorting;

    return sorting === "asc" ? SortOrder.ascending : SortOrder.descending;
  }

  public async componentDidMount() {
    DevOps.init().then(async () => {
      this.initializeState();
      this.setupFilter();
      await this.initializePage();
      this.setupAutoRefresh();
    });
  }

  componentWillUnmount() {
    this.unloadFilter();
    this.teardownAutoRefresh();
    window.removeEventListener(
      PREFERENCES_SAVED_EVENT,
      this.onPreferencesSaved
    );
  }

  private setupAutoRefresh() {
    // Re-apply the auto-refresh config whenever preferences are saved so the
    // setting takes effect immediately, without a full page reload
    window.addEventListener(PREFERENCES_SAVED_EVENT, this.onPreferencesSaved);
    this.applyAutoRefresh();
  }

  private onPreferencesSaved = () => {
    this.applyAutoRefresh();
  };

  private applyAutoRefresh() {
    // Tear down any existing timer/listener first so the new interval (or a
    // value of 0, which disables refreshing entirely) replaces the old one
    this.teardownAutoRefresh();

    const intervalSeconds = UserPreferencesInstance.autoRefreshIntervalSeconds;
    if (intervalSeconds > 0) {
      // Refresh as soon as the user comes back to the page, e.g. after
      // completing a PR in another browser tab
      document.addEventListener("visibilitychange", this.onVisibilityChange);

      this.autoRefreshTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          this.backgroundRefresh();
        }
      }, intervalSeconds * 1000);
    }
  }

  private teardownAutoRefresh() {
    document.removeEventListener("visibilitychange", this.onVisibilityChange);

    if (this.autoRefreshTimer !== undefined) {
      window.clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = undefined;
    }
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      this.backgroundRefresh();
    }
  };

  private async backgroundRefresh(): Promise<void> {
    // Skip if a load is running or one finished moments ago (e.g. the
    // visibility handler firing right after the initial load)
    if (this.loadInProgress || Date.now() - this.lastLoadCompleted < 10000) {
      return;
    }

    this.silentRefresh = true;
    try {
      await this.loadAllProjects();
    } finally {
      this.silentRefresh = false;
    }
  }

  private unloadFilter() {
    this.filter.unsubscribe(() => {
      this.filterPullRequests();
    }, FILTER_CHANGE_EVENT);
  }

  private setupFilter() {
    this.filter.subscribe(() => {
      this.filterPullRequests();
      this.autoSaveFilters();
    }, FILTER_CHANGE_EVENT);
  }

  // Persist the filter state on every change so it is restored on the
  // next visit
  private autoSaveFilters() {
    try {
      const filterKey = this.getCurrentFilterNameKey();
      const serializedFilter = JSON.stringify(this.filter.getState());
      localStorage.setItem(filterKey, serializedFilter);
    } catch (error) {
      console.log(error);
    }
  }

  private async initializeState() {
    this.setState({
      pullRequests: [],
    });
  }

  private getCurrentFilterNameKey(): string {
    const filterKey = `MY_${FILTER_STORE_KEY_NAME}`;
    return filterKey;
  }

  private async loadSavedFilter(): Promise<void> {
    try {
      const saveFilterKeyName = this.getCurrentFilterNameKey();
      const hashPrefix = `#${saveFilterKeyName}=`;

      const navigationService = await DevOps.getService<IHostNavigationService>(
        getCommonServiceIdsValue("HostNavigationService")
      );
      const hash = await navigationService.getHash();

      let storedSavedFilter;
      if (hash.startsWith(hashPrefix)) {
        storedSavedFilter = decodeURIComponent(hash.substr(hashPrefix.length));
      } else {
        storedSavedFilter = localStorage.getItem(saveFilterKeyName);
      }

      if (storedSavedFilter && storedSavedFilter.length > 0) {
        const savedFilterState = JSON.parse(storedSavedFilter);
        this.filter.setState(savedFilterState);
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  private async initializePage() {
    const { savedProjects } = this.state;
    this.setState({
      repositories: [],
      sourceBranchList: [],
      targetBranchList: [],
      pullRequests: [],
    });

    this.getOrganizationBaseUrl()
      .then(async () => {
        await this.loadSavedFilter();

        this.setState({
          savedProjects,
        });

        await this.loadAllProjects();
      })
      .catch((error) => {
        this.handleError(error);
      });
  }

  private async loadTeams(project: string): Promise<void> {
    // get all the teams for a project
    const teams = await withAuthRetry(() => this.coreClient.getTeams(project, undefined, undefined, undefined, true));

    // for each team get the members
    // there is no endpoint currently available to retrieve the members as part of the team
    const promises = [];
    for (let k = 0; k < teams.length; k++) {
      const team = teams[k];
      const promise = withAuthRetry(() => this.coreClient.getTeamMembersWithExtendedProperties(project, team.id));

      promises.push(promise.then((members) => {
        // Keep the full identities (display name + avatar) of individual members
        // so they can populate the author/reviewer filter dropdowns on the
        // completed/abandoned tabs; skip nested group/container identities.
        members.forEach((member) => {
          const identity = member.identity;
          if (identity && identity.id && !(identity as any).isContainer) {
            this.memberIdentitiesById.set(identity.id, identity);
          }
        });

        team.identity.members = members.map(member => ({ identifier: member.identity.id, identityType: "user" }));

        return team;
      }));
    }

    // load members in parallel to make it faster.
    const result = await Promise.all(promises);

    // populate teams
    let allTeams = this.state.teamsList;
    for (let k = 0; k < result.length; k++) {
      const team = result[k];
      const teamMembers = team.identity.members;

      // do not add the team if it has no members
      if (teamMembers.length > 0) {
        allTeams[team.id] = {
          id: team.id,
          name: team.name,
          members: teamMembers.map(tm => tm.identifier)
        };
      }
    }

    // set the teams
    this.setState({
      teamsList: allTeams,
    });
  }

  private async loadAllProjects(): Promise<void> {
    // Ignore loads triggered while one is already in flight (e.g. hitting
    // Refresh repeatedly), otherwise each one appends its results on top
    // of the previous and every PR shows up duplicated
    if (this.loadInProgress) {
      return;
    }

    this.loadInProgress = true;

    // Keep the outgoing models around during a background refresh so the
    // rebuilt rows can be seeded with their already-loaded icons/tags
    // instead of flashing loading spinners
    this.previousPullRequests = this.silentRefresh
      ? this.state.pullRequests
      : [];
    this.silentRefreshFailed = false;
    this.authFailed = false;

    // The pool is rebuilt from scratch on every load, so drop the on-demand
    // caches: team-member identities are re-collected by loadTeams, and any
    // people fetched on demand must be re-fetched (filterPullRequests re-runs
    // afterwards and reloads whatever is still selected).
    this.fetchedPersonKeys.clear();
    this.memberIdentitiesById.clear();

    try {
      let { savedProjects } = this.state;
      this.setState({
        pullRequests: [],
      });

      const currentProjectId = localStorage.getItem(FILTER_STORE_KEY_NAME);
      const savedProjectsFilter = this.filter.getFilterItemValue<string[]>(
        "selectedProjects"
      );

      if (
        savedProjectsFilter !== undefined &&
        savedProjectsFilter.length > 0
      ) {
        savedProjects = savedProjectsFilter;
      }

      if (savedProjects.length === 0) {
        const projectService = await DevOps.getService<IProjectPageService>(
          getCommonServiceIdsValue("ProjectPageService")
        );

        const currentProject =
          currentProjectId && currentProjectId.length > 0
            ? currentProjectId
            : (await projectService.getProject())!.id;

        savedProjects.push(...[currentProject.toString()]);
      }

      for (let i = 0; i < savedProjects.length; i++) {
        await this.loadProject(savedProjects[i]);

        // Every remaining project would fail on the same stale token
        if (this.authFailed) {
          break;
        }
      }

      if (this.authFailed !== this.state.sessionExpired) {
        this.setState({ sessionExpired: this.authFailed });
      }

      // The pool was cleared above, so a failed background refresh (e.g. a
      // transient 503) would leave an empty table. Put the previous PRs back.
      if (this.silentRefresh && this.silentRefreshFailed) {
        const previousPullRequests = this.previousPullRequests;
        this.setState({ pullRequests: previousPullRequests }, () => {
          this.populateFilterBarFields(previousPullRequests);
          this.filterPullRequests();
        });
      }

      this.filter.setFilterItemState("selectedProjects", { value: savedProjects });
    } finally {
      this.loadInProgress = false;
      this.lastLoadCompleted = Date.now();
      this.previousPullRequests = [];
    }
  }

  private async loadProject(projectId: string): Promise<void> {
    const self = this;

    try {
      const projectRepos = await self.getRepositories(projectId);

      // load the teams before loading the pull requests
      // otherwise the filter saving does not properly persist
      await this.loadTeams(projectId);

      await this.getAllPullRequests(projectId, projectRepos);
    } catch (error) {
      this.handleError(error);
    }
  }

  private handleError(error: any): void {
    console.log(error);

    // Retries already re-requested the token, so the host's copy is stale.
    // Keep whatever is on screen and offer a reload via the session banner.
    if (isTransientAuthError(error)) {
      this.authFailed = true;
      if (this.silentRefresh) {
        this.silentRefreshFailed = true;
      } else {
        this.setState({ loading: false });
      }
      return;
    }

    // A background/auto refresh failing must not replace the table the user is
    // currently looking at with an error banner. Log it and keep the existing
    // data on screen; the next refresh (auto or manual) will recover.
    if (this.silentRefresh) {
      this.silentRefreshFailed = true;
      return;
    }

    this.setState({
      loading: false,
      errorMessage: "There was an error during the extension load: " + error,
    });
  }

  private async getRepositories(projectId: string): Promise<GitRepositoryModel[]> {
    const repos = (await withAuthRetry(() => this.gitClient.getRepositories(projectId, true)) as GitRepositoryModel[]).filter(r => r.isDisabled === undefined || r.isDisabled === false);
    const fetchedIds = new Set(repos.map((r) => r.id));

    // Swap in this project's repositories instead of clearing the whole list
    // at the start of each load, so a refresh doesn't blank the Repositories
    // filter while the new list is fetched
    const repositories = this.state.repositories
      .filter((r) => r.project.id !== projectId && !fetchedIds.has(r.id))
      .concat(repos)
      .sort(Data.sortTagRepoTeamProject);

    this.setState({
      repositories,
    });

    return repos;
  }

  private async getOrganizationBaseUrl() {

    if (this.baseUrl && this.baseUrl.length > 0) {
      return;
    }

    const oldOrgUrlFormat = AZDEVOPS_CLOUD_API_ORGANIZATION_OLD.replace(
      "[org]",
      DevOps.getHost().name
    );
    const url = new URL(document.referrer);

    console.log("Base URL reference: " + url.toString());

    if (
      url.origin !== AZDEVOPS_CLOUD_API_ORGANIZATION &&
      url.origin !== oldOrgUrlFormat
    ) {
      if (url.pathname.split("/")[1] === "tfs") {
        const collectionName = url.pathname.split("/")[2];
        this.baseUrl = `${url.origin}/tfs/${collectionName}/`;
      } else {
        const collectionName = url.pathname.split("/")[1];
        this.baseUrl = `${url.origin}/${collectionName}/`;
      }
    } else {
      const baseUrlFormat = `${AZDEVOPS_CLOUD_API_ORGANIZATION}/${AZDEVOPS_API_ORGANIZATION_RESOURCE}/?accountName=${
        DevOps.getHost().name
      }&api-version=5.0-preview.1`;

      await fetch(baseUrlFormat)
        .then((res) => res.json())
        .then((result) => {
          this.baseUrl = result.locationUrl;
        })
        .catch((error) => {
          this.handleError(
            "Unable to fetch Organization's URL. Details: " + error
          );
        });
    }

    console.log("Set base URL: " + this.baseUrl);
  }

  // Walk up from this tab's root to find the scrolling ancestor (the bolt Page
  // content area). Returns null when nothing is scrolled.
  private getScrollContainer(): HTMLElement | null {
    let element: HTMLElement | null = this.rootElementRef.current;

    while (element) {
      const overflowY = window.getComputedStyle(element).overflowY;

      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        element.scrollHeight > element.clientHeight
      ) {
        return element;
      }

      element = element.parentElement;
    }

    return null;
  }

  private reloadPullRequestItemProvider(
    newList: PullRequestModel.PullRequestModel[]
  ) {
    // A background (silent) refresh keeps the table on screen, but replacing
    // every row in the item provider makes the Table snap the scroll position
    // back to the top. Capture it here and restore it once the new rows are
    // committed so the user stays where they were.
    const scrollContainer = this.silentRefresh ? this.getScrollContainer() : null;
    const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    // Completed/abandoned models are built list-only (deferEnrichment) so the
    // whole history isn't enriched up front. Trigger the per-PR detail calls
    // for just the rows about to be shown; ensureEnriched() is idempotent, so
    // rows that are already loaded (or Active PRs) are unaffected.
    newList.forEach((pr) => pr.ensureEnriched());

    this.pullRequestItemProvider.splice(
      0,
      this.pullRequestItemProvider.length,
      ...newList
    );
    this.setState({
      pullRequestCount: newList.length,
    });

    // Only flag the count as capped while the full (unfiltered) truncated
    // list is showing — once filters trim it below the cap, the exact
    // count is accurate again
    this.props.onCountChange(
      newList.length,
      this.resultsCapped &&
        newList.length >= UserPreferencesInstance.topNumberCompletedAbandoned
    );

    if (scrollContainer) {
      // Restore after React has committed the new rows and the browser has
      // laid them out. The rows are seeded with their already-loaded content
      // during a silent refresh, so their height is stable and one frame is
      // enough.
      window.requestAnimationFrame(() => {
        scrollContainer.scrollTop = savedScrollTop;
      });
    }
  }

  // Fetch every Pull Request for a project in one paged query instead of one
  // request per repository. The per-repo approach fired hundreds of calls at
  // once on large projects and got throttled by Azure DevOps (issue #266);
  // this also pages through all results so nothing is silently dropped (#211).
  private async getProjectPullRequests(
    projectId: string,
    criteria: GitPullRequestSearchCriteria,
    top: number
  ): Promise<GitPullRequest[]> {
    const PAGE_SIZE = 1000;
    const limit = top > 0 ? top : Number.MAX_SAFE_INTEGER;
    const all: GitPullRequest[] = [];
    let skip = 0;

    while (all.length < limit) {
      const pageSize = Math.min(PAGE_SIZE, limit - all.length);
      // Bind the paging offset into a per-iteration const so the retry closure
      // does not capture the loop-mutated `skip` (no-loop-func).
      const pageSkip = skip;

      const page = await withAuthRetry(() =>
        this.gitClient.getPullRequestsByProject(
          projectId,
          criteria,
          10,
          pageSkip,
          pageSize
        )
      );

      if (!page || page.length === 0) {
        break;
      }

      all.push(...page);

      // A short page means we've reached the end of the results
      if (page.length < pageSize) {
        break;
      }

      skip += page.length;
    }

    return all;
  }

  // Callback each PullRequestModel fires when its data changes (labels arrive,
  // background enrichment completes). Folds new labels into the Tags filter and
  // re-runs the filter so the row reflects the update — unless we're mid bulk
  // build, where a single filterPullRequests() runs afterward instead.
  private onPullRequestModelUpdated = (
    updatedPr: PullRequestModel.PullRequestModel
  ) => {
    let { tagList } = this.state;
    updatedPr.labels
      .filter((t) => !this.hasFilterValue(tagList, t.id))
      .forEach((t) => {
        tagList.push(t);
        tagList = tagList.sort(Data.sortTagRepoTeamProject);

        return tagList;
      });

    this.setState({
      tagList,
    });

    if (!this.suppressFilterDuringBuild) {
      this.filterPullRequests();
    }
  };

  private async getAllPullRequests(
    projectId: string,
    repositories: GitRepositoryModel[]
  ) {
    // During a background refresh keep the current table on screen (the
    // existing item provider is updated in place once results arrive)
    // instead of clearing it and showing the spinner
    if (!this.silentRefresh) {
      this.setState({ loading: true });

      this.pullRequestItemProvider = new ObservableArray<
        | PullRequestModel.PullRequestModel
        | IReadonlyObservableValue<PullRequestModel.PullRequestModel | undefined>
      >([]);
    }

    let { pullRequests } = this.state;

    const newPullRequestList = Object.assign([], pullRequests);

    // clear the pull request list to be reloaded...
    newPullRequestList.splice(0, newPullRequestList.length);

    const criteria = Object.assign({}, Data.pullRequestCriteria);
    criteria.status = this.props.prType;
    const isCompletedOrAbandoned =
      this.props.prType === PullRequestStatus.Completed ||
      this.props.prType === PullRequestStatus.Abandoned;

    // Default view loads just the most recent N completed/abandoned PRs (cheap);
    // Active loads everything (top = 0). Individual authors/reviewers beyond this
    // window are fetched on demand when selected (see ensurePeopleLoaded).
    const top = isCompletedOrAbandoned
      ? UserPreferencesInstance.topNumberCompletedAbandoned
      : 0;

    // The by-project query returns PRs from disabled repositories too, so
    // restrict the results to the enabled repos we already resolved
    const enabledRepoIds = new Set(repositories.map((r) => r.id));

    try {
      const loadedPullRequests = (
        await this.getProjectPullRequests(projectId, criteria, top)
      ).filter((pr) => enabledRepoIds.has(pr.repository.id));

      if (loadedPullRequests.length > 0) {
        // Build the batch with the per-model filter callback suppressed, so the
        // initial triggerState() of each row doesn't fire N filter passes;
        // loadLists() runs filterPullRequests() once after the load.
        this.suppressFilterDuringBuild = true;
        const builtModels = PullRequestModel.PullRequestModel.getModels(
          loadedPullRequests,
          this.baseUrl,
          this.onPullRequestModelUpdated,
          this.silentRefresh ? this.previousPullRequests : undefined,
          // Defer the per-PR detail calls for completed/abandoned: only the rows
          // actually displayed (the top-N default view or the on-demand filtered
          // matches) get enriched, via ensureEnriched() in
          // reloadPullRequestItemProvider.
          isCompletedOrAbandoned
        );
        this.suppressFilterDuringBuild = false;

        newPullRequestList.push(...builtModels);
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      if (newPullRequestList.length > 0) {
        const { sortOrder } = this.state;
        pullRequests.push(...newPullRequestList);

        // The full completed/abandoned history is kept in state so the filters
        // can feature everyone; the top-N preference is applied later as a
        // display-time cap (see filterPullRequests).
        pullRequests = pullRequests.sort((a, b) =>
          Data.sortPullRequests(a, b, sortOrder)
        );

        this.setState({
          pullRequests,
        });
      }

      await this.loadLists();
    }
  }

  private async loadLists() {
    const { pullRequests } = this.state;

    this.setState({
      loading: false
    });

    this.populateFilterBarFields(pullRequests);

    await this.loadSavedFilter();

    // Replace the table contents in a single atomic splice via
    // filterPullRequests() -> reloadPullRequestItemProvider(). Clearing the
    // provider to empty first (as we used to) flashed the "no PRs" state on
    // every refresh before the data was pushed back in.
    this.filterPullRequests();
  }

  private async filterPullRequests() {
    // Guards against a slow on-demand fetch below overwriting a newer filter run
    const seq = ++this.filterSequence;
    const { pullRequests } = this.state;

    const selectedProjectsFilter = this.filter.getFilterItemValue<string[]>(
      "selectedProjects"
    );

    const repositoriesFilter = this.filter.getFilterItemValue<string[]>(
      "selectedRepos"
    );
    const filterPullRequestTitle = this.filter.getFilterItemValue<string>(
      "pullRequestTitle"
    );
    const sourceBranchFilter = this.filter.getFilterItemValue<string[]>(
      "selectedSourceBranches"
    );
    const targetBranchFilter = this.filter.getFilterItemValue<string[]>(
      "selectedTargetBranches"
    );
    const createdByFilter = this.filter.getFilterItemValue<string[]>(
      "selectedAuthors"
    );
    const teamsFilter = this.filter.getFilterItemValue<string[]>(
      "selectedTeams"
    );
    const reviewersFilter = this.filter.getFilterItemValue<string[]>(
      "selectedReviewers"
    );
    const myApprovalStatusFilter = this.filter.getFilterItemValue<string[]>(
      "selectedMyApprovalStatuses"
    );
    const selectedAlternateStatusPrFilter = this.filter.getFilterItemValue<
      string[]
    >("selectedAlternateStatusPr");
    const selectedTagsFilter = this.filter.getFilterItemValue<string[]>(
      "selectedTags"
    );

    const isCompletedOrAbandoned =
      this.props.prType === PullRequestStatus.Completed ||
      this.props.prType === PullRequestStatus.Abandoned;

    // On completed/abandoned, an author/reviewer picked from the (team-member)
    // dropdown may have PRs outside the loaded top-N. Fetch just their PRs on
    // demand and merge them into the pool before filtering client-side.
    let pool = pullRequests;

    if (
      isCompletedOrAbandoned &&
      ((createdByFilter && createdByFilter.length > 0) ||
        (reviewersFilter && reviewersFilter.length > 0))
    ) {
      pool = await this.ensurePeopleLoaded(
        createdByFilter || [],
        reviewersFilter || []
      );

      // A newer filter run started while we were fetching — let it render.
      if (seq !== this.filterSequence) {
        return;
      }
    }

    let filteredPullRequest = pool;

    if (selectedProjectsFilter && selectedProjectsFilter.length > 0) {
      filteredPullRequest = filteredPullRequest.filter((pr) => {
        const found = selectedProjectsFilter!.some((r) => {
          return pr.gitPullRequest.repository.project.id === r;
        });

        return found;
      });
    }

    if (filterPullRequestTitle && filterPullRequestTitle.length > 0) {
      filteredPullRequest = pullRequests.filter((pr) => {
        const found =
          pr
            .title!.toLocaleLowerCase()
            .indexOf(filterPullRequestTitle.toLocaleLowerCase()) > -1;
        return found;
      });
    }

    if (repositoriesFilter && repositoriesFilter.length > 0) {
      filteredPullRequest = filteredPullRequest.filter((pr) => {
        const found = repositoriesFilter!.some((r) => {
          return pr.gitPullRequest.repository.id === r;
        });

        return found;
      });
    }

    if (sourceBranchFilter && sourceBranchFilter.length > 0) {
      filteredPullRequest = filteredPullRequest.filter((pr) => {
        const found = sourceBranchFilter.some((r) => {
          return pr.sourceBranch!.displayName === r;
        });

        return found;
      });
    }

    if (targetBranchFilter && targetBranchFilter.length > 0) {
      filteredPullRequest = filteredPullRequest.filter((pr) => {
        const found = targetBranchFilter.some((r) => {
          return pr.targetBranch!.displayName === r;
        });

        return found;
      });
    }

    if (createdByFilter && createdByFilter.length > 0) {
      filteredPullRequest = filteredPullRequest.filter((pr) => {
        const found = createdByFilter.some((r) => {
          return pr.gitPullRequest.createdBy.id === r;
        });

        return found;
      });
    }

    if (teamsFilter && teamsFilter.length > 0) {
      filteredPullRequest = filteredPullRequest.filter((pr) => {
        const found = teamsFilter.some((r) => {
          const team: TeamRef = JSON.parse(r);

          return team.members.some(m => {
            return pr.gitPullRequest.createdBy.id === m;
          });
        });

        return found;
      });
    }

    if (reviewersFilter && reviewersFilter.length > 0) {
      filteredPullRequest = filteredPullRequest.filter((pr) => {
        const found = reviewersFilter.some((r) => {
          return pr.gitPullRequest.reviewers.some((rv) => {
            return rv.id === r;
          });
        });
        return found;
      });
    }

    if (myApprovalStatusFilter && myApprovalStatusFilter.length > 0) {
      filteredPullRequest = filteredPullRequest.filter((pr) => {
        const found = myApprovalStatusFilter.some((vote) => {
          return (
            pr.myApprovalStatus ===
            (parseInt(vote, 10) as Data.ReviewerVoteOption)
          );
        });
        return found;
      });
    }

    if (
      selectedAlternateStatusPrFilter &&
      selectedAlternateStatusPrFilter.length > 0
    ) {
      filteredPullRequest = filteredPullRequest.filter((pr) => {
        const found = selectedAlternateStatusPrFilter.some((item) => {
          return (
            (pr.gitPullRequest.isDraft === true &&
              item === Data.AlternateStatusPr.IsDraft) ||
            (hasPullRequestFailure(pr) === true &&
              item === Data.AlternateStatusPr.Conflicts) ||
            (pr.isAutoCompleteSet === true &&
              item === Data.AlternateStatusPr.AutoComplete) ||
            (pr.gitPullRequest.isDraft === false &&
              item === Data.AlternateStatusPr.NotIsDraft) ||
            (hasPullRequestFailure(pr) === false &&
              item === Data.AlternateStatusPr.NotConflicts) ||
            (pr.isAutoCompleteSet === false &&
              item === Data.AlternateStatusPr.NotAutoComplete) ||
            (pr.isAllPoliciesOk === true &&
              item === Data.AlternateStatusPr.ReadForCompletion &&
              pr.hasFailures === false) ||
            (item === Data.AlternateStatusPr.NotReadyForCompletion &&
              (pr.hasFailures === true || pr.isAllPoliciesOk === false)) ||
            (item === Data.AlternateStatusPr.HasNewChanges &&
              pr.hasNewChanges())
          );
        });
        return found;
      });
    }

    if (selectedTagsFilter && selectedTagsFilter.length > 0) {
      filteredPullRequest = filteredPullRequest.filter((pr) => {
        const found = selectedTagsFilter.some((item) => {
          return this.hasFilterValue(pr.labels, item);
        });
        return found;
      });
    }

    // Cap the *default* completed/abandoned view to the top-N most recent for
    // performance, but only when the user hasn't narrowed the list — any active
    // filter beyond the base project scope reveals all matching PRs. Project
    // selection is the always-present scope, so it does not count as narrowing.
    const hasNarrowingFilter = !!(
      (repositoriesFilter && repositoriesFilter.length > 0) ||
      (filterPullRequestTitle && filterPullRequestTitle.length > 0) ||
      (sourceBranchFilter && sourceBranchFilter.length > 0) ||
      (targetBranchFilter && targetBranchFilter.length > 0) ||
      (createdByFilter && createdByFilter.length > 0) ||
      (teamsFilter && teamsFilter.length > 0) ||
      (reviewersFilter && reviewersFilter.length > 0) ||
      (myApprovalStatusFilter && myApprovalStatusFilter.length > 0) ||
      (selectedAlternateStatusPrFilter &&
        selectedAlternateStatusPrFilter.length > 0) ||
      (selectedTagsFilter && selectedTagsFilter.length > 0)
    );

    const maxCount = UserPreferencesInstance.topNumberCompletedAbandoned;

    if (
      isCompletedOrAbandoned &&
      !hasNarrowingFilter &&
      maxCount > 0 &&
      filteredPullRequest.length > maxCount
    ) {
      this.resultsCapped = true;
      // Select the N most recent by age (independent of the display sort),
      // then re-apply the user's chosen sort order for display.
      filteredPullRequest = [...filteredPullRequest]
        .sort(Data.comparePullRequestAge)
        .slice(0, maxCount)
        .sort((a, b) => Data.sortPullRequests(a, b, this.state.sortOrder));
    } else {
      this.resultsCapped = false;
    }

    this.reloadPullRequestItemProvider(filteredPullRequest);
  }

  // Fetch the completed/abandoned PRs created/reviewed by the given people (only
  // those not already loaded) and merge them into the in-memory pool so the
  // client-side filter can match them. The default view only loads the most
  // recent N, so a person picked from the team-member dropdown may have no PRs
  // in memory yet. Returns the resulting pool. Serialized via personFetchInFlight
  // so concurrent filter runs don't double-fetch or double-merge.
  private async ensurePeopleLoaded(
    authorIds: string[],
    reviewerIds: string[]
  ): Promise<PullRequestModel.PullRequestModel[]> {
    const needed = [
      ...authorIds.map((id) => ({ key: `c:${id}`, isCreator: true, id })),
      ...reviewerIds.map((id) => ({ key: `r:${id}`, isCreator: false, id })),
    ].filter((k) => !this.fetchedPersonKeys.has(k.key));

    if (needed.length === 0) {
      return this.state.pullRequests;
    }

    // One fetch batch at a time; wait out any in-flight batch, then re-check —
    // it may have already loaded some of what we need.
    while (this.personFetchInFlight) {
      await this.personFetchInFlight;
    }

    const stillNeeded = needed.filter(
      (k) => !this.fetchedPersonKeys.has(k.key)
    );

    if (stillNeeded.length === 0) {
      return this.state.pullRequests;
    }

    // Capture the refresh seed up front — loadAllProjects clears it in its
    // finally, which may run before this async work builds its models.
    const seed = this.silentRefresh ? this.previousPullRequests : undefined;

    let mergedPool = this.state.pullRequests;

    this.personFetchInFlight = (async () => {
      const projectIds = Array.from(
        new Set(this.state.repositories.map((r) => r.project.id))
      );
      const enabledRepoIds = new Set(
        this.state.repositories.map((r) => r.id)
      );

      const fetchedPrs: GitPullRequest[] = [];

      for (const person of stillNeeded) {
        for (const projectId of projectIds) {
          const criteria = Object.assign({}, Data.pullRequestCriteria);
          criteria.status = this.props.prType;

          if (person.isCreator) {
            criteria.creatorId = person.id;
          } else {
            criteria.reviewerId = person.id;
          }

          try {
            const prs = (
              await this.getProjectPullRequests(projectId, criteria, 0)
            ).filter((pr) => enabledRepoIds.has(pr.repository.id));

            fetchedPrs.push(...prs);
          } catch (error) {
            this.handleError(error);
          }
        }
      }

      const pool = this.state.pullRequests;
      const existingKeys = new Set(
        pool.map(
          (m) =>
            `${m.gitPullRequest.repository.id}_${m.gitPullRequest.pullRequestId}`
        )
      );

      // A PR can come back for more than one person/project — dedup the fetched
      // set and drop anything already in the pool.
      const freshPrs: GitPullRequest[] = [];
      const seenKeys = new Set<string>();
      fetchedPrs.forEach((pr) => {
        const key = `${pr.repository.id}_${pr.pullRequestId}`;
        if (!existingKeys.has(key) && !seenKeys.has(key)) {
          seenKeys.add(key);
          freshPrs.push(pr);
        }
      });

      if (freshPrs.length > 0) {
        this.suppressFilterDuringBuild = true;
        const freshModels = PullRequestModel.PullRequestModel.getModels(
          freshPrs,
          this.baseUrl,
          this.onPullRequestModelUpdated,
          seed,
          true // list-only; enriched when displayed
        );
        this.suppressFilterDuringBuild = false;

        mergedPool = [...pool, ...freshModels].sort((a, b) =>
          Data.sortPullRequests(a, b, this.state.sortOrder)
        );

        this.setState({ pullRequests: mergedPool });
      } else {
        mergedPool = pool;
      }

      stillNeeded.forEach((k) => this.fetchedPersonKeys.add(k.key));
    })();

    try {
      await this.personFetchInFlight;
    } finally {
      this.personFetchInFlight = null;
    }

    return mergedPool;
  }

  private hasFilterValue(
    list: Array<
      | Data.BranchDropDownItem
      | IdentityRef
      | IdentityRefWithVote
      | WebApiTagDefinition
    >,
    value: any
  ): boolean {
    return list.some((item) => {
      if (item.hasOwnProperty("id")) {
        const convertedValue = item as IdentityRef | WebApiTagDefinition;
        return convertedValue.id.localeCompare(value) === 0;
      } else if (item.hasOwnProperty("branchName")) {
        const convertedValue = item as Data.BranchDropDownItem;
        return convertedValue.displayName.localeCompare(value) === 0;
      } else {
        return item === value;
      }
    });
  }

  private populateFilterBarFields = (
    pullRequests: PullRequestModel.PullRequestModel[]
  ) => {
    let {
      sourceBranchList,
      targetBranchList,
      createdByList,
      reviewerList,
    } = this.state;

    sourceBranchList = [];
    targetBranchList = [];
    createdByList = [];
    reviewerList = [];

    pullRequests.forEach((pr) => {
      let found = this.hasFilterValue(
        createdByList,
        pr.gitPullRequest.createdBy.id
      );

      if (found === false) {
        createdByList.push(pr.gitPullRequest.createdBy);
      }

      found = this.hasFilterValue(
        sourceBranchList,
        pr.sourceBranch!.displayName
      );

      if (found === false) {
        sourceBranchList.push(pr.sourceBranch!);
      }

      found = this.hasFilterValue(
        targetBranchList,
        pr.targetBranch!.displayName
      );

      if (found === false) {
        targetBranchList.push(pr.targetBranch!);
      }

      if (
        pr.gitPullRequest.reviewers &&
        pr.gitPullRequest.reviewers.length > 0
      ) {
        pr.gitPullRequest.reviewers.map((r) => {
          found = this.hasFilterValue(reviewerList, r.id);

          if (found === false) {
            reviewerList.push(r);
          }

          return r;
        });
      }

      return pr;
    });

    // On the completed/abandoned tabs only the most recent N PRs are loaded up
    // front, so deriving the author/reviewer dropdowns purely from them would
    // hide everyone else. Add the project's team members (their PRs are fetched
    // on demand when selected — see ensurePeopleLoaded), unioned with the
    // authors/reviewers already present in the loaded set.
    const isCompletedOrAbandoned =
      this.props.prType === PullRequestStatus.Completed ||
      this.props.prType === PullRequestStatus.Abandoned;

    if (isCompletedOrAbandoned) {
      this.memberIdentitiesById.forEach((identity) => {
        if (!this.hasFilterValue(createdByList, identity.id)) {
          createdByList.push(identity);
        }

        if (!this.hasFilterValue(reviewerList, identity.id)) {
          reviewerList.push({ ...identity, vote: 0 } as IdentityRefWithVote);
        }
      });
    }

    sourceBranchList = sourceBranchList.sort(Data.sortBranchOrIdentity);
    targetBranchList = targetBranchList.sort(Data.sortBranchOrIdentity);
    createdByList = createdByList.sort(Data.sortBranchOrIdentity);
    reviewerList = reviewerList.sort(Data.sortBranchOrIdentity);

    this.setState({
      sourceBranchList,
      targetBranchList,
      createdByList,
      reviewerList,
    });
  };

  refresh = async () => {
    await this.loadAllProjects();
  };

  onHelpDismiss = () => {
    this.isDialogOpen.value = false;
  };

  public render(): JSX.Element {
    const {
      pullRequests,
      projects,
      repositories,
      createdByList,
      teamsList,
      sourceBranchList,
      targetBranchList,
      reviewerList,
      loading,
      errorMessage,
      sessionExpired,
      tagList,
    } = this.state;

    if (loading === true) {
      return (
        <div className="absolute-fill flex-column flex-grow flex-center justify-center">
          <Spinner size={SpinnerSize.large} label="loading..." />
        </div>
      );
    }

    return (
      <div className="flex-column" ref={this.rootElementRef}>
        <FilterBarHub
          filterPullRequests={() => {
            this.initializePage();
            this.props.showToastMessage(`Filters have been restored to its original state.`);
          }}
          pullRequests={pullRequests}
          filter={this.filter}
          selectedProjectChanged={this.selectedProjectChanged}
          selectedProject={this.selectedProjects}
          projects={projects}
          repositories={repositories}
          sourceBranchList={sourceBranchList}
          targetBranchList={targetBranchList}
          createdByList={createdByList}
          teamsList={teamsList}
          reviewerList={reviewerList}
          selectedMyApprovalStatuses={this.selectedMyApprovalStatuses}
          selectedAlternateStatusPr={this.selectedAlternateStatusPr}
          tagList={tagList}
        />

        {sessionExpired ? (
          <div className="flex-grow margin-top-8">
            <br />
            <MessageCard
              className="flex-self-stretch"
              severity={MessageCardSeverity.Warning}
              buttonProps={[{ text: "Reload", onClick: this.reloadPage }]}
            >
              Your Azure DevOps session token has expired, so pull requests could not be refreshed. Reload the page to continue.
            </MessageCard>
          </div>
        ) : null}

        {errorMessage.length > 0 ? (
          <ShowErrorMessage
            errorMessage={errorMessage}
            onDismiss={this.resetErrorMessage}
          />
        ) : null}

        <div className="margin-top-8">
          <br />
          {this.getRenderContent()}
        </div>
      </div>
    );
  }

  reloadPage = async () => {
    const navigationService = await DevOps.getService<IHostNavigationService>(
      getCommonServiceIdsValue("HostNavigationService")
    );
    navigationService.reload();
  };

  resetErrorMessage = () => {
    this.setState({
      errorMessage: "",
    });
  };

  async selectedProjectChanged(
    _event: React.SyntheticEvent<HTMLElement, Event>,
    item: IListBoxItem<TeamProjectReference | ProjectInfo>
  ) {
    let { savedProjects } = this.state;
    const foundIndex = savedProjects.findIndex((p) => p === item.id);

    if (foundIndex < 0) {
      savedProjects.push(item.id);

      this.setState({
        savedProjects,
      });

      await this.loadProject(item.id);
    }
  }

  getRenderContent() {
    const { pullRequestCount, pullRequests } = this.state;

    // Create the sorting behavior (delegate that is called when a column is sorted).
    const sortingBehavior = new ColumnSorting<
      PullRequestModel.PullRequestModel
    >((columnIndex: number, proposedSortOrder: SortOrder) => {
      // Sort the cached list, then re-apply the active filters so the view is
      // only reordered. Sorting straight into the provider from the full
      // unfiltered cache used to reintroduce PRs the user had filtered out
      // (#251, #215). The setState callback ensures filterPullRequests() reads
      // the freshly sorted cache.
      const sortedPullRequests = sortItems<PullRequestModel.PullRequestModel>(
        columnIndex,
        proposedSortOrder,
        this.sortFunctions,
        this.columns,
        this.state.pullRequests
      );

      this.setState(
        { pullRequests: sortedPullRequests, sortOrder: proposedSortOrder },
        () => this.filterPullRequests()
      );
    });

    if (
      pullRequestCount === 0 &&
      pullRequests.filter((pr) => pr.isStillLoading() === true).length === 0
    ) {
      return (
        <ZeroData
          primaryText="Yeah! No Pull Request to be reviewed. Well done!"
          secondaryText={
            <span>
              Enjoy your free time to code and raise PRs for your team/project!
            </span>
          }
          imageAltText="No PRs!"
          imagePath={require("../images/emptyPRList.png")}
          actionText="Refresh"
          actionType={getZeroDataActionTypeValue("ctaButton")}
          onActionClick={this.refresh}
        />
      );
    } else {
      return (
        <Card
          key={this.props.prType}
          className="flex-grow bolt-table-card"
          contentProps={{ contentPadding: false }}
          headerCommandBarItems={this.listHeaderColumns}
        >
          <React.Fragment>
            <Table<PullRequestModel.PullRequestModel>
              key={this.props.prType}
              behaviors={[sortingBehavior]}
              columns={this.columns}
              itemProvider={this.pullRequestItemProvider}
              showLines={true}
              selection={this.prRowSelecion}
              singleClickActivation={true}
              role="table"
            />
          </React.Fragment>

          <Observer isDialogOpen={this.isDialogOpen}>
            {(props: { isDialogOpen: boolean }) => {
              return props.isDialogOpen ? (
                <Dialog
                  titleProps={{ text: "Help!" }}
                  contentSize={ContentSize.Auto}
                  footerButtonProps={[
                    {
                      text: "Close",
                      onClick: this.onHelpDismiss,
                    },
                  ]}
                  onDismiss={this.onHelpDismiss}
                >
                  <strong>Statuses legend:</strong>
                  <div className="flex-column" style={{ minWidth: "120px" }}>
                    <div className="flex-row body-m secondary-text margin-top-8">
                      <div className="flex-column" style={{ width: "40px" }}>
                        <Status
                          {...Statuses.Waiting}
                          key="waiting"
                          size={getStatusSizeValue("m")}
                          className="status-example flex-self-center "
                        />
                      </div>
                      <div className="flex-column">
                        &nbsp;No one has voted yet.
                      </div>
                    </div>
                    <div className="flex-row body-m secondary-text margin-top-8">
                      <div className="flex-column" style={{ width: "40px" }}>
                        <Status
                          {...Statuses.Running}
                          key="running"
                          size={getStatusSizeValue("m")}
                          className="status-example flex-self-center "
                        />
                      </div>
                      <div className="flex-column">
                        &nbsp;Review in progress, not all required reviwers have
                        approved or policies are passed.
                      </div>
                    </div>
                    <div className="flex-row body-m secondary-text margin-top-8">
                      <div className="flex-column" style={{ width: "40px" }}>
                        <Status
                          {...Statuses.Success}
                          key="success"
                          size={getStatusSizeValue("m")}
                          className="status-example flex-self-center "
                        />
                      </div>
                      <div className="flex-column">
                        &nbsp;Ready for completion.
                      </div>
                    </div>
                    <div className="flex-row body-m secondary-text margin-top-8">
                      <div className="flex-column" style={{ width: "40px" }}>
                        <Status
                          {...Statuses.Warning}
                          key="warning"
                          size={getStatusSizeValue("m")}
                          className="status-example flex-self-center "
                        />
                      </div>
                      <div className="flex-column">
                        &nbsp;At least one reviewer is Waiting For Author.
                      </div>
                    </div>
                    <div className="flex-row body-m secondary-text margin-top-8">
                      <div className="flex-column" style={{ width: "40px" }}>
                        <Status
                          {...Statuses.Failed}
                          key="failed"
                          size={getStatusSizeValue("m")}
                          className="status-example flex-self-center "
                        />
                      </div>
                      <div className="flex-column">
                        &nbsp;One or more members has rejected or there is a
                        failure in some policy or status.
                      </div>
                    </div>
                  </div>
                </Dialog>
              ) : null;
            }}
          </Observer>
        </Card>
      );
    }
  }

  sortFunctions = [
    null, //Status column
    null, // Title column
    null, // Details column
    // Sort on When column
    Data.comparePullRequestAge,
    null, // Reviewers column
  ];

  columns: ITableColumn<PullRequestModel.PullRequestModel>[] = [
    {
      id: "status",
      name: "",
      renderCell: StatusColumn,
      readonly: true,
      width: -4,
      minWidth: -4,
      columnStyle: TableColumnStyle.Primary,
    },
    {
      id: "title",
      name: "Pull Request",
      renderCell: TitleColumn,
      readonly: true,
      width: -46,
    },
    {
      className: "pipelines-two-line-cell",
      id: "details",
      name: "Details",
      renderCell: DetailsColumn,
      width: -20,
    },
    {
      id: "time",
      name: "When",
      readonly: true,
      renderCell: DateColumn,
      width: -10,
      sortProps: {
        ariaLabelAscending: "Sorted new to older",
        ariaLabelDescending: "Sorted older to new",
        sortOrder: this.getDefaultSortOrder(),
      },
    },
    {
      id: "reviewers",
      name: "Reviewers",
      renderCell: ReviewersColumn,
      width: -20,
    },
  ];

  private listHeaderColumns: IHeaderCommandBarItem[] = [
    {
      id: "refresh",
      text: "",
      isPrimary: true,
      tooltipProps: { text: "Refresh the list" },
      onActivate: () => {
        this.refresh();
      },
      iconProps: {
        iconName: "fabric-icon ms-Icon--Refresh",
      },
    },
    {
      id: "help",
      text: "Help",
      isPrimary: false,
      tooltipProps: { text: "Help" },
      onActivate: () => {
        this.isDialogOpen.value = true;
      },
      iconProps: {
        iconName: "fabric-icon ms-Icon--Help",
      },
    },
  ];
}
