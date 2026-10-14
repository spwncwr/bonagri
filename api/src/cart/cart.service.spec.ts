import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { CartService } from "./cart.service";

function makeService() {
  const prisma = {
    user: { findUnique: jest.fn() },
    address: { findFirst: jest.fn() },
    product: { findUnique: jest.fn() },
    cartItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    order: { create: jest.fn() },
    inventory: { update: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  // checkout uses the interactive callback form: $transaction(fn) => fn(tx)
  prisma.$transaction.mockImplementation(
    (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
  );

  return { service: new CartService(prisma as never), prisma };
}

const activeProduct = (overrides: Record<string, unknown> = {}) => ({
  id: "prod-1",
  name: "Fresh Tomatoes",
  unit: "kg",
  price: 12,
  status: "ACTIVE",
  supplierId: "sup-1",
  supplier: { businessName: "Thornhill Farm" },
  inventory: { quantity: 10, reservedQuantity: 2 },
  ...overrides,
});

const cartItem = (overrides: Record<string, unknown> = {}) => ({
  id: "item-1",
  userId: "buyer-1",
  quantity: 3,
  createdAt: new Date("2026-10-14"),
  product: activeProduct(),
  ...overrides,
});

describe("CartService (CP10 cart + multi-item checkout)", () => {
  describe("getCart", () => {
    it("scopes to the user and computes availability, line total and stock flag", async () => {
      const { service, prisma } = makeService();

      prisma.cartItem.findMany.mockResolvedValue([
        cartItem(),
        cartItem({
          id: "item-2",
          quantity: 50,
          product: activeProduct({
            id: "prod-2",
            name: "Chilli Sauce",
            price: 30,
            status: "INACTIVE",
          }),
        }),
      ]);

      const items = await service.getCart("buyer-1");

      expect(prisma.cartItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "buyer-1" } }),
      );
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        quantity: 3,
        availableQuantity: 8,
        lineTotal: 36,
        inStock: true,
        product: { name: "Fresh Tomatoes", supplierName: "Thornhill Farm" },
      });
      // inactive product and over-quantity both flag as not orderable
      expect(items[1].inStock).toBe(false);
    });
  });

  describe("addItem", () => {
    it("creates a new line when the product is not yet in the cart", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue(activeProduct());
      prisma.cartItem.findUnique.mockResolvedValue(null);
      prisma.cartItem.create.mockResolvedValue({ id: "item-1" });

      await expect(
        service.addItem("buyer-1", { productId: "prod-1", quantity: 3 }),
      ).resolves.toEqual({ id: "item-1" });

      expect(prisma.cartItem.create).toHaveBeenCalledWith({
        data: { userId: "buyer-1", productId: "prod-1", quantity: 3 },
      });
    });

    it("increments an existing line and re-checks the combined quantity against stock", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue(activeProduct()); // available 8
      prisma.cartItem.findUnique.mockResolvedValue({ id: "item-1", quantity: 6 });
      prisma.cartItem.update.mockResolvedValue({ id: "item-1", quantity: 7 });

      await service.addItem("buyer-1", { productId: "prod-1", quantity: 1 });

      expect(prisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: "item-1" },
        data: { quantity: 7 },
      });
      expect(prisma.cartItem.create).not.toHaveBeenCalled();
    });

    it("rejects a combined quantity above available stock", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue(activeProduct()); // available 8
      prisma.cartItem.findUnique.mockResolvedValue({ id: "item-1", quantity: 6 });

      await expect(
        service.addItem("buyer-1", { productId: "prod-1", quantity: 5 }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.cartItem.create).not.toHaveBeenCalled();
      expect(prisma.cartItem.update).not.toHaveBeenCalled();
    });

    it("rejects unknown, inactive and inventory-less products", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue(null);
      await expect(
        service.addItem("buyer-1", { productId: "nope", quantity: 1 }),
      ).rejects.toThrow(NotFoundException);

      prisma.product.findUnique.mockResolvedValue(
        activeProduct({ status: "DRAFT" }),
      );
      await expect(
        service.addItem("buyer-1", { productId: "prod-1", quantity: 1 }),
      ).rejects.toThrow(BadRequestException);

      prisma.product.findUnique.mockResolvedValue(
        activeProduct({ inventory: null }),
      );
      await expect(
        service.addItem("buyer-1", { productId: "prod-1", quantity: 1 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("updateItem", () => {
    it("updates the owner's line when within stock", async () => {
      const { service, prisma } = makeService();

      prisma.cartItem.findUnique.mockResolvedValue(cartItem());
      prisma.cartItem.update.mockResolvedValue({ id: "item-1", quantity: 4 });

      await expect(
        service.updateItem("buyer-1", "item-1", { quantity: 4 }),
      ).resolves.toEqual({ id: "item-1", quantity: 4 });
    });

    it("404s on a foreign or unknown line so ids cannot be probed", async () => {
      const { service, prisma } = makeService();

      prisma.cartItem.findUnique.mockResolvedValue(
        cartItem({ userId: "someone-else" }),
      );
      await expect(
        service.updateItem("buyer-1", "item-1", { quantity: 2 }),
      ).rejects.toThrow(NotFoundException);

      prisma.cartItem.findUnique.mockResolvedValue(null);
      await expect(
        service.removeItem("buyer-1", "missing"),
      ).rejects.toThrow(NotFoundException);
    });

    it("caps quantity at available stock and rejects delisted products", async () => {
      const { service, prisma } = makeService();

      prisma.cartItem.findUnique.mockResolvedValue(cartItem()); // available 8
      await expect(
        service.updateItem("buyer-1", "item-1", { quantity: 99 }),
      ).rejects.toThrow(BadRequestException);

      prisma.cartItem.findUnique.mockResolvedValue(
        cartItem({ product: activeProduct({ status: "INACTIVE" }) }),
      );
      await expect(
        service.updateItem("buyer-1", "item-1", { quantity: 2 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("removeItem / clearCart", () => {
    it("deletes only the owner's line", async () => {
      const { service, prisma } = makeService();

      prisma.cartItem.findUnique.mockResolvedValue({
        id: "item-1",
        userId: "buyer-1",
      });
      prisma.cartItem.delete.mockResolvedValue({ id: "item-1" });

      await expect(service.removeItem("buyer-1", "item-1")).resolves.toEqual({
        id: "item-1",
        removed: true,
      });

      prisma.cartItem.findUnique.mockResolvedValue({
        id: "item-1",
        userId: "other",
      });
      await expect(service.removeItem("buyer-1", "item-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("clears every line for the user", async () => {
      const { service, prisma } = makeService();

      prisma.cartItem.deleteMany.mockResolvedValue({ count: 3 });

      await expect(service.clearCart("buyer-1")).resolves.toEqual({
        cleared: 3,
      });
      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { userId: "buyer-1" },
      });
    });
  });

  describe("checkout", () => {
    const buyerOk = { id: "buyer-1", role: "BUYER", status: "ACTIVE" };

    const twoSupplierCart = [
      cartItem(),
      cartItem({
        id: "item-2",
        quantity: 2,
        product: activeProduct({
          id: "prod-2",
          name: "Chilli Sauce",
          price: 30,
          supplierId: "sup-2",
          supplier: { businessName: "Limpopo Agro Dealer" },
        }),
      }),
    ];

    it("splits one order per supplier under a shared orderGroupId and reserves stock", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(buyerOk);
      prisma.address.findFirst.mockResolvedValue({ id: "addr-1" });
      prisma.cartItem.findMany.mockResolvedValue(twoSupplierCart);
      prisma.order.create
        .mockResolvedValueOnce({
          id: "order-1",
          orderNumber: "BON-1",
          status: "PENDING",
          subtotal: 36,
          deliveryFee: 0,
          total: 36,
          items: [{ id: "oi-1" }],
          deliveryAddress: { id: "addr-1" },
        })
        .mockResolvedValueOnce({
          id: "order-2",
          orderNumber: "BON-2",
          status: "PENDING",
          subtotal: 60,
          deliveryFee: 0,
          total: 60,
          items: [{ id: "oi-2" }],
          deliveryAddress: { id: "addr-1" },
        });
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.checkout("buyer-1", {
        deliveryAddressId: "addr-1",
        notes: "Deliver before noon",
      });

      expect(result.orderCount).toBe(2);
      expect(result.orderGroupId).toEqual(expect.any(String));
      expect(result.orders[0].orderNumber).toBe("BON-1");
      expect(result.orders[1].supplierName).toBe("Limpopo Agro Dealer");

      // both orders carry the same group id
      expect(prisma.order.create).toHaveBeenCalledTimes(2);
      const firstCreate = prisma.order.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      const secondCreate = prisma.order.create.mock.calls[1][0] as {
        data: Record<string, unknown>;
      };
      expect(firstCreate.data.orderGroupId).toBe(secondCreate.data.orderGroupId);
      expect(firstCreate.data.notes).toBe("Deliver before noon");
      expect(firstCreate.data.subtotal).toBe(36);
      expect(secondCreate.data.subtotal).toBe(60);

      // one inventory reservation per item, correct product and amount
      expect(prisma.inventory.update).toHaveBeenCalledTimes(2);
      expect(prisma.inventory.update).toHaveBeenCalledWith({
        where: { productId: "prod-1" },
        data: { reservedQuantity: { increment: 3 } },
      });
      expect(prisma.inventory.update).toHaveBeenCalledWith({
        where: { productId: "prod-2" },
        data: { reservedQuantity: { increment: 2 } },
      });

      // status history written per order, cart emptied
      expect(prisma.orderStatusHistory.create).toHaveBeenCalledTimes(2);
      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { userId: "buyer-1" },
      });
    });

    it("rejects a non-buyer and an inactive buyer", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        id: "u1",
        role: "SUPPLIER",
        status: "ACTIVE",
      });
      await expect(
        service.checkout("u1", { deliveryAddressId: "addr-1" }),
      ).rejects.toThrow(BadRequestException);

      prisma.user.findUnique.mockResolvedValue({
        id: "u1",
        role: "BUYER",
        status: "SUSPENDED",
      });
      await expect(
        service.checkout("u1", { deliveryAddressId: "addr-1" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("404s a delivery address that is not the buyer's", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(buyerOk);
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(
        service.checkout("buyer-1", { deliveryAddressId: "addr-x" }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("rejects an empty cart before writing anything", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(buyerOk);
      prisma.address.findFirst.mockResolvedValue({ id: "addr-1" });
      prisma.cartItem.findMany.mockResolvedValue([]);

      await expect(
        service.checkout("buyer-1", { deliveryAddressId: "addr-1" }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("rolls back the whole checkout naming a short item", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(buyerOk);
      prisma.address.findFirst.mockResolvedValue({ id: "addr-1" });
      prisma.cartItem.findMany.mockResolvedValue([
        cartItem({ quantity: 99 }), // available 8
      ]);

      await expect(
        service.checkout("buyer-1", { deliveryAddressId: "addr-1" }),
      ).rejects.toThrow(/of Fresh Tomatoes available/);
      expect(prisma.order.create).not.toHaveBeenCalled();
      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it("rolls back when a product in the cart was delisted", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(buyerOk);
      prisma.address.findFirst.mockResolvedValue({ id: "addr-1" });
      prisma.cartItem.findMany.mockResolvedValue([
        cartItem({ product: activeProduct({ status: "INACTIVE" }) }),
      ]);

      await expect(
        service.checkout("buyer-1", { deliveryAddressId: "addr-1" }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });
  });
});
