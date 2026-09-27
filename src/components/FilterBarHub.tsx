import "./FilterBarHub.scss";
import * as React from "react";
import { FilterBar } from "azure-devops-ui/FilterBar";
import { KeywordFilterBarItem } from "azure-devops-ui/TextFilterBarItem";
import { DropdownFilterBarItem } from "azure-devops-ui/Dropdown";
import { IDropdownFilterBarItemProps } from "azure-devops-ui/Components/Dropdown/DropdownFilterBarItem.Props";
import {
  TeamProjectReference,
  ProjectInfo,
  WebApiTagDefinition,
} from "azure-devops-extension-api/Core/Core";
import { Filter } from "azure-devops-ui/Utilities/Filter";
import { IListBoxItem } from "azure-devops-ui/ListBox";
import {
  DropdownSelection,
  DropdownMultiSelection,
} from "azure-devops-ui/Utilities/DropdownSelection";
import {
  GitRepository,
  IdentityRefWithVote,
} from "azure-devops-extension-api/Git/Git";
import * as Data from "../tabs/PulRequestsTabData";
import { IdentityRef } from "azure-devops-extension-api/WebApi/WebApi";
import { getVoteDescription } from "./Columns";
import { ITableColumn } from "azure-devops-ui/Table";
import { Status } from "azure-devops-ui/Status";
import { getStatusSizeValue, getStatusIcon } from "../models/constants";
import { PullRequestModel } from "../models/PullRequestModel";
import { Spinner } from "office-ui-fabric-react";

export const myApprovalStatuses: IListBoxItem[] = Object.keys(
  Data.ReviewerVoteOption
)
  .filter((value) => !isNaN(parseInt(value, 10)))
  .map((item) => {
    return {
      id: item,
      text: getVoteDescription(parseInt(item, 10))
    };
  });

export const alternateStatusPr: IListBoxItem[] = Object.keys(
  Data.AlternateStatusPr
).map((item, index) => {
  return {
    id: Object.values(Data.AlternateStatusPr)[index].toString(),
    text: Object.values(Data.AlternateStatusPr)[index].toString(),
  };
});

export interface IFilterHubProps {
  filterPullRequests: () => void;
  pullRequests: PullRequestModel[];
  projects: TeamProjectReference[];
  filter: Filter;
  selectedProjectChanged: (
    event: React.SyntheticEvent<HTMLElement, Event>,
    item: IListBoxItem<TeamProjectReference | ProjectInfo>
  ) => void;
  selectedProject: DropdownSelection;
  repositories: GitRepository[];
  sourceBranchList: Data.BranchDropDownItem[];
  targetBranchList: Data.BranchDropDownItem[];
  createdByList: IdentityRef[];
  teamsList: Record<string, Data.TeamRef>;
  reviewerList: IdentityRefWithVote[];
  selectedMyApprovalStatuses: DropdownMultiSelection;
  selectedAlternateStatusPr: DropdownMultiSelection;
  tagList: WebApiTagDefinition[];
}

interface IListFilterBarItemState {
  itemIds: string[];
  selection: DropdownMultiSelection;
  version: number;
}

// DropdownFilterBarItem keeps its selection as indexes into `items`, so when a
// refresh rebuilds a list those indexes go stale: they point at the wrong
// entry, or past the end, which throws while rendering the label and blanks
// the page. Remount with a fresh selection whenever the items change so it is
// re-derived from the filter (which holds ids) against the new list.
class ListFilterBarItem extends React.Component<
  IDropdownFilterBarItemProps & { items: IListBoxItem[] },
  IListFilterBarItemState
> {
  public state: IListFilterBarItemState = {
    itemIds: [],
    selection: new DropdownMultiSelection(),
    version: 0,
  };

  public static getDerivedStateFromProps(
    props: { items: IListBoxItem[] },
    state: IListFilterBarItemState
  ): Partial<IListFilterBarItemState> | null {
    const itemIds = props.items.map((i) => i.id);
    const unchanged =
      itemIds.length === state.itemIds.length &&
      itemIds.every((id, index) => id === state.itemIds[index]);

    return unchanged
      ? null
      : {
          itemIds,
          selection: new DropdownMultiSelection(),
          version: state.version + 1,
        };
  }

  public render(): JSX.Element {
    return (
      <DropdownFilterBarItem
        {...this.props}
        key={this.state.version}
        selection={this.state.selection}
      />
    );
  }
}

