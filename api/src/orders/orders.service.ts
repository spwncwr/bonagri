import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private generateOrderNumber() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = Math.floor(100000 + Math.random() * 900000);

    return `BON-${date}-${suffix}`;
  }

  async getBuyerOrders(userId: string) {
    const buyer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        status: true,
      },
    });

    if (!buyer) {
      throw new NotFoundException("Buyer not found");
    }

    if (buyer.role !== "BUYER") {
      throw new BadRequestException("User is not a buyer");
    }

    return this.prisma.order.findMany({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              include: {
                supplier: true,
              },
            },
          },
        },
        deliveryAddress: true,
        payment: true,
        delivery: true,
        invoice: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async getSupplierOrders(userId: string) {
    const supplier = await this.prisma.supplierProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        businessName: true,
        verified: true,
      },
    });

    if (!supplier) {
      throw new NotFoundException("Supplier profile not found");
    }

    return this.prisma.order.findMany({
      where: {
        items: {
          some: {
            product: {
              supplierId: supplier.id,
            },
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        items: {
          include: {
            product: {
              include: {
                supplier: true,
                category: true,
              },
            },
          },
        },
        deliveryAddress: true,
        payment: true,
        delivery: true,
        invoice: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async createOrder(dto: CreateOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      const buyer = await tx.user.findUnique({
        where: { id: dto.userId },
        select: {
          id: true,
          role: true,
          status: true,
        },
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
          userId: dto.userId,
        },
      });

      if (!address) {
        throw new NotFoundException(
          "Delivery address not found for this buyer",
        );
      }

      const product = await tx.product.findUnique({
        where: { id: dto.productId },
        include: {
          inventory: true,
        },
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

      if (dto.quantity > available) {
        throw new BadRequestException(
          `Only ${available} ${product.unit} available`,
        );
      }

      const subtotal = Number(product.price) * dto.quantity;
      const deliveryFee = 0;
      const total = subtotal + deliveryFee;

      const order = await tx.order.create({
        data: {
          orderNumber: this.generateOrderNumber(),
          userId: dto.userId,
          deliveryAddressId: dto.deliveryAddressId,
          status: "PENDING",
          subtotal,
          deliveryFee,
          total,
          notes: dto.notes,
          items: {
            create: {
              productId: product.id,
              productName: product.name,
              unitPrice: product.price,
              quantity: dto.quantity,
              lineTotal: subtotal,
            },
          },
        },
        include: {
          items: true,
          deliveryAddress: true,
        },
      });

      await tx.inventory.update({
        where: { productId: product.id },
        data: {
          reservedQuantity: {
            increment: dto.quantity,
          },
        },
      });

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        total: order.total,
        items: order.items,
        deliveryAddress: order.deliveryAddress,
      };
    });
  }

  async updateOrderStatus(
    orderId: string,
    dto: UpdateOrderStatusDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              product: {
                include: {
                  inventory: true,
                },
              },
            },
          },
        },
      });

      if (!order) {
        throw new NotFoundException("Order not found");
      }

      const current = order.status;
      const next = dto.status;

      const allowedTransitions: Record<string, string[]> = {
        PENDING: ["CONFIRMED", "CANCELLED"],
        CONFIRMED: ["PROCESSING"],
        PROCESSING: ["READY_FOR_DELIVERY"],
        READY_FOR_DELIVERY: ["OUT_FOR_DELIVERY"],
        OUT_FOR_DELIVERY: ["DELIVERED"],
        DELIVERED: [],
        CANCELLED: [],
      };

      if (!allowedTransitions[current]?.includes(next)) {
        throw new BadRequestException(
          `Order cannot move from ${current} to ${next}`,
        );
      }

      if (next === "CANCELLED") {
        for (const item of order.items) {
          if (!item.product.inventory) {
            throw new BadRequestException(
              `Inventory record missing for ${item.productName}`,
            );
          }

          await tx.inventory.update({
            where: {
              productId: item.productId,
            },
            data: {
              reservedQuantity: {
                decrement: item.quantity,
              },
            },
          });
        }
      }

      if (next === "CONFIRMED") {
        for (const item of order.items) {
          const inventory = item.product.inventory;

          if (!inventory) {
            throw new BadRequestException(
              `Inventory record missing for ${item.productName}`,
            );
          }

          if (inventory.reservedQuantity < item.quantity) {
            throw new BadRequestException(
              `Reserved inventory is insufficient for ${item.productName}`,
            );
          }

          await tx.inventory.update({
            where: {
              productId: item.productId,
            },
            data: {
              quantity: {
                decrement: item.quantity,
              },
              reservedQuantity: {
                decrement: item.quantity,
              },
            },
          });
        }
      }

      const updated = await tx.order.update({
        where: {
          id: orderId,
        },
        data: {
          status: next,
          ...(next === "READY_FOR_DELIVERY"
            ? {
                delivery: {
                  upsert: {
                    create: {
                      status: "PENDING",
                    },
                    update: {},
                  },
                },
              }
            : {}),
        },
        include: {
          items: true,
          deliveryAddress: true,
          payment: true,
          delivery: true,
          invoice: true,
        },
      });

      return updated;
    });
  }
}
