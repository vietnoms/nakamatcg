/**
 * Every page and API route needs a session, except the login page and the files the phone
 * must be able to load before signing in (service worker, manifest, icons, scanner engine).
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/auth/session";

const PUBLIC = [/^\/login(\/|$)/, /^\/sw\.js$/, /^\/manifest\.webmanifest$/, /^\/icons\//, /^\/vendor\//, /^\/api\/health$/];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // sticker QR codes are uppercase (alphanumeric mode keeps them small): /U/K7M2QX -> /u/K7M2QX
  if (pathname.startsWith("/U/")) {
    const url = request.nextUrl.clone();
    url.pathname = `/u/${pathname.slice(3)}`;
    return NextResponse.redirect(url);
  }
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "signed out" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
