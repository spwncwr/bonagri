import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAddressDto } from "./dto/create-address.dto";

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async getBuyerAddresses(userId: string) {
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
}
