import {
  GitPullRequest,
  IdentityRefWithVote,
  GitCommitRef,
  CommentThreadStatus,
  PullRequestStatus,
} from "azure-devops-extension-api/Git/Git";
import * as DevOps from "azure-devops-extension-sdk";
import { Statuses } from "azure-devops-ui/Status";
import { getClient } from "azure-devops-extension-api";
import { GitRestClient } from "azure-devops-extension-api/Git/GitClient";
import { hasPullRequestFailure } from "./constants";
import {
  BranchDropDownItem,
  ReviewerVoteOption,
  IStatusIndicatorData,
  PullRequestComment,
  PullRequestPolicy,
} from "../tabs/PulRequestsTabData";
import { WebApiTagDefinition } from "azure-devops-extension-api/Core/Core";
import { USER_SETTINGS_STORE_KEY } from "../common";
import { getEvaluationsPerPullRequest } from "../services/AzureGitServices";
import { EvaluationPolicyType } from "./GitModels";
import { GitRepository } from 'azure-devops-extension-api/Git/Git';
import { compare } from "../lib/date";

export interface GitRepositoryModel extends GitRepository {
  isDisabled: boolean | undefined;
}

export class PullRequestModel {
  private baseHostUrl: string = "";
  public title?: string;
  public pullRequestHref?: string;
  public repositoryHref?: string;
  public sourceBranch?: BranchDropDownItem;
  public targetBranch?: BranchDropDownItem;
  public sourceBranchHref?: string;
  public targetBranchHref?: string;
  public myApprovalStatus?: ReviewerVoteOption;
  public currentUser: DevOps.IUserContext = DevOps.getUser();
  public lastCommitId?: string;
  public lastShortCommitId?: string;
  public lastCommitUrl?: string;
  public pullRequestProgressStatus?: IStatusIndicatorData;
  public lastCommitDetails: GitCommitRef | undefined;
  public isAutoCompleteSet: boolean = false;
  public comment: PullRequestComment;
  public policies: PullRequestPolicy[] = [];
  public isAllPoliciesOk: boolean = false;
  public hasFailures: boolean = false;
  public labels: WebApiTagDefinition[] = [];
  public lastVisit?: Date;
  // The status icon waits on the policy evaluation; the Tags filter waits on
  // labels. Everything else simply renders in once it arrives.
  private loadingPolicies: boolean = false;
  private loadingLabels: boolean = false;
  private requiredReviewers: IdentityRefWithVote[] = [];
  // Whether this model was seeded from a previous refresh (kept so deferred
  // enrichment can decide whether to show spinners).
  private seeded: boolean = false;
  // Guards ensureEnriched() so the background detail calls fire at most once.
  private enrichmentStarted: boolean = false;

  constructor(
    public gitPullRequest: GitPullRequest,
    public projectName: string,
    public baseUrl: string,
    public callbackState: (pullRequestModel: PullRequestModel) => void,
    private previousModel?: PullRequestModel,
    // When true the model is built from list data only and does NOT fire its
    // background detail calls until ensureEnriched() is called (once the row is
    // actually displayed). This keeps large completed/abandoned fetches from
    // firing ~4 API calls per PR up front. See PullRequestsTab.
    private deferEnrichment: boolean = false
  ) {
    this.comment = new PullRequestComment();
    this.setupPullRequest();
  }

  public saveLastVisit = (): boolean => {
    try {
      if (this.gitPullRequest.status !== PullRequestStatus.Active) {
        return true;
      }

      this.lastVisit = new Date();
      const storeKey = `${USER_SETTINGS_STORE_KEY}_${this.gitPullRequest.pullRequestId}`;
      localStorage.setItem(storeKey, JSON.stringify(this.lastVisit));

      return true;
    } catch (error) {
      return false;
    }
  };

  public hasNewChanges(): boolean {
    return this.hasCommitChanges() || this.hasCommentChanges() ? true : false;
  }

  public hasCommentChanges(): boolean {
    return this.lastVisit &&
      this.comment.lastUpdatedDate &&
      this.comment.lastUpdatedDate > this.lastVisit
      ? true
      : false;
  }

