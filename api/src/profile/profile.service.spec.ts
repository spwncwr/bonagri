import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ProfileService } from "./profile.service";

function makeService() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const media = {
    derivePublicId: jest.fn().mockReturnValue(null),
    destroyAsset: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new ProfileService(prisma as never, media as never),
    prisma,
    media,
  };
}

describe("ProfileService (account settings)", () => {
  it("updates name and contact for the signed-in account only", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      avatarPublicId: null,
    });
    prisma.user.update.mockResolvedValue({ id: "user-1" });

    await service.updateProfile("user-1", {
      firstName: "Thandi",
      lastName: "Mokoena",
      phone: "072 000 0001",
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: {
          firstName: "Thandi",
          lastName: "Mokoena",
          phone: "072 000 0001",
        },
      }),
    );
  });

  it("trims names and refuses to blank one out", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      avatarPublicId: null,
    });
    prisma.user.update.mockResolvedValue({ id: "user-1" });

    await service.updateProfile("user-1", { firstName: "  Kgaugelo  " });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { firstName: "Kgaugelo" } }),
    );

    await expect(
      service.updateProfile("user-1", { firstName: "   " }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it("clears the contact number when null is sent", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      avatarPublicId: "bonagri/avatar/old",
    });
    prisma.user.update.mockResolvedValue({ id: "user-1" });

    await service.updateProfile("user-1", { phone: null });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { phone: null } }),
    );
    // a phone change must not touch the stored photo
    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty(
      "avatarUrl",
    );
  });

  it("stores the display picture and derives its public id", async () => {
    const { service, prisma, media } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      avatarPublicId: null,
    });
    media.derivePublicId.mockReturnValue("bonagri/avatar/uuid-1");
    prisma.user.update.mockResolvedValue({ id: "user-1" });

    const url =
      "https://res.cloudinary.com/demo/image/upload/v7/bonagri/avatar/uuid-1.png";

    await service.updateProfile("user-1", { avatarUrl: url });

    expect(media.derivePublicId).toHaveBeenCalledWith(url);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { avatarUrl: url, avatarPublicId: "bonagri/avatar/uuid-1" },
      }),
    );
    expect(media.destroyAsset).not.toHaveBeenCalled();
  });

  it("replacing or clearing the photo destroys the previous asset", async () => {
    const { service, prisma, media } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      avatarPublicId: "bonagri/avatar/old",
    });
    prisma.user.update.mockResolvedValue({ id: "user-1" });

    media.derivePublicId.mockReturnValue("bonagri/avatar/new");
    await service.updateProfile("user-1", {
      avatarUrl:
        "https://res.cloudinary.com/demo/image/upload/v8/bonagri/avatar/new.png",
    });

    expect(media.destroyAsset).toHaveBeenCalledWith("bonagri/avatar/old");

    // clearing it outright cleans up too
    media.derivePublicId.mockReturnValue(null);
    media.destroyAsset.mockClear();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      avatarPublicId: "bonagri/avatar/new",
    });

    await service.updateProfile("user-1", { avatarUrl: null });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { avatarUrl: null, avatarPublicId: null } }),
    );
    expect(media.destroyAsset).toHaveBeenCalledWith("bonagri/avatar/new");
  });

  it("404s when the account no longer exists", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.updateProfile("ghost", { firstName: "Nobody" }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
