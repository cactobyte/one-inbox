import { headers } from "next/headers";

/**
 * The externally-reachable origin of this deployment, e.g.
 * `https://one-inbox-xi.vercel.app`. Used to build links that go into emails.
 *
 * `APP_URL` wins if set (a stable custom domain). Otherwise it is derived from
 * the incoming request's forwarded headers, which Vercel populates — so it is
 * correct on preview deployments too, with nothing to configure.
 */
export async function appOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (!host) throw new Error("Cannot determine app origin: no host header");
  return `${proto}://${host}`;
}
