import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MediaService } from "../media/media.service";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {}

  // PATCH /profile/me — name, contact number and display picture for any
  // signed-in account. The caller owns the row (userId comes from the JWT),
  // so there is nothing else to authorise.
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, avatarPublicId: true },
    });

    if (!profile) {
      throw new NotFoundException("Account not found");
    }

    const data: {
      firstName?: string;
      lastName?: string;
      phone?: string | null;
      avatarUrl?: string | null;
      avatarPublicId?: string | null;
    } = {};

    if (dto.firstName !== undefined) {
      const firstName = dto.firstName.trim();
      if (!firstName) {
        throw new BadRequestException("First name cannot be empty");
      }
      data.firstName = firstName;
    }

    if (dto.lastName !== undefined) {
      const lastName = dto.lastName.trim();
      if (!lastName) {
        throw new BadRequestException("Last name cannot be empty");
      }
      data.lastName = lastName;
    }

    if (dto.phone !== undefined) {
      data.phone = dto.phone ? dto.phone.trim() : null;
    }

    const nextAvatarPublicId =
      dto.avatarUrl === undefined
        ? undefined
        : this.mediaService.derivePublicId(dto.avatarUrl);

    if (dto.avatarUrl !== undefined) {
      data.avatarUrl = dto.avatarUrl;
      data.avatarPublicId = nextAvatarPublicId;
    }

    const updated = await this.prisma.user.update({
      where: { id: profile.id },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        role: true,
        status: true,
      },
    });

    // A replaced display picture must not leave its old asset behind.
    if (
      profile.avatarPublicId &&
      nextAvatarPublicId !== undefined &&
      nextAvatarPublicId !== profile.avatarPublicId
    ) {
      await this.mediaService.destroyAsset(profile.avatarPublicId);
    }

    return updated;
  }
}
