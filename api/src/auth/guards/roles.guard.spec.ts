import { ForbiddenException } from "@nestjs/common";
import { RolesGuard } from "./roles.guard";
import { UserRole } from "../../common/types";

function makeContext(userRole: UserRole | undefined) {
  const request = userRole ? { user: { role: userRole } } : {};

  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

function makeReflector(roles: UserRole[] | undefined) {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(roles),
  } as never;
}

describe("RolesGuard (CP4 vendor role sets)", () => {
  it("allows an AGRO_DEALER through vendor routes", () => {
    const guard = new RolesGuard(
      makeReflector(["SUPPLIER", "AGRO_DEALER"]) as never,
    );

    expect(guard.canActivate(makeContext("AGRO_DEALER"))).toBe(true);
  });

  it("allows a SUPPLIER through vendor routes", () => {
    const guard = new RolesGuard(
      makeReflector(["SUPPLIER", "AGRO_DEALER"]) as never,
    );

    expect(guard.canActivate(makeContext("SUPPLIER"))).toBe(true);
  });

  it("still blocks a BUYER from vendor routes (403)", () => {
    const guard = new RolesGuard(
      makeReflector(["SUPPLIER", "AGRO_DEALER"]) as never,
    );

    expect(() => guard.canActivate(makeContext("BUYER"))).toThrow(
      ForbiddenException,
    );
  });

  it("blocks an AGRO_DEALER from buyer-only routes (403)", () => {
    const guard = new RolesGuard(
      makeReflector(["BUYER"]) as never,
    );

    expect(() => guard.canActivate(makeContext("AGRO_DEALER"))).toThrow(
      ForbiddenException,
    );
  });

  it("lets every authenticated role through routes without metadata", () => {
    const guard = new RolesGuard(makeReflector(undefined) as never);

    expect(guard.canActivate(makeContext("AGRO_DEALER"))).toBe(true);
  });
});
