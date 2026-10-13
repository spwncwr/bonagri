import { NotFoundException } from "@nestjs/common";
import { OrdersService } from "./orders.service";

type TxMock = {
  user: { findUnique: jest.Mock };
  address: { findFirst: jest.Mock };
  product: { findUnique: jest.Mock };
  inventory: { update: jest.Mock; updateMany: jest.Mock };
  order: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  orderStatusHistory: { create: jest.Mock };
  supplierProfile: { findUnique: jest.Mock };
};

function makeTx(): TxMock {
  return {
    user: { findUnique: jest.fn() },
    address: { findFirst: jest.fn() },
    product: { findUnique: jest.fn() },
    inventory: { update: jest.fn(), updateMany: jest.fn() },
    order: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
    supplierProfile: { findUnique: jest.fn() },
  };
}

function makeService(tx: TxMock) {
  const prisma = {
    $transaction: jest.fn(async (callback: (t: TxMock) => unknown) =>
      callback(tx),
    ),
    user: { findUnique: jest.fn() },
    order: { findMany: jest.fn(), findUnique: jest.fn() },
    supplierProfile: { findUnique: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
  };

  return {
    service: new OrdersService(prisma as never),
    prisma,
  };
}

describe("OrdersService (CP0 foundations)", () => {
  describe("createOrder", () => {
    it("writes an initial PENDING history row for the buyer", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      tx.user.findUnique.mockResolvedValue({
        id: "buyer-1",
        role: "BUYER",
        status: "ACTIVE",
      });
      tx.address.findFirst.mockResolvedValue({ id: "addr-1" });
      tx.product.findUnique.mockResolvedValue({
        id: "prod-1",
        name: "Fresh Tomatoes",
        price: 18,
        unit: "kg",
        status: "ACTIVE",
        inventory: { quantity: 10, reservedQuantity: 0 },
      });
      tx.order.create.mockResolvedValue({
        id: "order-1",
        orderNumber: "BON-1",
        status: "PENDING",
        subtotal: 36,
        deliveryFee: 0,
        total: 36,
        items: [],
        deliveryAddress: { id: "addr-1" },
      });
      tx.inventory.update.mockResolvedValue({});

      await service.createOrder("buyer-1", {
        deliveryAddressId: "addr-1",
        productId: "prod-1",
        quantity: 2,
      } as never);

      expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          orderId: "order-1",
          fromStatus: null,
          toStatus: "PENDING",
          actorUserId: "buyer-1",
          actorRole: "BUYER",
          note: "Order placed",
        },
      });
    });
  });

  describe("updateOrderStatus", () => {
    function primePendingOrder(tx: TxMock) {
      tx.order.findUnique.mockResolvedValue({
        id: "order-1",
        userId: "buyer-1",
        status: "PENDING",
        items: [
          {
            productId: "prod-1",
            quantity: 2,
            productName: "Fresh Tomatoes",
            product: {
              supplierId: "sup-1",
              inventory: { quantity: 10, reservedQuantity: 2 },
            },
          },
        ],
      });
      tx.order.update.mockImplementation(({ data }: { data: unknown }) =>
        Promise.resolve({ id: "order-1", ...(data as object) }),
      );
    }

    it("writes a PENDING -> CONFIRMED history row for the supplier", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primePendingOrder(tx);
      tx.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      tx.inventory.update.mockResolvedValue({});

      await service.updateOrderStatus("order-1", "supplier-user-1", "SUPPLIER", {
        status: "CONFIRMED",
      } as never);

      expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          orderId: "order-1",
          fromStatus: "PENDING",
          toStatus: "CONFIRMED",
          actorUserId: "supplier-user-1",
          actorRole: "SUPPLIER",
          note: null,
        },
      });
    });

    it("lets an admin drive transitions and records their role", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primePendingOrder(tx);
      tx.inventory.update.mockResolvedValue({});

      await service.updateOrderStatus("order-1", "admin-1", "ADMIN", {
        status: "CONFIRMED",
      } as never);

      expect(tx.orderStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: "admin-1",
            actorRole: "ADMIN",
            toStatus: "CONFIRMED",
          }),
        }),
      );
    });

    it("rejects a supplier who does not own any order item", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primePendingOrder(tx);
      tx.supplierProfile.findUnique.mockResolvedValue({ id: "other-sup" });

      await expect(
        service.updateOrderStatus("order-1", "supplier-user-1", "SUPPLIER", {
          status: "CONFIRMED",
        } as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getOrderDetail", () => {
    const order = {
      id: "order-1",
      userId: "buyer-1",
      status: "PENDING",
      user: { id: "buyer-1" },
      items: [
        { product: { supplierId: "sup-1" } },
      ],
      deliveryAddress: {},
      history: [],
    };

    it("hides the order from a different buyer", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      prisma.order.findUnique.mockResolvedValue(order);

      await expect(
        service.getOrderDetail("order-1", "other-buyer", "BUYER"),
      ).rejects.toThrow(NotFoundException);
    });

    it("hides the order from a supplier without an owning profile", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      prisma.order.findUnique.mockResolvedValue(order);
      prisma.supplierProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.getOrderDetail("order-1", "supplier-user-1", "SUPPLIER"),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns the order (with history) to the owning buyer", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      prisma.order.findUnique.mockResolvedValue(order);

      const result = await service.getOrderDetail("order-1", "buyer-1", "BUYER");

      expect(result).toBe(order);
      expect(prisma.order.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            history: { orderBy: { createdAt: "asc" } },
          }),
        }),
      );
    });

    it("returns any order to an admin", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      prisma.order.findUnique.mockResolvedValue(order);

      const result = await service.getOrderDetail("order-1", "admin-1", "ADMIN");

      expect(result).toBe(order);
    });
  });

  describe("admin platform-wide lists", () => {
    it("returns all orders for an ADMIN on the buyer list route", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      prisma.order.findMany.mockResolvedValue([{ id: "order-1" }]);

      const result = await service.getBuyerOrders("admin-1", "ADMIN");

      expect(result).toHaveLength(1);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: "desc" } }),
      );
    });

    it("returns all orders for an ADMIN on the supplier list route", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      prisma.order.findMany.mockResolvedValue([{ id: "order-1" }]);

      await service.getSupplierOrders("admin-1", "ADMIN");

      expect(tx.supplierProfile.findUnique).not.toHaveBeenCalled();
      expect(prisma.order.findMany).toHaveBeenCalled();
    });

    it("still rejects a non-buyer on the buyer list route", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      prisma.user.findUnique.mockResolvedValue({
        id: "supplier-user-1",
        role: "SUPPLIER",
        status: "ACTIVE",
      });

      await expect(
        service.getBuyerOrders("supplier-user-1", "SUPPLIER"),
      ).rejects.toThrow("User is not a buyer");
    });
  });
});
