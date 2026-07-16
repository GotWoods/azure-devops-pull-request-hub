import * as React from "react";
import { VssPersona } from "azure-devops-ui/VssPersona";
import type { IVssPersonaProps } from "azure-devops-ui/VssPersona";
import {
  IAvatarIdentity,
  AvatarService,
  getAvatarIdentityKey,
  getAvatarService,
  getIdentityDisplayName,
} from "../services/AvatarService";

export interface IIdentityAvatarProps {
  avatarService?: Pick<AvatarService, "getAvatarUrl">;
  className?: string;
  displayName?: string;
  identity: IAvatarIdentity;
  size?: IVssPersonaProps["size"];
}

interface IIdentityAvatarState {
  imageUrl?: string;
}

export class IdentityAvatar extends React.PureComponent<
  IIdentityAvatarProps,
  IIdentityAvatarState
> {
  public state: IIdentityAvatarState = {};

  private isUnmounted = false;
  private requestVersion = 0;

  public componentDidMount(): void {
    this.loadAvatar();
  }

  public componentDidUpdate(previousProps: IIdentityAvatarProps): void {
    if (
      getAvatarIdentityKey(previousProps.identity) !==
      getAvatarIdentityKey(this.props.identity)
    ) {
      this.loadAvatar();
    }
  }

  public componentWillUnmount(): void {
    this.isUnmounted = true;
    this.requestVersion++;
  }

  public render(): JSX.Element {
    const displayName =
      (this.props.displayName && this.props.displayName.trim()) ||
      getIdentityDisplayName(this.props.identity);

    return (
      <VssPersona
        className={this.props.className}
        displayName={displayName}
        imageUrl={this.state.imageUrl}
        onImageError={this.handleImageError}
        size={this.props.size}
      />
    );
  }

  private loadAvatar = async (): Promise<void> => {
    const requestVersion = ++this.requestVersion;
    const avatarService = this.props.avatarService || getAvatarService();

    this.setState({ imageUrl: undefined });
    const imageUrl = await avatarService.getAvatarUrl(this.props.identity);

    if (!this.isUnmounted && requestVersion === this.requestVersion) {
      this.setState({ imageUrl });
    }
  };

  private handleImageError = (): void => {
    if (this.state.imageUrl) {
      this.setState({ imageUrl: undefined });
    }
  };
}
