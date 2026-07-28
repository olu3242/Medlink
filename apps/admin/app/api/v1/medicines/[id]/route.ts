import { z } from "zod";
import { CatalogApplication } from "../../../../../lib/application";
import { runApi } from "../../../../../lib/api-server";

const idSchema = z.string().uuid();
const updateSchema = z.object({
  brandName: z.string().trim().min(2).max(200).optional(),
  genericName: z.string().trim().min(2).max(300).optional(),
  dosageForm: z.string().trim().min(2).max(100).optional(),
  route: z.string().trim().min(2).max(100).optional(),
  strength: z.string().trim().min(1).max(100).optional(),
  manufacturer: z.string().trim().max(200).nullable().optional(),
  controlled: z.boolean().optional(),
  status: z.enum(["draft", "active", "inactive"]).optional(),
}).refine((value) => Object.keys(value).length > 0);
type Context = { params: Promise<{ id: string }> };

export const GET = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "catalog.medicines.get",
    permission: "medicine:read",
    schema: z.object({ id: idSchema }),
    input: async () => ({ id }),
    execute: async (input, _context, database) =>
      new CatalogApplication(database).get(input.id),
  });
};

export const PATCH = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "catalog.medicines.update",
    permission: "medicine:manage",
    schema: z.object({ id: idSchema, changes: updateSchema }),
    input: async (value) => ({ id, changes: await value.json() }),
    execute: async (input, _context, database) =>
      new CatalogApplication(database).update(input.id, input.changes),
  });
};
