import * as DevOps from "azure-devops-extension-sdk";

// Avatar hrefs point at dev.azure.com, but the extension iframe is served from a
// different origin (gallerycdn.vsassets.io, or localhost in dev). A plain
// <img src> is a cross-site subresource request, so the browser withholds the
// Azure DevOps auth cookies and the endpoint answers 302 -> _signin instead of
// an image. Fetching with the extension's access token uses the same
// bearer-token channel as the rest of our API calls, which is unaffected.
const avatarUrlCache = new Map<string, Promise<string | undefined>>();

async function fetchAvatar(href: string): Promise<string | undefined> {
  try {
    const accessToken = await DevOps.getAccessToken();

    const response = await fetch(href, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    // An unauthenticated request is answered with a redirect to the sign-in
    // page rather than an error status, so a 2xx alone doesn't mean we got an
    // image back - check what actually came through.
    const contentType = response.headers.get("content-type");

    if (!response.ok || !contentType || !contentType.startsWith("image/")) {
      return undefined;
    }

    return URL.createObjectURL(await response.blob());
  } catch {
    return undefined;
  }
}

// Resolves an identity's avatar href to a local object URL, or undefined when it
// can't be loaded (callers fall back to initials). Cached per href: identities
// repeat across rows, and the object URL is reused for the life of the page.
export function getAvatarUrl(href: string): Promise<string | undefined> {
  let pending = avatarUrlCache.get(href);

  if (!pending) {
    pending = fetchAvatar(href);
    avatarUrlCache.set(href, pending);
  }

  return pending;
}
