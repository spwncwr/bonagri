import { validate } from "class-validator";
import { ListUsersQueryDto } from "./list-users-query.dto";

// Regression: CP14 shipped the TRANSPORTER role in the TS union and the admin
// UI filter without adding it to @IsIn, so ?role=TRANSPORTER was rejected 400
// by the global ValidationPipe while every other role worked.
describe("ListUsersQueryDto", () => {
  it("accepts every role the admin users filter offers", async () => {
    const roles = [
      "BUYER",
      "SUPPLIER",
      "AGRO_DEALER",
      "TRANSPORTER",
      "ADMIN",
    ] as const;

    for (const role of roles) {
      const dto = new ListUsersQueryDto();
      dto.role = role;
      await expect(validate(dto)).resolves.toHaveLength(0);
    }
  });

  it("rejects roles outside the allowed set", async () => {
    const dto = new ListUsersQueryDto();
    dto.role = "SUPERADMIN" as ListUsersQueryDto["role"];

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isIn).toBeDefined();
  });
});
