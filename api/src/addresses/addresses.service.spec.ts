import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AddressesService } from "./addresses.service";

function makeService() {
  const tx = {
    address: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (callback: (t: typeof tx) => unknown) =>
      callback(tx),
    ),
    user: { findUnique: jest.fn() },
    address: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };

  const service = new AddressesService(prisma as never);

  const primeActiveBuyer = () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "buyer-1",
      role: "BUYER",
      status: "ACTIVE",
    });
  };

  return { service, prisma, tx, primeActiveBuyer };
}

const updateDto = { label: "Work" };

describe("AddressesService (CP2 consumer flow)", () => {
  it("rejects address management from a non-buyer", async () => {
    const { service, prisma } = makeService();

    prisma.user.findUnique.mockResolvedValue({
      id: "supplier-user-1",
      role: "SUPPLIER",
      status: "ACTIVE",
    });

    await expect(
      service.getBuyerAddresses("supplier-user-1"),
    ).rejects.toThrow("User is not a buyer");
  });

  describe("updateBuyerAddress", () => {
    it("hides addresses that belong to another user", async () => {
      const { service, prisma, primeActiveBuyer } = makeService();
      primeActiveBuyer();
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(
        service.updateBuyerAddress("buyer-1", "addr-9", updateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it("promotes the address to default and unsets the others", async () => {
      const { service, prisma, tx, primeActiveBuyer } = makeService();
      primeActiveBuyer();
      prisma.address.findFirst.mockResolvedValue({
        id: "addr-1",
        userId: "buyer-1",
        isDefault: false,
      });
      tx.address.updateMany.mockResolvedValue({ count: 1 });
      tx.address.update.mockResolvedValue({ id: "addr-1" });

      await service.updateBuyerAddress("buyer-1", "addr-1", {
        isDefault: true,
      });

      expect(tx.address.updateMany).toHaveBeenCalledWith({
        where: {
          userId: "buyer-1",
          isDefault: true,
          id: { not: "addr-1" },
        },
        data: { isDefault: false },
      });
      expect(tx.address.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "addr-1" },
          data: { isDefault: true },
        }),
      );
    });

    it("only touches the fields that were provided", async () => {
      const { service, prisma, tx, primeActiveBuyer } = makeService();
      primeActiveBuyer();
      prisma.address.findFirst.mockResolvedValue({
        id: "addr-1",
        userId: "buyer-1",
        isDefault: true,
      });
      tx.address.update.mockResolvedValue({ id: "addr-1" });

      await service.updateBuyerAddress("buyer-1", "addr-1", updateDto);

      expect(tx.address.update).toHaveBeenCalledWith({
        where: { id: "addr-1" },
        data: { label: "Work" },
      });
      expect(tx.address.updateMany).not.toHaveBeenCalled();
    });

    it("passes the CP15a delivery reference pin through", async () => {
      const { service, prisma, tx, primeActiveBuyer } = makeService();
      primeActiveBuyer();
      prisma.address.findFirst.mockResolvedValue({
        id: "addr-1",
        userId: "buyer-1",
        isDefault: true,
      });
      tx.address.update.mockResolvedValue({ id: "addr-1" });

      await service.updateBuyerAddress("buyer-1", "addr-1", {
        lat: -23.9,
        lng: 29.46,
      });

      expect(tx.address.update).toHaveBeenCalledWith({
        where: { id: "addr-1" },
        data: { lat: -23.9, lng: 29.46 },
      });
    });
  });

  describe("deleteBuyerAddress", () => {
    it("hides addresses that belong to another user", async () => {
      const { service, prisma, primeActiveBuyer } = makeService();
      primeActiveBuyer();
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteBuyerAddress("buyer-1", "addr-9"),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects deletion when an existing order uses the address", async () => {
      const { service, prisma, tx, primeActiveBuyer } = makeService();
      primeActiveBuyer();
      prisma.address.findFirst.mockResolvedValue({
        id: "addr-1",
        userId: "buyer-1",
        isDefault: false,
      });
      tx.address.delete.mockRejectedValue(
        Object.assign(new Error("foreign key constraint"), {
          code: "P2003",
        }),
      );

      await expect(
        service.deleteBuyerAddress("buyer-1", "addr-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("promotes the newest remaining address after deleting the default", async () => {
      const { service, prisma, tx, primeActiveBuyer } = makeService();
      primeActiveBuyer();
      prisma.address.findFirst.mockResolvedValue({
        id: "addr-1",
        userId: "buyer-1",
        isDefault: true,
      });
      tx.address.delete.mockResolvedValue({});
      tx.address.findFirst.mockResolvedValue({ id: "addr-2" });
      tx.address.update.mockResolvedValue({ id: "addr-2" });

      const result = await service.deleteBuyerAddress(
        "buyer-1",
        "addr-1",
      );

      expect(result).toEqual({ id: "addr-1", deleted: true });
      expect(tx.address.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "buyer-1" } }),
      );
      expect(tx.address.update).toHaveBeenCalledWith({
        where: { id: "addr-2" },
        data: { isDefault: true },
      });
    });

    it("does not attempt a promotion when no addresses remain", async () => {
      const { service, prisma, tx, primeActiveBuyer } = makeService();
      primeActiveBuyer();
      prisma.address.findFirst.mockResolvedValue({
        id: "addr-1",
        userId: "buyer-1",
        isDefault: true,
      });
      tx.address.delete.mockResolvedValue({});
      tx.address.findFirst.mockResolvedValue(null);

      await service.deleteBuyerAddress("buyer-1", "addr-1");

      expect(tx.address.update).not.toHaveBeenCalled();
    });
  });

  describe("createBuyerAddress", () => {
    it("makes the very first address the default automatically", async () => {
      const { service, prisma, tx, primeActiveBuyer } = makeService();
      primeActiveBuyer();
      prisma.address.count.mockResolvedValue(0);
      tx.address.create.mockResolvedValue({ id: "addr-1" });

      await service.createBuyerAddress("buyer-1", {
        label: "Home",
        recipientName: "Thandi",
        addressLine1: "1 Marula St",
        city: "Tzaneen",
      } as never);

      expect(tx.address.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "buyer-1", isDefault: true },
        }),
      );
      expect(tx.address.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isDefault: true }),
        }),
      );
    });
  });
});