  public hasCommitChanges(): boolean {
    return this.lastVisit &&
      this.gitPullRequest.status === PullRequestStatus.Active &&
      this.lastVisit < this.getLastCommitDate()
      ? true
      : false;
  }

  public loadLastVisit = () => {
    if (this.gitPullRequest.status !== PullRequestStatus.Active) {
      return;
    }

    const storeKey = `${USER_SETTINGS_STORE_KEY}_${this.gitPullRequest.pullRequestId}`;
    const cachedInstance = localStorage.getItem(storeKey);

    if (!cachedInstance || cachedInstance.length === 0) {
      return;
    }

    const cachedLastVisit: Date = JSON.parse(cachedInstance);
    const savedDate = new Date(cachedLastVisit.toString());

    this.lastVisit = savedDate;
  };

  public getLastCommitDate(): Date {
    return this.lastCommitDetails === undefined ||
      this.lastCommitDetails.committer === undefined
      ? this.gitPullRequest.creationDate
      : this.lastCommitDetails!.committer.date!;
  }

  public triggerState() {
    this.pullRequestProgressStatus = this.getStatusIndicatorData(
      this.gitPullRequest.reviewers,
      this.isAllPoliciesOk
    );
    this.callbackState(this);
  }

  public isStillLoading() {
    return this.loadingPolicies;
  }

  public isLoadingLabels() {
    return this.loadingLabels;
  }

  public setupPullRequest() {
    this.seeded = this.previousModel !== undefined;

    if (this.previousModel !== undefined) {
      this.seedFromPreviousModel(this.previousModel);
      // Release the reference so models don't chain across refreshes
      this.previousModel = undefined;
    }

    this.initializeData();

    if (this.deferEnrichment) {
      // Render the row with the base list data now; the background detail
      // calls are held back until ensureEnriched() is called once the row is
      // actually displayed.
      this.triggerState();
      return;
    }

    this.ensureEnriched();
  }

  // Fire the per-PR background detail calls (labels, additional details,
  // threads, policies). Idempotent: safe to call every time the row is
  // (re)displayed — the work runs at most once.
  public ensureEnriched() {
    if (this.enrichmentStarted) {
      return;
    }

    this.enrichmentStarted = true;

    const abandoned =
      this.gitPullRequest.status === PullRequestStatus.Abandoned;

    // When seeded from a previous model (background refresh) the row keeps its
    // existing status/tags while the calls below quietly refresh them, so no
    // spinners. Otherwise spin only the pieces that gate UI: the status icon
    // waits on policies, the Tags filter waits on labels. Everything else
    // (comment counts, new-commit pills) simply pops in once it arrives.
    this.loadingPolicies = !this.seeded && !abandoned;
    this.loadingLabels = !this.seeded;

    // Render the row immediately with the base list data; each background
    // call fills in independently and refreshes the row as it completes.
    this.triggerState();
    this.loadDetailsInBackground(abandoned);
  }

  private loadDetailsInBackground(abandoned: boolean) {
    // Labels apply to every PR (including abandoned) and gate the Tags filter
    this.getLabels().finally(() => {
      this.loadingLabels = false;
      this.triggerState();
    });

    if (abandoned) {
      return;
    }

    // Auto-complete flag + last commit (drives the "new commit(s)" pill)
    this.getPullRequestAdditionalDetailsAsync().finally(() =>
      this.triggerState()
    );

    // Comment thread counts + "new comments" pill
    this.getPullRequestThreadAsync().finally(() => this.triggerState());

    // Policy status drives the row's status icon
    this.getPullRequestPolicyAsync()
      .catch((error) => {
        console.log(
          "There was an error calling the Pull Request policies (method: getPullRequestPolicyAsync)."
        );
        console.log(error);
      })
      .finally(() => {
        this.loadingPolicies = false;
        this.triggerState();
      });
  }

