import { cookies } from "next/headers";

export const GOOGLE_ACCESS_COOKIE = "giroksam-google-access";
export const GOOGLE_STATE_COOKIE = "giroksam-google-state";

export const googleCookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

export function googleConfiguration(origin: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth configuration is missing");
  return {
    clientId,
    clientSecret,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `${origin}/api/google/callback`,
  };
}

export async function googleAccessToken() {
  return (await cookies()).get(GOOGLE_ACCESS_COOKIE)?.value ?? "";
}

export async function googleApi<T>(url: string, token: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Google API ${response.status}: ${detail.slice(0, 500)}`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return response.json() as Promise<T>;
}
