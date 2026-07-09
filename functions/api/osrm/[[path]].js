// Cloudflare Pages Function — deployed automatically at /api/osrm/*
// File location in the repo: functions/api/osrm/[[path]].js
//
// Why this exists: the public OSRM routing servers (router.project-osrm.org and
// routing.openstreetmap.de) are unreachable directly from some networks/browsers
// (confirmed: blocked on Cade's network specifically, while Nominatim geocoding
// works fine). Running the proxy here means the browser only ever talks to our
// own same-origin domain; the actual outbound request to OSRM happens from
// Cloudflare's edge network, which has no trouble reaching it. No API key, no
// cost — this runs on Cloudflare Pages Functions' free tier.
//
// It also chains two free OSRM-compatible backends for resilience: if the main
// public OSRM server errors or times out, it retries against the OpenStreetMap
// Germany mirror before giving up. The client's existing haversine fallback
// still applies if both are ever down at once.

const UPSTREAMS = [
  "https://router.project-osrm.org",
  "https://routing.openstreetmap.de/routed-car",
];

export async function onRequest(context) {
  const { request, params } = context;
  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const url = new URL(request.url);
  const suffix = `/${path}${url.search}`;

  let lastError = null;
  for (const base of UPSTREAMS) {
    try {
      const resp = await fetch(base + suffix, {
        headers: { Accept: "application/json" },
        // Cloudflare Functions default timeout is generous, but don't hang forever
        // on a dead upstream — let the next one (or the client's own fallback) take over.
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        const body = await resp.text();
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=300", // routes between two fixed points rarely change minute to minute
          },
        });
      }
      lastError = `upstream ${base} responded ${resp.status}`;
    } catch (e) {
      lastError = `upstream ${base} failed: ${e.message || e}`;
    }
  }

  return new Response(JSON.stringify({ code: "Error", message: lastError || "all upstream routing services unreachable" }), {
    status: 502,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