  private seedFromPreviousModel(previous: PullRequestModel) {
    this.isAutoCompleteSet = previous.isAutoCompleteSet;
    this.lastCommitDetails = previous.lastCommitDetails;
    this.comment = previous.comment;
    this.policies = previous.policies;
    this.isAllPoliciesOk = previous.isAllPoliciesOk;
    this.labels = previous.labels;
  }

  private initializeData() {
    this.baseHostUrl = `${this.baseUrl}${this.projectName}`;
    this.title = `${this.gitPullRequest.pullRequestId} - ${this.gitPullRequest.title}`;
    this.sourceBranch = new BranchDropDownItem(
      this.gitPullRequest.repository.name,
      this.gitPullRequest.sourceRefName
    );
    this.targetBranch = new BranchDropDownItem(
      this.gitPullRequest.repository.name,
      this.gitPullRequest.targetRefName
    );

    // Prefer the repository's own web URL. Reconstructing links from the page
    // URL drops the IIS virtual directory / collection on on-prem Azure DevOps
    // Server, producing broken links (issue #204). Fall back to the assembled
    // URL when webUrl isn't provided.
    const repositoryWebUrl =
      this.gitPullRequest.repository.webUrl &&
      this.gitPullRequest.repository.webUrl.length > 0
        ? this.gitPullRequest.repository.webUrl
        : `${this.baseHostUrl}/_git/${this.gitPullRequest.repository.name}`;

    this.repositoryHref = `${repositoryWebUrl}/`;
    this.pullRequestHref = `${repositoryWebUrl}/pullrequest/${this.gitPullRequest.pullRequestId}`;
    this.sourceBranchHref = `${repositoryWebUrl}?version=GB${this.sourceBranch.branchName}`;
    this.targetBranchHref = `${repositoryWebUrl}?version=GB${this.targetBranch.branchName}`;
    this.requiredReviewers = this.gitPullRequest.reviewers
      ? this.gitPullRequest.reviewers.filter(
          (r) => r.isRequired !== undefined && r.isRequired === true
        )
      : [];
    this.myApprovalStatus = this.getCurrentUserVoteStatus(
      this.gitPullRequest.reviewers
    );
    this.pullRequestProgressStatus = this.getStatusIndicatorData(
      this.gitPullRequest.reviewers,
      this.isAllPoliciesOk
    );
    this.lastShortCommitId = this.gitPullRequest.lastMergeSourceCommit.commitId.substr(
      0,
      8
    );
    this.lastCommitUrl = `${repositoryWebUrl}/commit/${this.gitPullRequest.lastMergeSourceCommit.commitId}?refName=GB${this.gitPullRequest.sourceRefName}`;
    this.hasFailures = hasPullRequestFailure(this);
    this.loadLastVisit();
  }

  private getCurrentUserVoteStatus(
    reviewers: IdentityRefWithVote[]
  ): ReviewerVoteOption {
    let voteResult = ReviewerVoteOption.NoVote;
    if (reviewers && reviewers.length > 0) {
      const currentUserReviewer = reviewers.filter(
        (r) => r.id === this.currentUser.id
      );

      if (currentUserReviewer.length > 0) {
        voteResult = currentUserReviewer[0].vote as ReviewerVoteOption;
      }
    }

    return voteResult;
  }

