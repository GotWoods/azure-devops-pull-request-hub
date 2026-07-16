import { getClient } from "azure-devops-extension-api";
import { GraphRestClient } from "azure-devops-extension-api/Graph/GraphClient";
import { GraphDescriptorResult } from "azure-devops-extension-api/Graph/Graph";
import { AvatarSize } from "azure-devops-extension-api/Profile/Profile";

export interface IAvatarIdentity {
  _links?: {
    avatar?: {
      href?: string;
    };
  };
  descriptor?: string;
  displayName?: string;
  id?: string;
  imageUrl?: string;
  inactive?: boolean;
  isContainer?: boolean;
  isDeletedInOrigin?: boolean;
  metaType?: string;
  uniqueName?: string;
}

export interface IGraphAvatarClient {
  getAvatarBytes(subjectDescriptor: string): Promise<ArrayBuffer>;
  getDescriptor(storageKey: string): Promise<GraphDescriptorResult>;
}

export class AvatarRestClient extends GraphRestClient {
  // The generated getAvatar() materializes PNG bytes as a number[].
  // Request raw bytes to avoid that payload overhead.
  public getAvatarBytes(subjectDescriptor: string): Promise<ArrayBuffer> {
    return this.beginRequest<ArrayBuffer>({
      apiVersion: "5.1-preview.1",
      httpResponseType: avatarMimeType,
      queryParams: {
        format: "png",
        size: AvatarSize.Medium,
      },
      routeTemplate: "_apis/Graph/Subjects/{subjectDescriptor}/Avatars",
      routeValues: { subjectDescriptor },
    });
  }
}

const avatarDescriptorPattern = /\/MemberAvatars\/([^/?#]+)/i;
const identityImageIdPattern = /[?&]id=([^&#]+)/i;
const avatarMimeType = "image/png";

export function getIdentityDisplayName(identity: IAvatarIdentity): string {
  const displayName = identity.displayName && identity.displayName.trim();
  if (displayName) {
    return displayName;
  }

  const uniqueName = identity.uniqueName && identity.uniqueName.trim();
  if (uniqueName) {
    return uniqueName;
  }

  if (identity.isDeletedInOrigin || identity.inactive) {
    return "Deleted user";
  }

  return identity.isContainer ? "Group" : "Unknown user";
}

export function getAvatarIdentityKey(identity: IAvatarIdentity): string {
  return (
    identity.descriptor ||
    getDescriptorFromAvatarUrl(identity._links?.avatar?.href) ||
    identity.id ||
    getIdentityIdFromImageUrl(identity.imageUrl) ||
    ""
  );
}

export class AvatarService {
  private readonly cache = new Map<string, Promise<string | undefined>>();

  constructor(private readonly graphClient: IGraphAvatarClient) {}

  public getAvatarUrl(identity: IAvatarIdentity): Promise<string | undefined> {
    if (identity.inactive || identity.isDeletedInOrigin) {
      return Promise.resolve(undefined);
    }

    const key = getAvatarIdentityKey(identity);
    if (!key) {
      return Promise.resolve(undefined);
    }

    let cached = this.cache.get(key);
    if (!cached) {
      cached = this.loadAvatar(identity).catch(() => undefined);
      this.cache.set(key, cached);
    }

    return cached;
  }

  private async loadAvatar(
    identity: IAvatarIdentity
  ): Promise<string | undefined> {
    const descriptor = await this.resolveDescriptor(identity);
    if (!descriptor) {
      return undefined;
    }

    const avatar = await this.graphClient.getAvatarBytes(descriptor);

    if (avatar.byteLength === 0) {
      return undefined;
    }

    return `data:${avatarMimeType};base64,${bytesToBase64(
      new Uint8Array(avatar)
    )}`;
  }

  private async resolveDescriptor(
    identity: IAvatarIdentity
  ): Promise<string | undefined> {
    const descriptor =
      identity.descriptor ||
      getDescriptorFromAvatarUrl(identity._links?.avatar?.href);

    if (descriptor) {
      return descriptor;
    }

    const storageKey = identity.id || getIdentityIdFromImageUrl(identity.imageUrl);
    if (!storageKey) {
      return undefined;
    }

    const result = await this.graphClient.getDescriptor(storageKey);
    return result && result.value ? result.value : undefined;
  }
}

let defaultAvatarService: AvatarService | undefined;

export function getAvatarService(): AvatarService {
  if (!defaultAvatarService) {
    defaultAvatarService = new AvatarService(getClient(AvatarRestClient));
  }

  return defaultAvatarService;
}

function getDescriptorFromAvatarUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  const match = avatarDescriptorPattern.exec(url);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function getIdentityIdFromImageUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  const match = identityImageIdPattern.exec(url);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
  }

  return btoa(binary);
}
