import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAddressDto } from "./dto/create-address.dto";
import { UpdateAddressDto } from "./dto/update-address.dto";

function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = "code" in error ? (error as { code?: unknown }).code : undefined;

  if (code === "P2003") {
    return true;
  }

  const message =
    "message" in error
      ? String((error as { message?: unknown }).message)
      : "";

  return message.toLowerCase().includes("foreign key");
}

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  private async getActiveBuyer(userId: string) {
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

    if (buyer.status !== "ACTIVE") {
      throw new BadRequestException("Buyer account is not active");
    }

    return buyer;
  }

  async getBuyerAddresses(userId: string) {
    await this.getActiveBuyer(userId);

    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [
        { isDefault: "desc" },
        { createdAt: "desc" },
      ],
    });
  }

  async createBuyerAddress(
    userId: string,
    dto: CreateAddressDto,
  ) {
    await this.getActiveBuyer(userId);

    const existingCount = await this.prisma.address.count({
      where: { userId },
    });

    const shouldBeDefault =
      dto.isDefault === true || existingCount === 0;

    return this.prisma.$transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.address.updateMany({
          where: {
            userId,
            isDefault: true,
          },
          data: {
            isDefault: false,
          },
        });
      }

      return tx.address.create({
        data: {
          userId,
          label: dto.label.trim(),
          recipientName: dto.recipientName.trim(),
          phone: dto.phone?.trim(),
          addressLine1: dto.addressLine1.trim(),
          addressLine2: dto.addressLine2?.trim(),
          city: dto.city.trim(),
          province: dto.province?.trim(),
          postalCode: dto.postalCode?.trim(),
          country: dto.country?.trim() || "South Africa",
          isDefault: shouldBeDefault,
        },
      });
    });
  }

  async updateBuyerAddress(
    userId: string,
    addressId: string,
    dto: UpdateAddressDto,
  ) {
    await this.getActiveBuyer(userId);

    const existing = await this.prisma.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundException("Address not found");
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true && !existing.isDefault) {
        await tx.address.updateMany({
          where: {
            userId,
            isDefault: true,
            id: { not: addressId },
          },
          data: {
            isDefault: false,
          },
        });
      }

      return tx.address.update({
        where: { id: addressId },
        data: {
          ...(dto.label !== undefined
            ? { label: dto.label.trim() }
            : {}),
          ...(dto.recipientName !== undefined
            ? { recipientName: dto.recipientName.trim() }
            : {}),
          ...(dto.phone !== undefined
            ? { phone: dto.phone.trim() }
            : {}),
          ...(dto.addressLine1 !== undefined
            ? { addressLine1: dto.addressLine1.trim() }
            : {}),
          ...(dto.addressLine2 !== undefined
            ? { addressLine2: dto.addressLine2.trim() }
            : {}),
          ...(dto.city !== undefined
            ? { city: dto.city.trim() }
            : {}),
          ...(dto.province !== undefined
            ? { province: dto.province.trim() }
            : {}),
          ...(dto.postalCode !== undefined
            ? { postalCode: dto.postalCode.trim() }
            : {}),
          ...(dto.country !== undefined
            ? { country: dto.country.trim() }
            : {}),
          ...(dto.isDefault !== undefined
            ? { isDefault: dto.isDefault }
            : {}),
          // CP15a: delivery reference pin (either half may be cleared with
          // an explicit null via the pair semantics — partial pairs are
          // rejected by the flag engine, not here).
          ...(dto.lat !== undefined ? { lat: dto.lat } : {}),
          ...(dto.lng !== undefined ? { lng: dto.lng } : {}),
        },
      });
    });
  }

  async deleteBuyerAddress(userId: string, addressId: string) {
    await this.getActiveBuyer(userId);

    const existing = await this.prisma.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundException("Address not found");
    }

    return this.prisma.$transaction(async (tx) => {
      try {
        await tx.address.delete({
          where: { id: addressId },
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new BadRequestException(
            "This address is used by an existing order and cannot be deleted",
          );
        }

        throw error;
      }

      // Keep the list default-ordered: promote the newest remaining
      // address when the default one is removed.
      if (existing.isDefault) {
        const nextDefault = await tx.address.findFirst({
          where: { userId },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });

        if (nextDefault) {
          await tx.address.update({
            where: { id: nextDefault.id },
            data: { isDefault: true },
          });
        }
      }

      return { id: addressId, deleted: true };
    });
  }
}
