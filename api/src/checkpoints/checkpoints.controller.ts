import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { UserRole } from "../common/types";
import { CheckpointsService } from "./checkpoints.service";
import { CreateCheckpointDto } from "./dto/create-checkpoint.dto";

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    role: UserRole;
  };
};

// CP15a: the checkpoint ledger rides beside the CP14 state machine. Writes
// are restricted to the two evidence-producing actors; reads are audience-
// scoped in the service (order counterparties + admin, else 404). There is
// no update/delete route — the ledger is create-only by construction.
@Controller("deliveries")
@UseGuards(JwtAuthGuard)
export class CheckpointsController {
  constructor(private readonly checkpointsService: CheckpointsService) {}

  @Post(":id/checkpoints")
  @Roles("TRANSPORTER", "SUPPLIER")
  @UseGuards(RolesGuard)
  createCheckpoint(
    @Req() request: AuthenticatedRequest,
    @Param("id") deliveryId: string,
    @Body() dto: CreateCheckpointDto,
  ) {
    return this.checkpointsService.createCheckpoint(
      deliveryId,
      { id: request.user.id, role: request.user.role },
      dto,
    );
  }

  @Get(":id/checkpoints")
  listCheckpoints(
    @Req() request: AuthenticatedRequest,
    @Param("id") deliveryId: string,
  ) {
    return this.checkpointsService.listCheckpoints(deliveryId, {
      id: request.user.id,
      role: request.user.role,
    });
  }
}
