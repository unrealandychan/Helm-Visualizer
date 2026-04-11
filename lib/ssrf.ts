import { promises as dns } from "dns";

// Private / loopback address patterns — fast-path string check before DNS resolution.
const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fe80:|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i;

/**
 * Returns true when an IPv4 address falls within a private, loopback,
 * link-local, or otherwise non-routable range.
 */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // treat malformed as unsafe
  }
  const [a, b] = parts;
  return (
    a === 0 ||                                // 0.0.0.0/8 — "this" network
    a === 10 ||                               // 10.0.0.0/8 — private
    a === 127 ||                              // 127.0.0.0/8 — loopback
    (a === 100 && b >= 64 && b <= 127) ||     // 100.64.0.0/10 — shared address space
    (a === 169 && b === 254) ||               // 169.254.0.0/16 — link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||      // 172.16.0.0/12 — private
    (a === 192 && b === 168) ||               // 192.168.0.0/16 — private
    a >= 240                                  // 240.0.0.0/4 — reserved
  );
}

/**
 * Returns true when an IPv6 address is a loopback, link-local, or ULA address.
 * IPv4-mapped addresses (::ffff:x.x.x.x) are handled by the caller, which
 * extracts the embedded IPv4 address and passes it to `isPrivateIpv4` instead.
 */
function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "::1" ||           // loopback
    normalized === "::" ||            // unspecified
    normalized.startsWith("fe80:") || // fe80::/10 — link-local
    normalized.startsWith("fc") ||    // fc00::/7 — ULA (covers fc00:: through fdff::)
    normalized.startsWith("fd")       // fc00::/7 — ULA (covers fc00:: through fdff::)
  );
}

/**
 * Resolve `hostname` via DNS and throw if any returned address is private/internal.
 *
 * Performs a cheap string-pattern check first (fast path), then resolves the
 * hostname to actual IP addresses to prevent DNS-rebinding attacks where a
 * public domain is made to resolve to an internal IP.
 */
export async function assertSafeHostname(hostname: string): Promise<void> {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Fast path: reject well-known private hostname patterns without a DNS round-trip.
  if (PRIVATE_HOST_RE.test(h)) {
    throw new Error("Requests to private or loopback addresses are not allowed.");
  }

  // Resolve and inspect every returned address to block DNS-rebinding attacks.
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve hostname "${hostname}".`);
  }

  if (addresses.length === 0) {
    throw new Error(`Could not resolve hostname "${hostname}".`);
  }

  for (const { address, family } of addresses) {
    // Handle IPv4-mapped IPv6 addresses (e.g. "::ffff:192.168.1.1")
    const ipv4Mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    const unsafe = ipv4Mapped
      ? isPrivateIpv4(ipv4Mapped)
      : family === 6
        ? isPrivateIpv6(address)
        : isPrivateIpv4(address);

    if (unsafe) {
      throw new Error("Requests to private or loopback addresses are not allowed.");
    }
  }
}

/**
 * Parse `raw` as a URL, enforce the https:// or oci:// scheme, and verify that
 * the host does not resolve to a private address (DNS-rebinding safe).
 */
export async function assertSafeUrl(raw: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "oci:") {
    throw new Error("Only https:// and oci:// URLs are allowed.");
  }

  await assertSafeHostname(parsed.hostname);
}
