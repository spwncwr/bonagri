// The seed and the runtime smoke suite both mutate data in place — they create
// accounts, re-role the smoke buyer and overwrite the admin password — so they
// must never be pointed at a deployed database by accident.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

const AUTHORITY = /^[a-zA-Z][\w+.-]*:\/\/(?:[^/?#]*@)?([^/?#]+)/;

// "db.example.com:5432" → "db.example.com", "::1" and "[::1]:5432" → "::1".
function hostFromAuthority(authority: string): string {
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");

    return end === -1 ? authority : authority.slice(1, end);
  }

  const firstColon = authority.indexOf(":");
  const isBareIpv6 =
    firstColon !== -1 && authority.indexOf(":", firstColon + 1) !== -1;

  if (firstColon === -1 || isBareIpv6) {
    return authority;
  }

  return authority.slice(0, firstColon);
}

export function databaseHost(connectionString: string): string | null {
  try {
    const host = new URL(connectionString).hostname;

    if (host) {
      return hostFromAuthority(host).toLowerCase();
    }
  } catch {
    // Bare IPv6 authorities such as postgresql://x@::1/db are not valid WHATWG
    // URLs, so read the authority out of the string instead.
  }

  const match = AUTHORITY.exec(connectionString);

  return match ? hostFromAuthority(match[1]).toLowerCase() : null;
}

export function isLocalDatabase(connectionString: string): boolean {
  const host = databaseHost(connectionString);

  return host !== null && LOCAL_HOSTS.has(host);
}

/**
 * Throws unless the connection string points at a local database, or the caller
 * has explicitly opted into a remote target with `SEED_ALLOW_REMOTE=true`.
 */
export function assertSeedTargetAllowed(
  connectionString: string,
  allowRemote = false,
): void {
  if (isLocalDatabase(connectionString) || allowRemote) {
    return;
  }

  const host = databaseHost(connectionString) ?? "an unparseable target";

  throw new Error(
    `Development seed blocked for host "${host}": this seed overwrites demo ` +
      "account passwords and re-roles users. Run it against a local database, " +
      "or set SEED_ALLOW_REMOTE=true if the target is a throwaway environment " +
      "you own.",
  );
}
