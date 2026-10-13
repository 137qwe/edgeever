import { getCookie, setCookie } from "hono/cookie";
import type { AppContext } from "./api-context";
import { authenticateRequest } from "./auth-service";
import { createShareAccessCookieValue, isValidShareAccessCookieValue, SHARE_ACCESS_COOKIE, SHARE_ACCESS_MAX_AGE_SECONDS } from "./share-access";

const shareAccessCookiePath = (token: string) => `/api/public/shares/${encodeURIComponent(token)}`;

export const setShareAccessCookie = async (c: AppContext, token: string, passwordHash: string, path = shareAccessCookiePath(token)) => {
  const value = await createShareAccessCookieValue(passwordHash, token);
  setCookie(c, SHARE_ACCESS_COOKIE, value, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path,
    maxAge: SHARE_ACCESS_MAX_AGE_SECONDS,
  });
};

const hasShareAccessCookie = async (c: AppContext, token: string, passwordHash: string) =>
  isValidShareAccessCookieValue(getCookie(c, SHARE_ACCESS_COOKIE), passwordHash, token);

const isShareOwner = async (c: AppContext, workspaceId: string) => {
  const auth = await authenticateRequest(c, false);
  return auth?.workspaceId === workspaceId;
};

export const allowPasswordProtectedShare = async (
  c: AppContext,
  token: string,
  workspaceId: string,
  passwordHash: string,
) => (await hasShareAccessCookie(c, token, passwordHash)) || isShareOwner(c, workspaceId);

