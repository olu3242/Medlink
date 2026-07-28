import { z } from "zod";
import { CatalogApplication } from "../../../../lib/application";
import { runApi } from "../../../../lib/api-server";

const listSchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.enum(["draft", "active", "inactive"]).optional(),
});
const createSchema = z.object({
  brandName: z.string().trim().min(2).max(200),
  genericName: z.string().trim().min(2).max(300),
  dosageForm: z.string().trim().min(2).max(100),
  route: z.string().trim().min(2).max(100),
  strength: z.string().trim().min(1).max(100),
  manufacturer: z.string().trim().max(200).optional(),
  controlled: z.boolean().default(false),
});

export const GET = (request: Request) => runApi(request, {
  name: "catalog.medicines.list",
  permission: "medicine:read",
  schema: listSchema,
  input: async (value) => {
    const query = new URL(value.url).searchParams;
    return {
      query: query.get("q") || undefined,
      status: query.get("status") || undefined,
    };
  },
  execute: async (input, _context, database) =>
    new CatalogApplication(database).list(input),
  success: ({ items, total }) => Response.json({ data: items, meta: { total } }),
});

export const POST = (request: Request) => runApi(request, {
  name: "catalog.medicines.create",
  permission: "medicine:manage",
  schema: createSchema,
  input: (value) => value.json(),
  execute: async (input, _context, database) =>
    new CatalogApplication(database).create(input),
  success: (data) => Response.json({ data }, { status: 201 }),
});