  private getStatusIndicatorData(reviewers: IdentityRefWithVote[], isAllPoliciesOk: boolean): IStatusIndicatorData {
    const indicatorData: IStatusIndicatorData = {
      label: "Waiting Review",
      statusProps: { ...Statuses.Queued, ariaLabel: "Waiting Review" },
    };

    if (this.hasFailures) {
      indicatorData.statusProps = {
        ...Statuses.Failed,
        ariaLabel: "Pull Request is in failure status.",
      };
      indicatorData.label = "Pull Request is in failure status.";

      return indicatorData;
    }

    if (reviewers.some((r) => r.vote === ReviewerVoteOption.Rejected)) {
      indicatorData.statusProps = {
        ...Statuses.Failed,
        ariaLabel: "One or more reviewer(s) has rejected.",
      };
      indicatorData.label = "One or more reviewer(s) has rejected.";

      return indicatorData;
    }

    if (reviewers.some((r) => r.vote === ReviewerVoteOption.WaitingForAuthor)) {
      indicatorData.statusProps = {
        ...Statuses.Warning,
        ariaLabel: "One or more reviewer(s) is waiting for the author.",
      };
      indicatorData.label = "One or more reviewer(s) is waiting for the author.";

      return indicatorData;
    }

    if (this.requiredReviewers.every((r) => r.vote === ReviewerVoteOption.Approved || r.vote === ReviewerVoteOption.ApprovedWithSuggestions)  && isAllPoliciesOk) {
      indicatorData.statusProps = {
        ...Statuses.Success,
        ariaLabel: "Ready for completion",
      };
      indicatorData.label = "Success";

      return indicatorData;
    }

    if (isAllPoliciesOk === false) {
      indicatorData.statusProps = {
        ...Statuses.Running,
        ariaLabel: "Waiting all policies to be completed",
      };
      indicatorData.label = "Some policies are not completed";

      return indicatorData;
    }

    if (this.requiredReviewers.every((r) => r.vote === ReviewerVoteOption.NoVote)) {
      indicatorData.statusProps = {
        ...Statuses.Waiting,
        ariaLabel: "Waiting Review of required Reviewers",
      };
      indicatorData.label = "Waiting Review of required Reviewers";

      return indicatorData;
    }

    if (this.requiredReviewers.some((r) => r.vote === ReviewerVoteOption.NoVote)) {
      indicatorData.statusProps = {
        ...Statuses.Running,
        ariaLabel: "Waiting remaining required Reviewers",
      };
      indicatorData.label = "Review in progress";

      return indicatorData;
    }

    return indicatorData;
  }

  private async getPullRequestAdditionalDetailsAsync() {
    const gitClient: GitRestClient = getClient(GitRestClient);
    let self = this;

    return gitClient
      .getPullRequest(
        self.gitPullRequest.repository.id,
        self.gitPullRequest.pullRequestId
      )
      .then((value) => {
        self.isAutoCompleteSet = value.autoCompleteSetBy !== undefined;

        if (value.lastMergeCommit === undefined) {
          return;
        }

        self.lastCommitDetails = value.lastMergeCommit;
      })
      .catch((error) => {
        console.log(
          `There was an error calling the Pull Request details (method: getPullRequestAdditionalDetailsAsync).`
        );
        console.log(error);
      });
  }

  private async getPullRequestThreadAsync() {
    const gitClient: GitRestClient = getClient(GitRestClient);
    let self = this;

    await gitClient
      .getThreads(
        self.gitPullRequest.repository.id,
        self.gitPullRequest.pullRequestId
      )
      .then((value) => {
        if (value === undefined) {
          return;
        }

        const threads = value.filter((x) => x.status !== undefined && !x.isDeleted);
        const terminatedThread = threads.filter(
          (x) =>
            x.status === CommentThreadStatus.Closed ||
            x.status === CommentThreadStatus.WontFix ||
            x.status === CommentThreadStatus.Fixed
        );
        // Most recent update; undefined when the PR has no comment threads
        const lastUpdatedDate = threads
          .map((x) => x.lastUpdatedDate)
          .reduce<Date | undefined>(
            (x, y) => (x && compare(x, y) > 0 ? x : y),
            undefined
          );

        self.comment = new PullRequestComment();
        self.comment.totalcomment = threads.length;
        self.comment.terminatedComment = terminatedThread.length;
        self.comment.lastUpdatedDate = lastUpdatedDate;
      })
      .catch((error) => {
        console.log(
          "There was an error calling the Pull Request threads (method: getPullRequestThreadAsync)."
        );
        console.log(error);
      });
  }

