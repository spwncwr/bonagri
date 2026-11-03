import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertSeedTargetAllowed,
  databaseHost,
  isLocalDatabase,
} from "./local-database";

const LOCAL = "postgresql://bonagri:secret@localhost:5432/bonagri";

describe("local database guard", () => {
  it("recognises the hosts a developer actually runs locally", () => {
    expect(isLocalDatabase(LOCAL)).toBe(true);
    expect(isLocalDatabase("postgresql://x@127.0.0.1:5432/bonagri")).toBe(true);
    expect(isLocalDatabase("postgresql://x@localhost/bonagri")).toBe(true);
    expect(isLocalDatabase("postgresql://x@::1/bonagri")).toBe(true);
    expect(isLocalDatabase("postgresql://x@[::1]:5432/bonagri")).toBe(true);
    expect(isLocalDatabase("postgresql://x@LOCALHOST:5432/bonagri")).toBe(true);
  });

  it("reads the host even when the password contains an @", () => {
    expect(databaseHost("postgresql://u:p@ss@localhost:5432/db")).toBe("localhost");
    expect(
      databaseHost("postgresql://u:p@ss@ep-remote.aws.neon.tech:5432/neondb"),
    ).toBe("ep-remote.aws.neon.tech");
  });

  it("rejects deployed hosts and unusable connection strings", () => {
    expect(
      isLocalDatabase(
        "postgresql://neondb_owner:pw@ep-steep-queen-baet1ic0-privatelink.aws.neon.tech/neondb",
      ),
    ).toBe(false);
    expect(isLocalDatabase("not a connection string")).toBe(false);
    expect(databaseHost("not a connection string")).toBeNull();
  });

  it("blocks a remote seed unless the caller opts in explicitly", () => {
    const remote = "postgresql://x@ep-something.aws.neon.tech/neondb";

    expect(() => assertSeedTargetAllowed(LOCAL)).not.toThrow();
    expect(() => assertSeedTargetAllowed(remote)).toThrow(
      /Development seed blocked for host "ep-something.aws.neon.tech"/,
    );
    expect(() => assertSeedTargetAllowed(remote, true)).not.toThrow();
    expect(assertSeedTargetAllowed(remote, true)).toBeUndefined();
  });

  it("stays wired into the seed and the runtime smoke entry points", () => {
    const seed = readFileSync(join(__dirname, "seed.ts"), "utf8");
    expect(seed).toContain("assertSeedTargetAllowed(");

    const smoke = readFileSync(
      join(__dirname, "../../scripts/runtime-smoke.sh"),
      "utf8",
    );
    expect(smoke).toContain("local_url \"$API_URL\"");
    expect(smoke).toContain("only targets a local development server");
  });
});
