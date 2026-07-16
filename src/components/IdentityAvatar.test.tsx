import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";

jest.mock("azure-devops-extension-api", () => ({ getClient: jest.fn() }));
jest.mock("azure-devops-extension-api/Graph/GraphClient", () => ({
  GraphRestClient: jest.fn(),
}));
jest.mock("azure-devops-extension-api/Profile/Profile", () => ({
  AvatarSize: { Medium: 1 },
}));
jest.mock("azure-devops-ui/VssPersona", () => ({
  VssPersona: (props: {
    className?: string;
    displayName?: string;
    imageUrl?: string;
    onImageError?: (event: unknown) => void;
  }) => {
    const ReactRuntime: typeof import("react") = require("react");
    if (props.imageUrl) {
      return ReactRuntime.createElement("img", {
        className: props.className,
        onError: props.onImageError,
        src: props.imageUrl,
      });
    }

    const initials = (props.displayName || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
    return ReactRuntime.createElement("div", { className: props.className }, initials);
  },
}));

import { IdentityAvatar } from "./IdentityAvatar";

describe("IdentityAvatar", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  it("renders avatars for a PR author and reviewer", async () => {
    const avatarService = {
      getAvatarUrl: jest
        .fn()
        .mockResolvedValue("data:image/png;base64,iVBORw=="),
    };

    await act(async () => {
      ReactDOM.render(
        <>
          <IdentityAvatar
            avatarService={avatarService}
            identity={{ descriptor: "aad.author" }}
            displayName="PR Author"
          />
          <IdentityAvatar
            avatarService={avatarService}
            identity={{ descriptor: "aad.reviewer" }}
            displayName="PR Reviewer"
          />
        </>,
        container
      );
    });

    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(avatarService.getAvatarUrl).toHaveBeenCalledTimes(2);
  });

  it("shows initials when the avatar service cannot load an image", async () => {
    const avatarService = {
      getAvatarUrl: jest.fn().mockResolvedValue(undefined),
    };

    await act(async () => {
      ReactDOM.render(
        <IdentityAvatar
          avatarService={avatarService}
          identity={{ descriptor: "aad.missing" }}
          displayName="Missing User"
        />,
        container
      );
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("MU");
  });

  it("removes a failed src and does not trigger an infinite onError loop", async () => {
    const avatarService = {
      getAvatarUrl: jest
        .fn()
        .mockResolvedValue("data:image/png;base64,invalid"),
    };

    await act(async () => {
      ReactDOM.render(
        <IdentityAvatar
          avatarService={avatarService}
          identity={{ descriptor: "aad.broken" }}
          displayName="Broken Avatar"
        />,
        container
      );
    });

    const image = container.querySelector("img");
    expect(image).not.toBeNull();

    act(() => {
      image!.dispatchEvent(new Event("error"));
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("BA");
    expect(avatarService.getAvatarUrl).toHaveBeenCalledTimes(1);
  });
});