  private async getPullRequestPolicyAsync() {
    let self = this;

    ///** Work in Progress :-) */
    // const details = await getPullRequestOverallStatus(
    //   this.baseHostUrl,
    //   DevOps.getHost().name,
    //   this.gitPullRequest.repository.project,
    //   this.gitPullRequest.repository,
    //   this
    // );

    const policies = await getEvaluationsPerPullRequest(
      this.baseHostUrl,
      this.gitPullRequest.repository.project,
      this.gitPullRequest.pullRequestId
    );

    self.isAllPoliciesOk =
      policies.length === 0 ||
      policies
        .filter(
          (i) =>
            i.configuration.isEnabled === true &&
            i.configuration.isBlocking === true
        )
        .every((i) => {
          return i.status === "approved";
        });

    // Build a fresh list and assign at the end so re-running (e.g. on a
    // background refresh of a seeded model) replaces instead of appending
    const loadedPolicies: PullRequestPolicy[] = [];

    policies
      .filter(
        (p) =>
          p.configuration.isEnabled === true &&
          p.configuration.isBlocking === true
      )
      .forEach((p) => {
        const pullRequestPolicy = new PullRequestPolicy();
        pullRequestPolicy.id = p.evaluationId;
        pullRequestPolicy.displayName = `${p.configuration.type.displayName}`;
        pullRequestPolicy.isApproved = p.status === "approved";

        switch (p.configuration.type.id) {
          case EvaluationPolicyType.MinimumReviewers: {
            pullRequestPolicy.displayName = `${p.configuration.settings.minimumApproverCount} ${p.configuration.type.displayName}`;
            break;
          }
          case EvaluationPolicyType.Build: {
            // The evaluation has no context until a build is queued for it
            const buildName =
              p.context?.buildDefinitionName ??
              p.configuration.settings.displayName;

            if (buildName) {
              pullRequestPolicy.displayName = `${p.configuration.type.displayName} - ${buildName}`;
            }
            break;
          }
          case EvaluationPolicyType.RequiredReviewers: {
            const requiredReviewerName = this.gitPullRequest.reviewers.filter(
              (r) =>
                p.configuration.settings.requiredReviewerIds.findIndex(
                  (r2) => r2 === r.id
                ) >= 0
            );
            pullRequestPolicy.displayName = `${
              p.configuration.type.displayName
            } - ${
              requiredReviewerName && requiredReviewerName.length > 0
                ? requiredReviewerName[0].displayName
                : "Not found"
            }`;
            break;
          }
        }

        loadedPolicies.push(pullRequestPolicy);
        return p;
      });

    self.policies = loadedPolicies;
  }

  private async getLabels() {
    const gitClient: GitRestClient = getClient(GitRestClient);
    let self = this;

    await gitClient
      .getPullRequestLabels(
        self.gitPullRequest.repository.id,
        this.gitPullRequest.pullRequestId
      )
      .then((data) => {
        self.labels = data;
      })
      .catch((error) => {
        console.log(
          "There was an error calling the builds (method: processPolicyBuildAsync)."
        );
        console.log(error);
      });
  }

  public static getModels(
    pullRequestList: GitPullRequest[] | undefined,
    baseUrl: string,
    callbackState: (pullRequestModel: PullRequestModel) => void,
    existingModels?: PullRequestModel[],
    // When true, models are built from list data only; their background detail
    // calls are deferred until ensureEnriched() runs (see PullRequestsTab —
    // used for the full completed/abandoned set so it isn't enriched up front).
    deferEnrichment: boolean = false
  ): PullRequestModel[] {
    const modelList: PullRequestModel[] = [];

    // Index the previous models by PR + repository so seeding a background
    // refresh is O(1) per PR. With the full completed/abandoned history now
    // kept in memory a linear find() per PR would be O(N^2) on every refresh.
    const previousByKey = new Map<string, PullRequestModel>();
    existingModels?.forEach((m) =>
      previousByKey.set(
        `${m.gitPullRequest.repository.id}_${m.gitPullRequest.pullRequestId}`,
        m
      )
    );

    pullRequestList!.forEach((pr) => {
      const previousModel = previousByKey.get(
        `${pr.repository.id}_${pr.pullRequestId}`
      );

      modelList.push(
        new PullRequestModel(
          pr,
          pr.repository.project.name,
          baseUrl,
          callbackState,
          previousModel,
          deferEnrichment
        )
      );

      return pr;
    });

    return modelList;
  }
}
