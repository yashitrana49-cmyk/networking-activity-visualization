/**
 * True for loopback, link-local, and RFC1918 private IPv4 addresses,
 * plus IPv6 loopback / link-local. Mirrors the backend's
 * `is_private_or_local_ip` guard so client and server agree.
 */
export function isPrivateOrLocalIp(ip: string): boolean {
  if (ip === "::1" || ip.startsWith("fe80:")) {
    return true;
  }

  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);

  if (!match) {
    return false;
  }

  const first = Number(match[1]);
  const second = Number(match[2]);

  return (
    first === 127 ||
    first === 10 ||
    first === 0 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}
