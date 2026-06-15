import * as React from "react";

import * as Data from "../tabs/PulRequestsTabData";
import { IdentityRefWithVote } from "azure-devops-extension-api/Git/Git";
import { Statuses, Status } from "azure-devops-ui/Status";
import { getStatusSizeValue } from "../models/constants";

// A reviewer who declined to review keeps a vote of 0 (No Vote) but carries a
// separate hasDeclined flag. It's returned by the REST API but missing from the
// SDK typings, so read it defensively. (issue #210)
export function isReviewerDeclined(reviewer: IdentityRefWithVote): boolean {
  return (reviewer as any).hasDeclined === true;
}

export function GetVoteIconColor(reviewer: IdentityRefWithVote): string {
  if (isReviewerDeclined(reviewer)) {
    return "repos-pr-reviewer-vote-declinedLightColor";
  }

  switch (Data.ReviewerVoteOption[reviewer.vote]) {
    case "Approved":
      return "repos-pr-reviewer-vote-approvedLightColor";
    case "ApprovedWithSuggestions":
      return "repos-pr-reviewer-vote-approvedWithSuggestionsLightColor";
    case "Rejected":
      return "repos-pr-reviewer-vote-rejectedLightColor";
    case "WaitingForAuthor":
      return "repos-pr-reviewer-vote-waitingAuthorLightColor";
  }

  return "repos-pr-reviewer-vote-noVoteLightColor";
};

export function ReviewerVoteIconStatus(props: any): JSX.Element {
  let voteStatusIcon = Statuses.Waiting;
  const reviewer: IdentityRefWithVote = props.reviewer;

  if (isReviewerDeclined(reviewer)) {
    voteStatusIcon = Statuses.Canceled;
  } else {
    switch (Data.ReviewerVoteOption[reviewer.vote]) {
      case "Approved":
        voteStatusIcon = Statuses.Success;
        break;
      case "ApprovedWithSuggestions":
        voteStatusIcon = Statuses.Success;
        break;
      case "Rejected":
        voteStatusIcon = Statuses.Failed;
        break;
      case "WaitingForAuthor":
        voteStatusIcon = Statuses.Warning;
        break;
    }
  }

  return (
    <Status
      {...voteStatusIcon}
      key="success"
      size={getStatusSizeValue("m")}
      className={props.className}
    />
  );
}