export function FilterBarHub(props: IFilterHubProps): JSX.Element {
  return (
    <FilterBar
      filter={props.filter}
      onDismissClicked={() => {
        props.filterPullRequests();
      }}
    >
      <KeywordFilterBarItem
        className="text-color"
        filterItemKey={`pullRequestTitle`}
        placeholder={"Search Pull Requests by Name or ID"}
        filter={props.filter}
        clearable={true}
      />

      <React.Fragment>
        <DropdownFilterBarItem
          filterItemKey={`selectedProjects`}
          onSelect={props.selectedProjectChanged}
          filter={props.filter}
          selection={props.selectedProject}
          placeholder="Projects"
          showFilterBox={true}
          noItemsText="No project found"
          items={props.projects.map((i) => {
            return {
              id: i.id,
              text: i.name,
            };
          })}
        />
      </React.Fragment>

      <React.Fragment>
        <ListFilterBarItem
          filterItemKey={`selectedTeams`}
          noItemsText="No teams found"
          filter={props.filter}
          showFilterBox={true}
          items={Object.keys(props.teamsList).map((key) => ({
              id: JSON.stringify(props.teamsList[key]),
              text: props.teamsList[key].name
          }))}
          placeholder="Team"
        />
      </React.Fragment>

      <React.Fragment>
        <ListFilterBarItem
          filterItemKey={`selectedRepos`}
          filter={props.filter}
          placeholder="Repositories"
          showFilterBox={true}
          noItemsText="No repository found"
          items={props.repositories.map((i) => {
            return {
              id: i.id,
              text: i.name,
            };
          })}
        />
      </React.Fragment>

      <React.Fragment>
        <ListFilterBarItem
          filterItemKey={`selectedSourceBranches`}
          filter={props.filter}
          showFilterBox={true}
          noItemsText="No source branch found"
          items={props.sourceBranchList.map((i) => {
            return {
              id: i.displayName,
              text: i.displayName,
            };
          })}
          placeholder="Source Branch"
        />
      </React.Fragment>

      <React.Fragment>
        <ListFilterBarItem
          filterItemKey={`selectedTargetBranches`}
          filter={props.filter}
          showFilterBox={true}
          noItemsText="No target branch found"
          items={props.targetBranchList.map((i) => {
            return {
              id: i.displayName,
              text: i.displayName,
            };
          })}
          placeholder="Target Branch"
        />
      </React.Fragment>

      <React.Fragment>
        <ListFilterBarItem
          filterItemKey={`selectedAuthors`}
          noItemsText="No one found"
          filter={props.filter}
          showFilterBox={true}
          items={props.createdByList.map((i) => {
            return {
              id: i.id,
              text: i.displayName,
            };
          })}
          placeholder="Created By"
        />
      </React.Fragment>

      <React.Fragment>
        <ListFilterBarItem
          filterItemKey={`selectedReviewers`}
          noItemsText="No one found"
          filter={props.filter}
          showFilterBox={true}
          items={props.reviewerList.map((i) => {
            return {
              id: i.id,
              text: i.displayName,
            };
          })}
          placeholder="Reviewers"
        />
      </React.Fragment>

      <React.Fragment>
        <DropdownFilterBarItem
          filterItemKey={`selectedMyApprovalStatuses`}
          filter={props.filter}
          items={myApprovalStatuses}
          selection={props.selectedMyApprovalStatuses}
          renderItem={(
            rowIndex: number,
            columnIndex: number,
            tableColumn: ITableColumn<IListBoxItem<{}>>,
            tableItem: IListBoxItem<{}>
          ): JSX.Element => (
            <td
              key={rowIndex}
              className="bolt-list-box-text bolt-list-box-text-multi-select asi-container"
            >
              <Status
                {...getStatusIcon(parseInt(tableItem.id!, 10))}
                key="failed"
                size={getStatusSizeValue("m")}
                className="flex-self-center"
              />{" "}
              <span className="margin-left-8">
                {getVoteDescription(parseInt(tableItem.id!, 10))}
              </span>
            </td>
          )}
          placeholder={"My Approval Status"}
        />
      </React.Fragment>

      <React.Fragment>
        <DropdownFilterBarItem
          filterItemKey={`selectedAlternateStatusPr`}
          filter={props.filter}
          items={alternateStatusPr}
          selection={props.selectedAlternateStatusPr}
          placeholder="Alternate Status"
        />
      </React.Fragment>

      <React.Fragment>
        {props.pullRequests.filter((pr) => pr.isLoadingLabels() === true)
          .length > 0 ? (
          <Spinner />
        ) : (
          <ListFilterBarItem
            filterItemKey={`selectedTags`}
            filter={props.filter}
            items={props.tagList.map((i) => {
              return {
                id: i.id,
                text: i.name,
              };
            })}
            placeholder="Tags"
          />
        )}
      </React.Fragment>
    </FilterBar>
  );
}
