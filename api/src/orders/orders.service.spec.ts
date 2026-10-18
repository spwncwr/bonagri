import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { OrdersService } from "./orders.service";

type TxMock = {
  user: { findUnique: jest.Mock };
  address: { findFirst: jest.Mock };
  product: { findUnique: jest.Mock };
  inventory: { update: jest.Mock; updateMany: jest.Mock };
  order: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  orderStatusHistory: { create: jest.Mock };
  supplierProfile: { findUnique: jest.Mock };
  invoice: { upsert: jest.Mock };
  delivery: { findUnique: jest.Mock };
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
    invoice: { upsert: jest.fn() },
    delivery: { findUnique: jest.fn() },
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
    payment: { create: jest.fn(), update: jest.fn() },
  };

  const notifications = {
    onOrderStatusChanged: jest.fn(),
    onPaymentDecision: jest.fn(),
  };

  return {
    service: new OrdersService(prisma as never, notifications as never),
    prisma,
    notifications,
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

    it("lets the buyer cancel their own PENDING order and releases stock", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primePendingOrder(tx);
      tx.inventory.updateMany.mockResolvedValue({ count: 1 });

      await service.updateOrderStatus("order-1", "buyer-1", "BUYER", {
        status: "CANCELLED",
      } as never);

      expect(tx.inventory.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            productId: "prod-1",
            reservedQuantity: { gte: 2 },
          }),
          data: { reservedQuantity: { decrement: 2 } },
        }),
      );
      expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          orderId: "order-1",
          fromStatus: "PENDING",
          toStatus: "CANCELLED",
          actorUserId: "buyer-1",
          actorRole: "BUYER",
          note: null,
        },
      });
    });

    it("rejects a buyer cancelling somebody else's order", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primePendingOrder(tx);
      tx.order.findUnique.mockResolvedValue({
        id: "order-1",
        userId: "other-buyer",
        status: "PENDING",
        items: [],
      });

      await expect(
        service.updateOrderStatus("order-1", "buyer-1", "BUYER", {
          status: "CANCELLED",
        } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects a buyer cancelling an order past PENDING", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primePendingOrder(tx);
      tx.order.findUnique.mockResolvedValue({
        id: "order-1",
        userId: "buyer-1",
        status: "CONFIRMED",
        items: [],
      });

      await expect(
        service.updateOrderStatus("order-1", "buyer-1", "BUYER", {
          status: "CANCELLED",
        } as never),
      ).rejects.toThrow(
        "Buyers can only cancel their own pending orders",
      );
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

describe("OrdersService (CP4 agro dealers)", () => {
  function primePendingOrder(tx: TxMock, supplierId = "sup-dealer") {
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "buyer-1",
      status: "PENDING",
      items: [
        {
          productId: "prod-tool-1",
          quantity: 1,
          productName: "Electric Fence Energizer 12J",
          product: {
            supplierId,
            inventory: { quantity: 10, reservedQuantity: 1 },
          },
        },
      ],
    });
    tx.order.update.mockImplementation(({ data }: { data: unknown }) =>
      Promise.resolve({ id: "order-1", ...(data as object) }),
    );
  }

  it("lets an AGRO_DEALER advance an order containing their product", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    primePendingOrder(tx);
    tx.supplierProfile.findUnique.mockResolvedValue({ id: "sup-dealer" });
    tx.inventory.update.mockResolvedValue({});

    await service.updateOrderStatus(
      "order-1",
      "dealer-user-1",
      "AGRO_DEALER",
      { status: "CONFIRMED" } as never,
    );

    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: {
        orderId: "order-1",
        fromStatus: "PENDING",
        toStatus: "CONFIRMED",
        actorUserId: "dealer-user-1",
        actorRole: "AGRO_DEALER",
        note: null,
      },
    });
  });

  it("rejects an AGRO_DEALER advancing another vendor's order", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    primePendingOrder(tx, "sup-other-vendor");
    tx.supplierProfile.findUnique.mockResolvedValue({ id: "sup-dealer" });

    await expect(
      service.updateOrderStatus("order-1", "dealer-user-1", "AGRO_DEALER", {
        status: "CONFIRMED",
      } as never),
    ).rejects.toThrow(NotFoundException);

    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it("scopes the AGRO_DEALER order list to their own products", async () => {
    const tx = makeTx();
    const { service, prisma } = makeService(tx);

    prisma.supplierProfile.findUnique.mockResolvedValue({
      id: "sup-dealer",
      userId: "dealer-user-1",
      businessName: "Limpopo Agro Equipment",
      verified: false,
    });
    prisma.order.findMany.mockResolvedValue([{ id: "order-1" }]);

    const orders = await service.getSupplierOrders(
      "dealer-user-1",
      "AGRO_DEALER",
    );

    expect(orders).toEqual([{ id: "order-1" }]);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          items: {
            some: {
              product: {
                supplierId: "sup-dealer",
              },
            },
          },
        },
      }),
    );
  });

  it("lets an AGRO_DEALER view an order containing their product (and hides others)", async () => {
    const tx = makeTx();
    const { service, prisma } = makeService(tx);

    prisma.order.findUnique.mockResolvedValue({
      id: "order-1",
      items: [{ product: { supplierId: "sup-dealer" } }],
    });
    prisma.supplierProfile.findUnique.mockResolvedValue({
      id: "sup-dealer",
    });

    await expect(
      service.getOrderDetail("order-1", "dealer-user-1", "AGRO_DEALER"),
    ).resolves.toEqual({
      id: "order-1",
      items: [{ product: { supplierId: "sup-dealer" } }],
    });

    prisma.supplierProfile.findUnique.mockResolvedValue({
      id: "sup-dealer",
    });

    prisma.order.findUnique.mockResolvedValue({
      id: "order-2",
      items: [{ product: { supplierId: "sup-other-vendor" } }],
    });

    await expect(
      service.getOrderDetail("order-2", "dealer-user-1", "AGRO_DEALER"),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("OrdersService (CP11 manual EFT payments)", () => {
  function primeBuyerOrder(
    prisma: { order: { findUnique: jest.Mock } },
    overrides: Record<string, unknown> = {},
  ) {
    prisma.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "BON-20261014-111111",
      userId: "buyer-1",
      status: "PENDING",
      subtotal: 40,
      deliveryFee: 0,
      total: 40,
      payment: null,
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
      ...overrides,
    });
  }

  describe("recordPayment", () => {
    it("records manual EFT evidence against the buyer's pending order", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeBuyerOrder(prisma);
      prisma.payment.create.mockResolvedValue({
        id: "pay-1",
        status: "PENDING",
      });

      const result = await service.recordPayment("order-1", "buyer-1", {
        transactionRef: "  EFT-12345  ",
      } as never);

      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: {
          orderId: "order-1",
          provider: "MANUAL",
          status: "PENDING",
          amount: 40,
          transactionRef: "EFT-12345",
        },
      });
      expect(result).toEqual({ id: "pay-1", status: "PENDING" });
    });

    it("hides an order owned by a different buyer (404)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeBuyerOrder(prisma, { userId: "other-buyer" });

      await expect(
        service.recordPayment("order-1", "buyer-1", {
          transactionRef: "EFT-12345",
        } as never),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it("hides a missing order (404)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.recordPayment("missing", "buyer-1", {
          transactionRef: "EFT-12345",
        } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects recording evidence on a non-pending order (409)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeBuyerOrder(prisma, { status: "CONFIRMED" });

      await expect(
        service.recordPayment("order-1", "buyer-1", {
          transactionRef: "EFT-12345",
        } as never),
      ).rejects.toThrow(ConflictException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it("rejects a duplicate while awaiting verification (409)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeBuyerOrder(prisma, {
        payment: { id: "pay-1", status: "PENDING" },
      });

      await expect(
        service.recordPayment("order-1", "buyer-1", {
          transactionRef: "EFT-12345",
        } as never),
      ).rejects.toThrow(
        "Payment already recorded for this order and is awaiting supplier verification",
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it("rejects re-recording after verification (409)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeBuyerOrder(prisma, {
        payment: { id: "pay-1", status: "PAID" },
      });

      await expect(
        service.recordPayment("order-1", "buyer-1", {
          transactionRef: "EFT-12345",
        } as never),
      ).rejects.toThrow(
        "Payment for this order has already been verified",
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it("lets the buyer re-record a corrected reference after a rejection", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeBuyerOrder(prisma, {
        payment: { id: "pay-1", status: "FAILED", paidAt: null },
      });
      prisma.payment.update.mockResolvedValue({
        id: "pay-1",
        status: "PENDING",
      });

      const result = await service.recordPayment("order-1", "buyer-1", {
        transactionRef: "EFT-CORRECTED",
      } as never);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: "pay-1" },
        data: {
          status: "PENDING",
          transactionRef: "EFT-CORRECTED",
          paidAt: null,
        },
      });
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(result).toEqual({ id: "pay-1", status: "PENDING" });
    });

    it("rejects a reference that trims below 3 characters", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeBuyerOrder(prisma);

      await expect(
        service.recordPayment("order-1", "buyer-1", {
          transactionRef: "  a  ",
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe("updatePayment", () => {
    function primeDecision(
      prisma: {
        order: { findUnique: jest.Mock };
        supplierProfile: { findUnique: jest.Mock };
      },
      payment: Record<string, unknown> | null,
    ) {
      primeBuyerOrder(prisma, { payment });
      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
    }

    it("lets the owning supplier verify the evidence and notifies the buyer", async () => {
      const tx = makeTx();
      const { service, prisma, notifications } = makeService(tx);

      primeDecision(prisma, { id: "pay-1", status: "PENDING" });
      prisma.payment.update.mockResolvedValue({
        id: "pay-1",
        status: "PAID",
        paidAt: new Date(),
      });

      await service.updatePayment("order-1", "supplier-user-1", "SUPPLIER", {
        status: "PAID",
      } as never);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: "pay-1" },
        data: { status: "PAID", paidAt: expect.any(Date) },
      });
      expect(notifications.onPaymentDecision).toHaveBeenCalledWith(
        { orderNumber: "BON-20261014-111111", userId: "buyer-1" },
        "PAID",
      );
    });

    it("lets the supplier reject the evidence without stamping paidAt", async () => {
      const tx = makeTx();
      const { service, prisma, notifications } = makeService(tx);

      primeDecision(prisma, { id: "pay-1", status: "PENDING" });
      prisma.payment.update.mockResolvedValue({
        id: "pay-1",
        status: "FAILED",
        paidAt: null,
      });

      await service.updatePayment("order-1", "supplier-user-1", "SUPPLIER", {
        status: "FAILED",
      } as never);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: "pay-1" },
        data: { status: "FAILED", paidAt: null },
      });
      expect(notifications.onPaymentDecision).toHaveBeenCalledWith(
        { orderNumber: "BON-20261014-111111", userId: "buyer-1" },
        "FAILED",
      );
    });

    it("hides an order the supplier does not own (404)", async () => {
      const tx = makeTx();
      const { service, prisma, notifications } = makeService(tx);

      primeDecision(prisma, { id: "pay-1", status: "PENDING" });
      prisma.supplierProfile.findUnique.mockResolvedValue({
        id: "sup-other-vendor",
      });

      await expect(
        service.updatePayment("order-1", "supplier-user-1", "SUPPLIER", {
          status: "PAID",
        } as never),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(notifications.onPaymentDecision).not.toHaveBeenCalled();
    });

    it("hides the order from a supplier without a profile (404)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeDecision(prisma, { id: "pay-1", status: "PENDING" });
      prisma.supplierProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePayment("order-1", "supplier-user-1", "SUPPLIER", {
          status: "PAID",
        } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects a decision when no payment was recorded (409)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeDecision(prisma, null);

      await expect(
        service.updatePayment("order-1", "supplier-user-1", "SUPPLIER", {
          status: "PAID",
        } as never),
      ).rejects.toThrow("No payment has been recorded for this order");
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it("rejects double verification (409)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeDecision(prisma, {
        id: "pay-1",
        status: "PAID",
        paidAt: new Date(),
      });

      await expect(
        service.updatePayment("order-1", "supplier-user-1", "SUPPLIER", {
          status: "PAID",
        } as never),
      ).rejects.toThrow(
        "Payment for this order has already been verified",
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it("rejects repeating a rejection (409)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeDecision(prisma, { id: "pay-1", status: "FAILED", paidAt: null });

      await expect(
        service.updatePayment("order-1", "supplier-user-1", "SUPPLIER", {
          status: "FAILED",
        } as never),
      ).rejects.toThrow(
        "Payment for this order has already been rejected",
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it("lets an admin decide on any order without an ownership lookup", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeDecision(prisma, { id: "pay-1", status: "PENDING" });
      prisma.payment.update.mockResolvedValue({
        id: "pay-1",
        status: "PAID",
        paidAt: new Date(),
      });

      await service.updatePayment("order-1", "admin-1", "ADMIN", {
        status: "PAID",
      } as never);

      expect(prisma.supplierProfile.findUnique).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalled();
    });

    it("rejects a buyer trying to decide on payment (400)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeDecision(prisma, { id: "pay-1", status: "PENDING" });

      await expect(
        service.updatePayment("order-1", "buyer-1", "BUYER", {
          status: "PAID",
        } as never),
      ).rejects.toThrow("Unsupported user role");
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });
  });

  describe("invoice on first CONFIRMED", () => {
    function primeConfirmedOrder(tx: TxMock) {
      tx.order.findUnique.mockResolvedValue({
        id: "order-1",
        orderNumber: "BON-20261014-222222",
        userId: "buyer-1",
        status: "PENDING",
        subtotal: 40,
        deliveryFee: 0,
        total: 40,
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
      tx.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      tx.inventory.update.mockResolvedValue({});
    }

    it("issues INV-<orderNumber> atomically with the transition", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primeConfirmedOrder(tx);
      tx.invoice.upsert.mockResolvedValue({ id: "inv-1" });

      await service.updateOrderStatus("order-1", "supplier-user-1", "SUPPLIER", {
        status: "CONFIRMED",
      } as never);

      expect(tx.invoice.upsert).toHaveBeenCalledWith({
        where: { orderId: "order-1" },
        create: {
          orderId: "order-1",
          invoiceNumber: "INV-BON-20261014-222222",
          subtotal: 40,
          deliveryFee: 0,
          total: 40,
        },
        update: {},
      });
    });

    it("issues no invoice when the buyer cancels instead", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primeConfirmedOrder(tx);
      tx.inventory.updateMany.mockResolvedValue({ count: 1 });

      await service.updateOrderStatus("order-1", "buyer-1", "BUYER", {
        status: "CANCELLED",
      } as never);

      expect(tx.invoice.upsert).not.toHaveBeenCalled();
    });
  });
});

