import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";

jest.mock("azure-devops-extension-api/Git/Git", () => ({
  PullRequestStatus: { Active: 1, Abandoned: 2, Completed: 3, All: 4 },
}));
jest.mock("./Columns", () => ({
  getVoteDescription: (vote: number) => `Vote ${vote}`,
}));
jest.mock("../models/constants", () => ({
  getStatusSizeValue: () => "m",
  getStatusIcon: () => ({}),
}));

import { GitRepository } from "azure-devops-extension-api/Git/Git";
import { DropdownMultiSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { Filter } from "azure-devops-ui/Utilities/Filter";
import { BranchDropDownItem } from "../tabs/PulRequestsTabData";
import { FilterBarHub, IFilterHubProps } from "./FilterBarHub";

const repo = (id: string) =>
  ({ id, name: `Repo ${id}`, project: { id: "p1" } } as GitRepository);
const branch = (name: string) => new BranchDropDownItem("app", name);

describe("FilterBarHub", () => {
  let container: HTMLDivElement;
  let filter: Filter;

  const renderHub = (props: Partial<IFilterHubProps>) =>
    act(() => {
      ReactDOM.render(
        <FilterBarHub
          filterPullRequests={() => {}}
          pullRequests={[]}
          projects={[]}
          filter={filter}
          selectedProjectChanged={() => {}}
          selectedProject={new DropdownMultiSelection()}
          repositories={[]}
          sourceBranchList={[]}
          targetBranchList={[]}
          createdByList={[]}
          teamsList={{}}
          reviewerList={[]}
          selectedMyApprovalStatuses={new DropdownMultiSelection()}
          selectedAlternateStatusPr={new DropdownMultiSelection()}
          tagList={[]}
          {...props}
        />,
        container
      );
    });

  const labels = () =>
    Array.from(
      container.querySelectorAll(".bolt-dropdown-expandable-button-label")
    ).map((e) => e.textContent);

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    filter = new Filter();
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  it("survives a refresh that empties a list with a selected item", () => {
    filter.setFilterItemState("selectedRepos", { value: ["c"] });
    renderHub({ repositories: [repo("a"), repo("b"), repo("c")] });
    expect(labels()).toContain("Repo c");

    renderHub({ repositories: [] });
    expect(labels()).toContain("Repositories");
    // A transient list must not drop the selection from the filter
    expect(filter.getFilterItemValue("selectedRepos")).toEqual(["c"]);

    renderHub({ repositories: [repo("c"), repo("d")] });
    expect(labels()).toContain("Repo c");
  });

  it("keeps the selected item when a refresh shifts the list", () => {
    filter.setFilterItemState("selectedSourceBranches", {
      value: ["app->main"],
    });
    renderHub({ sourceBranchList: [branch("dev"), branch("main")] });
    expect(labels()).toContain("app->main");

    renderHub({
      sourceBranchList: [branch("alpha"), branch("dev"), branch("main")],
    });
    expect(labels()).toContain("app->main");
    expect(labels()).not.toContain("app->dev");
  });
});
