jest.mock("azure-devops-extension-api", () => ({ getClient: jest.fn() }));
jest.mock("azure-devops-extension-api/Graph/GraphClient", () => ({
  GraphRestClient: jest.fn(),
}));
jest.mock("azure-devops-extension-api/Profile/Profile", () => ({
  AvatarSize: { Medium: 1 },
}));

import type { GraphDescriptorResult } from "azure-devops-extension-api/Graph/Graph";
import {
  AvatarService,
  IAvatarIdentity,
  IGraphAvatarClient,
  getIdentityDisplayName,
} from "./AvatarService";

function createAvatar(value: number[] = [137, 80, 78, 71]): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

function createClient(): jest.Mocked<IGraphAvatarClient> {
  return {
    getAvatarBytes: jest.fn().mockResolvedValue(createAvatar()),
    getDescriptor: jest.fn().mockImplementation(
      async (storageKey: string): Promise<GraphDescriptorResult> => ({
        _links: {},
        value: `aad.${storageKey}`,
      })
    ),
  };
}

describe("AvatarService", () => {
  it("provides a neutral label for an inaccessible identity", () => {
    expect(getIdentityDisplayName({})).toBe("Unknown user");
    expect(getIdentityDisplayName({ isDeletedInOrigin: true })).toBe(
      "Deleted user"
    );
  });

  it("loads current/owner and another organization user through Graph", async () => {
    const client = createClient();
    const service = new AvatarService(client);

    await Promise.all([
      service.getAvatarUrl({ descriptor: "msa.owner", id: "owner" }),
      service.getAvatarUrl({ descriptor: "aad.other", id: "other" }),
    ]);

    expect(client.getAvatarBytes).toHaveBeenCalledTimes(2);
    expect(client.getAvatarBytes).toHaveBeenCalledWith("msa.owner");
    expect(client.getAvatarBytes).toHaveBeenCalledWith("aad.other");
  });

  it("uses a descriptor supplied directly by a PR author identity", async () => {
    const client = createClient();
    const service = new AvatarService(client);
    const author: IAvatarIdentity = {
      descriptor: "aad.author",
      displayName: "PR Author",
    };

    const url = await service.getAvatarUrl(author);

    expect(url).toBe("data:image/png;base64,iVBORw==");
    expect(client.getDescriptor).not.toHaveBeenCalled();
    expect(client.getAvatarBytes).toHaveBeenCalledWith("aad.author");
  });

  it("extracts a reviewer descriptor from the avatar link", async () => {
    const client = createClient();
    const service = new AvatarService(client);

    await service.getAvatarUrl({
      _links: {
        avatar: {
          href: "https://dev.azure.com/org/_apis/GraphProfile/MemberAvatars/msa.reviewer",
        },
      },
      id: "reviewer-id",
    });

    expect(client.getDescriptor).not.toHaveBeenCalled();
    expect(client.getAvatarBytes).toHaveBeenCalledWith("msa.reviewer");
  });

  it("resolves an identity that only has a GUID", async () => {
    const client = createClient();
    const service = new AvatarService(client);

    await service.getAvatarUrl({ id: "identity-guid" });

    expect(client.getDescriptor).toHaveBeenCalledWith("identity-guid");
    expect(client.getAvatarBytes).toHaveBeenCalledWith("aad.identity-guid");
  });

  it("resolves the GUID from a legacy imageUrl instead of loading it directly", async () => {
    const client = createClient();
    const service = new AvatarService(client);

    await service.getAvatarUrl({
      imageUrl:
        "https://dev.azure.com/org/_api/_common/identityImage?id=image-guid",
    });

    expect(client.getDescriptor).toHaveBeenCalledWith("image-guid");
    expect(client.getAvatarBytes).toHaveBeenCalledTimes(1);
  });

  it("loads an identity without imageUrl when a descriptor is available", async () => {
    const client = createClient();
    const service = new AvatarService(client);

    const url = await service.getAvatarUrl({ descriptor: "aad.no-image-url" });

    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  it("handles guest users through the same Graph endpoint", async () => {
    const client = createClient();
    const service = new AvatarService(client);

    await service.getAvatarUrl({ descriptor: "aad.guest", metaType: "guest" });

    expect(client.getAvatarBytes).toHaveBeenCalledWith("aad.guest");
  });

  it("falls back without requesting deleted or inactive identities", async () => {
    const client = createClient();
    const service = new AvatarService(client);

    const deleted = await service.getAvatarUrl({
      descriptor: "aad.deleted",
      isDeletedInOrigin: true,
    });
    const inactive = await service.getAvatarUrl({
      descriptor: "aad.inactive",
      inactive: true,
    });

    expect(deleted).toBeUndefined();
    expect(inactive).toBeUndefined();
    expect(client.getAvatarBytes).not.toHaveBeenCalled();
  });

  it("handles group identities and safely falls back when no avatar exists", async () => {
    const client = createClient();
    client.getAvatarBytes.mockResolvedValue(createAvatar([]));
    const service = new AvatarService(client);

    const url = await service.getAvatarUrl({
      descriptor: "vssgp.team",
      displayName: "Review Team",
      isContainer: true,
    });

    expect(url).toBeUndefined();
    expect(getIdentityDisplayName({ isContainer: true })).toBe("Group");
  });

  it("caches an HTTP error and does not retry forever", async () => {
    const client = createClient();
    client.getAvatarBytes.mockRejectedValue(new Error("403"));
    const service = new AvatarService(client);
    const identity = { descriptor: "aad.inaccessible" };

    expect(await service.getAvatarUrl(identity)).toBeUndefined();
    expect(await service.getAvatarUrl(identity)).toBeUndefined();
    expect(client.getAvatarBytes).toHaveBeenCalledTimes(1);
  });

  it("deduplicates parallel requests for the same identity", async () => {
    const client = createClient();
    const service = new AvatarService(client);
    const identity = { descriptor: "aad.cached" };

    const first = service.getAvatarUrl(identity);
    const second = service.getAvatarUrl(identity);

    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(client.getAvatarBytes).toHaveBeenCalledTimes(1);
  });
});
