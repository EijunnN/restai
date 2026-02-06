import type { JwtPayload, CustomerJwtPayload, TenantContext } from "@restai/types";

export type AppEnv = {
  Variables: {
    user: JwtPayload | CustomerJwtPayload;
    tenant: TenantContext;
  };
};
