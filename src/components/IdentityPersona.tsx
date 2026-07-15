import * as React from "react";

import { VssPersona, VssPersonaSize } from "azure-devops-ui/VssPersona";
import { getAvatarUrl } from "../services/AvatarService";

interface IIdentityPersonaProps {
  // The identity's _links.avatar.href, as handed to us by Azure DevOps.
  imageHref?: string;
  displayName?: string;
  size?: VssPersonaSize;
  className?: string;
}

// Drop-in VssPersona for identity avatars: resolves the avatar through an
// authenticated fetch (see AvatarService) instead of letting the browser issue a
// cookie-based <img> request, which fails cross-origin from the extension frame.
// While the fetch is in flight - or if it fails - imageUrl stays undefined and
// VssPersona renders the identity's initials.
export function IdentityPersona(props: IIdentityPersonaProps): JSX.Element {
  const { imageHref, displayName, size, className } = props;
  const [imageUrl, setImageUrl] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;

    setImageUrl(undefined);

    if (imageHref) {
      getAvatarUrl(imageHref).then((url) => {
        if (!cancelled) {
          setImageUrl(url);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [imageHref]);

  return (
    <VssPersona
      className={className}
      imageUrl={imageUrl}
      size={size}
      displayName={displayName}
    />
  );
}
