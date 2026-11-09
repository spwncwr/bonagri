import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MediaModule } from "../media/media.module";
import { ProfileController } from "./profile.controller";
import { ProfileService } from "./profile.service";

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
