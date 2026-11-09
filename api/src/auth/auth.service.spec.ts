import { NotFoundException } from "@nestjs/common";
import { AuthService } from "./auth.service";

function makeService() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };
  const jwt = {
    signAsync: jest.fn().mockResolvedValue("token"),
  };
  const mail = {};

  return {
    service: new AuthService(
      prisma as never,
      jwt as never,
      mail as never,
    ),
    prisma,
  };
}

describe("AuthService.getMe (settings payload)", () => {
  it("returns the account plus both role profiles in one read", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "dev@bonagri.co.za",
      firstName: "Dev",
      lastName: "Vendor",
      phone: "015 000 0000",
      avatarUrl: "https://res.cloudinary.com/demo/image/upload/v1/a.png",
      role: "SUPPLIER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      supplierProfile: {
        businessName: "Marula Fresh",
        description: null,
        registrationNo: null,
        phone: null,
        email: null,
        address: null,
        city: "Tzaneen",
        province: "Limpopo",
        logoUrl: null,
        verified: true,
      },
      transporterProfile: null,
    });

    const me = await service.getMe("user-1");

    expect(me.avatarUrl).toContain("res.cloudinary.com");
    expect(me.supplierProfile).toMatchObject({
      businessName: "Marula Fresh",
      verified: true,
    });
    expect(me.transporterProfile).toBeNull();
    // the query must ask for both relations so one payload serves every role
    const select = prisma.user.findUnique.mock.calls[0][0].select;
    expect(select.avatarUrl).toBe(true);
    expect(select.supplierProfile.select).toMatchObject({
      businessName: true,
      verified: true,
    });
    expect(select.transporterProfile.select).toMatchObject({
      vehicleType: true,
      serviceProvinces: true,
    });
  });

  it("404s when the account no longer exists", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.getMe("ghost")).rejects.toThrow(NotFoundException);
  });
});
