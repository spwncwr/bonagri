import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AddCartItemDto } from "./dto/add-cart-item.dto";
import { UpdateCartItemDto } from "./dto/update-cart-item.dto";
import { CheckoutDto } from "./dto/checkout.dto";

const CART_ITEM_SELECT = {
  id: true,
  quantity: true,
  createdAt: true,
  product: {
    select: {
      id: true,
      name: true,
      unit: true,
      price: true,
      status: true,
      supplierId: true,
      supplier: { select: { businessName: true } },
      inventory: {
        select: { quantity: true, reservedQuantity: true },
      },
    },
  },
} as const;

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async getCart(userId: string) {
    const items = await this.prisma.cartItem.findMany({
      where: { userId },
      select: CART_ITEM_SELECT,
      orderBy: { createdAt: "asc" },
    });

    return items.map((item) => {
      const inventory = item.product.inventory;
      const available = inventory
        ? inventory.quantity - inventory.reservedQuantity
        : 0;

      return {
        id: item.id,
        quantity: item.quantity,
        addedAt: item.createdAt,
        lineTotal: Number(item.product.price) * item.quantity,
        availableQuantity: available,
        inStock: item.product.status === "ACTIVE" && item.quantity <= available,
        product: {
          id: item.product.id,
          name: item.product.name,
          unit: item.product.unit,
          price: item.product.price,
          supplierName: item.product.supplier.businessName,
        },
      };
    });
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { inventory: true },
    });

    if (!product) {
      throw new NotFoundException("Product not found");
    }

    if (product.status !== "ACTIVE") {
      throw new BadRequestException("Product is not available");
    }

    if (!product.inventory) {
      throw new BadRequestException("Product has no inventory record");
    }

    const available =
      product.inventory.quantity - product.inventory.reservedQuantity;

    const existing = await this.prisma.cartItem.findUnique({
      where: {
        userId_productId: { userId, productId: dto.productId },
      },
    });

    const newQuantity = (existing?.quantity ?? 0) + dto.quantity;

    if (newQuantity > available) {
      throw new BadRequestException(
        `Only ${available} ${product.unit} available`,
      );
    }

    if (existing) {
      return this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: newQuantity },
      });
    }

    return this.prisma.cartItem.create({
      data: {
        userId,
        productId: dto.productId,
        quantity: dto.quantity,
      },
    });
  }

  async updateItem(userId: string, itemId: string, dto: UpdateCartItemDto) {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { product: { include: { inventory: true } } },
    });

    // Foreign cart items 404 so ids cannot be probed.
    if (!item || item.userId !== userId) {
      throw new NotFoundException("Cart item not found");
    }

    if (item.product.status !== "ACTIVE") {
      throw new ConflictException("Product is no longer available");
    }

    const available = item.product.inventory
      ? item.product.inventory.quantity -
        item.product.inventory.reservedQuantity
      : 0;

    if (dto.quantity > available) {
      throw new BadRequestException(
        `Only ${available} ${item.product.unit} available`,
      );
    }

    return this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: dto.quantity },
    });
  }

  async removeItem(userId: string, itemId: string) {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      select: { id: true, userId: true },
    });

    if (!item || item.userId !== userId) {
      throw new NotFoundException("Cart item not found");
    }

    await this.prisma.cartItem.delete({ where: { id: itemId } });

    return { id: itemId, removed: true };
  }

  async clearCart(userId: string) {
    const { count } = await this.prisma.cartItem.deleteMany({
      where: { userId },
    });

    return { cleared: count };
  }

  // One order per supplier, linked by orderGroupId - the whole existing
  // single-supplier lifecycle (transitions, disputes, notifications) works
  // per order untouched. Any short item or delisted product rolls the whole
  // checkout back.
  async checkout(userId: string, dto: CheckoutDto) {
    return this.prisma.$transaction(async (tx) => {
      const buyer = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, status: true },
      });

      if (!buyer) {
        throw new NotFoundException("Buyer not found");
      }

      if (buyer.role !== "BUYER") {
        throw new BadRequestException("User is not a buyer");
      }

      if (buyer.status !== "ACTIVE") {
        throw new BadRequestException("Buyer account is not active");
      }

      const address = await tx.address.findFirst({
        where: {
          id: dto.deliveryAddressId,
          userId,
        },
      });

      if (!address) {
        throw new NotFoundException(
          "Delivery address not found for this buyer",
        );
      }

      const cartItems = await tx.cartItem.findMany({
        where: { userId },
        select: CART_ITEM_SELECT,
        orderBy: { createdAt: "asc" },
      });

      if (cartItems.length === 0) {
        throw new BadRequestException("Cart is empty");
      }

      for (const item of cartItems) {
        if (item.product.status !== "ACTIVE") {
          throw new ConflictException(
            `${item.product.name} is no longer available`,
          );
        }

        const available = item.product.inventory
          ? item.product.inventory.quantity -
            item.product.inventory.reservedQuantity
          : 0;

        if (item.quantity > available) {
          throw new ConflictException(
            `Only ${available} ${item.product.unit} of ${item.product.name} available`,
          );
        }
      }

      const bySupplier = new Map<
        string,
        typeof cartItems
      >();

      for (const item of cartItems) {
        const group = bySupplier.get(item.product.supplierId) ?? [];
        group.push(item);
        bySupplier.set(item.product.supplierId, group);
      }

      const orderGroupId = randomUUID();
      const orders = [];

      for (const group of bySupplier.values()) {
        let subtotal = 0;

        for (const item of group) {
          subtotal += Number(item.product.price) * item.quantity;
        }

        const deliveryFee = 0;
        const total = subtotal + deliveryFee;

        const order = await tx.order.create({
          data: {
            orderNumber: this.generateOrderNumber(),
            userId,
            deliveryAddressId: dto.deliveryAddressId,
            orderGroupId,
            status: "PENDING",
            subtotal,
            deliveryFee,
            total,
            notes: dto.notes,
            items: {
              create: group.map((item) => ({
                productId: item.product.id,
                productName: item.product.name,
                unitPrice: item.product.price,
                quantity: item.quantity,
                lineTotal: Number(item.product.price) * item.quantity,
              })),
            },
          },
          include: {
            items: true,
            deliveryAddress: true,
          },
        });

        for (const item of group) {
          await tx.inventory.update({
            where: { productId: item.product.id },
            data: {
              reservedQuantity: {
                increment: item.quantity,
              },
            },
          });
        }

        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: null,
            toStatus: "PENDING",
            actorUserId: userId,
            actorRole: "BUYER",
            note: "Order placed from cart",
          },
        });

        orders.push({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          subtotal: order.subtotal,
          deliveryFee: order.deliveryFee,
          total: order.total,
          supplierName: group[0].product.supplier.businessName,
          items: order.items,
          deliveryAddress: order.deliveryAddress,
        });
      }

      await tx.cartItem.deleteMany({ where: { userId } });

      return {
        orderGroupId,
        orderCount: orders.length,
        orders,
      };
    });
  }

  // Mirrors OrdersService.generateOrderNumber (kept local to avoid a shared
  // util for one function; same BON-YYYYMMDD-NNNNNN format).
  private generateOrderNumber() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = Math.floor(100000 + Math.random() * 900000);

    return `BON-${date}-${suffix}`;
  }
}