describe("OrdersService (CP12 delivery tracking)", () => {
  function primeTransitionOrder(tx: TxMock, status = "READY_FOR_DELIVERY") {
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "BON-20261018-111111",
      userId: "buyer-1",
      status,
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
    tx.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
  }

  describe("updateOrderStatus (delivery details)", () => {
    it("records driver details on the OUT_FOR_DELIVERY transition", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primeTransitionOrder(tx, "READY_FOR_DELIVERY");

      await service.updateOrderStatus("order-1", "supplier-user-1", "SUPPLIER", {
        status: "OUT_FOR_DELIVERY",
        driverName: "  Thabo Mokoena  ",
        driverPhone: "072 123 4567",
        estimatedDate: "2026-10-20",
        trackingNumber: " TRK-1001 ",
      } as never);

      expect(tx.delivery.findUnique).toHaveBeenCalledWith({
        where: { trackingNumber: "TRK-1001" },
        select: { orderId: true },
      });

      const updateArg = tx.order.update.mock.calls[0][0] as {
        data: {
          status: string;
          delivery: {
            upsert: {
              create: Record<string, unknown>;
              update: Record<string, unknown>;
            };
          };
        };
      };

      expect(updateArg.data.status).toBe("OUT_FOR_DELIVERY");
      expect(updateArg.data.delivery.upsert.create).toEqual(
        expect.objectContaining({
          status: "ASSIGNED",
          driverName: "Thabo Mokoena",
          driverPhone: "072 123 4567",
          estimatedDate: expect.any(Date),
          trackingNumber: "TRK-1001",
          pickedUpAt: expect.any(Date),
        }),
      );
      expect(updateArg.data.delivery.upsert.update).toEqual(
        expect.objectContaining({
          status: "ASSIGNED",
          driverName: "Thabo Mokoena",
        }),
      );
    });

    it("still assigns the delivery when no details are provided", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primeTransitionOrder(tx, "READY_FOR_DELIVERY");

      await service.updateOrderStatus("order-1", "supplier-user-1", "SUPPLIER", {
        status: "OUT_FOR_DELIVERY",
      } as never);

      const updateArg = tx.order.update.mock.calls[0][0] as {
        data: { delivery: { upsert: { create: Record<string, unknown> } } };
      };

      expect(updateArg.data.delivery.upsert.create).toEqual({
        status: "ASSIGNED",
        pickedUpAt: expect.any(Date),
      });
      expect(tx.delivery.findUnique).not.toHaveBeenCalled();
    });

    it("treats a blank tracking number as not provided", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primeTransitionOrder(tx, "READY_FOR_DELIVERY");

      await service.updateOrderStatus("order-1", "supplier-user-1", "SUPPLIER", {
        status: "OUT_FOR_DELIVERY",
        trackingNumber: "   ",
      } as never);

      const updateArg = tx.order.update.mock.calls[0][0] as {
        data: { delivery: { upsert: { create: Record<string, unknown> } } };
      };

      expect("trackingNumber" in updateArg.data.delivery.upsert.create).toBe(
        false,
      );
      expect(tx.delivery.findUnique).not.toHaveBeenCalled();
    });

    it("rejects delivery details on any other transition (400)", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primeTransitionOrder(tx, "PENDING");

      await expect(
        service.updateOrderStatus("order-1", "supplier-user-1", "SUPPLIER", {
          status: "CONFIRMED",
          driverName: "Thabo Mokoena",
        } as never),
      ).rejects.toThrow(
        "Delivery details can only be set when marking an order out for delivery",
      );
      expect(tx.order.update).not.toHaveBeenCalled();
    });

    it("rejects a tracking number already used by another delivery (409)", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primeTransitionOrder(tx, "READY_FOR_DELIVERY");
      tx.delivery.findUnique.mockResolvedValue({ orderId: "other-order" });

      await expect(
        service.updateOrderStatus("order-1", "supplier-user-1", "SUPPLIER", {
          status: "OUT_FOR_DELIVERY",
          trackingNumber: "TRK-1001",
        } as never),
      ).rejects.toThrow("Tracking number is already used by another delivery");
      expect(tx.order.update).not.toHaveBeenCalled();
    });

    it("closes the delivery out with deliveredAt at DELIVERED", async () => {
      const tx = makeTx();
      const { service } = makeService(tx);

      primeTransitionOrder(tx, "OUT_FOR_DELIVERY");

      await service.updateOrderStatus("order-1", "supplier-user-1", "SUPPLIER", {
        status: "DELIVERED",
      } as never);

      const updateArg = tx.order.update.mock.calls[0][0] as {
        data: { delivery: { upsert: { create: Record<string, unknown> } } };
      };

      expect(updateArg.data.delivery.upsert.create).toEqual({
        status: "DELIVERED",
        deliveredAt: expect.any(Date),
      });
    });
  });

  describe("getDelivery", () => {
    const delivery = {
      id: "delivery-1",
      orderId: "order-1",
      status: "ASSIGNED",
      trackingNumber: "TRK-1001",
      driverName: "Thabo Mokoena",
      driverPhone: "072 123 4567",
      estimatedDate: new Date("2026-10-20"),
      pickedUpAt: new Date(),
      deliveredAt: null,
    };

    function primeDetail(
      prisma: {
        order: { findUnique: jest.Mock };
        supplierProfile: { findUnique: jest.Mock };
      },
      overrides: Record<string, unknown> = {},
    ) {
      prisma.order.findUnique.mockResolvedValue({
        id: "order-1",
        orderNumber: "BON-20261018-111111",
        userId: "buyer-1",
        status: "OUT_FOR_DELIVERY",
        delivery,
        items: [{ product: { supplierId: "sup-1" } }],
        ...overrides,
      });
      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
    }

    it("returns tracking to the buyer owner", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeDetail(prisma);

      await expect(
        service.getDelivery("order-1", "buyer-1", "BUYER"),
      ).resolves.toEqual(delivery);
    });

    it("returns tracking to a supplier of the order", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeDetail(prisma);

      await expect(
        service.getDelivery("order-1", "supplier-user-1", "SUPPLIER"),
      ).resolves.toEqual(delivery);
    });

    it("returns tracking to an admin without an ownership lookup", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeDetail(prisma);

      await expect(
        service.getDelivery("order-1", "admin-1", "ADMIN"),
      ).resolves.toEqual(delivery);
      expect(prisma.supplierProfile.findUnique).not.toHaveBeenCalled();
    });

    it("hides the order from another buyer (404)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeDetail(prisma);

      await expect(
        service.getDelivery("order-1", "other-buyer", "BUYER"),
      ).rejects.toThrow(NotFoundException);
    });

    it("hides the order from a supplier who does not own it (404)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeDetail(prisma);
      prisma.supplierProfile.findUnique.mockResolvedValue({
        id: "sup-other-vendor",
      });

      await expect(
        service.getDelivery("order-1", "supplier-user-1", "SUPPLIER"),
      ).rejects.toThrow(NotFoundException);
    });

    it("hides the order from a supplier without a profile (404)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeDetail(prisma);
      prisma.supplierProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.getDelivery("order-1", "supplier-user-1", "AGRO_DEALER"),
      ).rejects.toThrow(NotFoundException);
    });

    it("404s when the order has no delivery row yet", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      primeDetail(prisma, { delivery: null });

      await expect(
        service.getDelivery("order-1", "buyer-1", "BUYER"),
      ).rejects.toThrow("No delivery tracking exists for this order yet");
    });

    it("hides a missing order (404)", async () => {
      const tx = makeTx();
      const { service, prisma } = makeService(tx);

      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.getDelivery("missing", "buyer-1", "BUYER"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
