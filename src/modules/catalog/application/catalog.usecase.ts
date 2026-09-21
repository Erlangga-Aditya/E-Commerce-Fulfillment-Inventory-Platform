import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { validateSku } from '../domain/catalog.entity';

// ────────────────────────────────────────────────────────────
// Validation Schemas
// ────────────────────────────────────────────────────────────

export const CreateVariantSchema = z.object({
  sku: z.string().min(2).max(50),
  barcode: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  weight: z.number().positive().optional(),
  imageUrl: z.string().url().optional().or(z.literal('')),
});

export const CreateProductSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(100).optional(),
  variants: z.array(CreateVariantSchema).min(1),
});

export const UpdateProductSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});

export const UpdateVariantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  barcode: z.string().max(100).optional(),
  weight: z.number().positive().optional(),
  imageUrl: z.string().url().optional().or(z.literal('')),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});

// ────────────────────────────────────────────────────────────
// Use Cases
// ────────────────────────────────────────────────────────────

export async function createProduct(
  tenantId: string,
  input: z.infer<typeof CreateProductSchema>,
  actorId: string,
) {
  // Validate SKUs
  for (const v of input.variants) {
    if (!validateSku(v.sku)) {
      throw new ValidationError(`Format SKU tidak valid: ${v.sku}`);
    }
  }

  // Check if any SKU already exists in this tenant's products
  const existingVariant = await prisma.productVariant.findFirst({
    where: {
      product: { tenantId },
      sku: { in: input.variants.map((v) => v.sku) },
    },
  });

  if (existingVariant) {
    throw new ConflictError(`SKU '${existingVariant.sku}' sudah digunakan di produk lain.`);
  }

  const product = await prisma.product.create({
    data: {
      tenantId,
      name: input.name,
      description: input.description,
      category: input.category,
      variants: {
        create: input.variants.map((v) => ({
          sku: v.sku,
          barcode: v.barcode ?? null,
          name: v.name,
          weight: v.weight ?? null,
          imageUrl: v.imageUrl || null,
        })),
      },
    },
    include: { variants: true },
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'product_create',
    entityType: 'Product',
    entityId: product.id,
    metadata: { name: product.name, variantCount: product.variants.length },
  });

  return product;
}

export async function listProducts(
  tenantId: string,
  options: {
    search?: string;
    category?: string;
    status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
    page?: number;
    pageSize?: number;
  } = {},
) {
  const { search, category, status, page = 1, pageSize = 20 } = options;
  const skip = (page - 1) * pageSize;

  const where = {
    tenantId,
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            {
              variants: {
                some: {
                  OR: [
                    { sku: { contains: search } },
                    { name: { contains: search } },
                    { barcode: { contains: search } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        variants: {
          include: {
            inventoryBalances: {
              select: {
                onHand: true,
                reserved: true,
                blocked: true,
                warehouseId: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      status: p.status,
      createdAt: p.createdAt,
      variants: p.variants.map((v) => {
        const totalOnHand = v.inventoryBalances.reduce((s, b) => s + b.onHand, 0);
        const totalReserved = v.inventoryBalances.reduce((s, b) => s + b.reserved, 0);
        const totalBlocked = v.inventoryBalances.reduce((s, b) => s + b.blocked, 0);
        const totalAvailable = Math.max(0, totalOnHand - totalReserved - totalBlocked);

        return {
          id: v.id,
          sku: v.sku,
          barcode: v.barcode,
          name: v.name,
          weight: v.weight,
          imageUrl: v.imageUrl,
          status: v.status,
          stock: {
            onHand: totalOnHand,
            reserved: totalReserved,
            blocked: totalBlocked,
            available: totalAvailable,
          },
        };
      }),
    })),
    pagination: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getProductById(tenantId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    include: {
      variants: {
        include: {
          inventoryBalances: {
            include: { warehouse: { select: { id: true, name: true, code: true } } },
          },
        },
      },
    },
  });

  if (!product) throw new NotFoundError('Produk', productId);
  return product;
}

export async function updateProduct(
  tenantId: string,
  productId: string,
  input: z.infer<typeof UpdateProductSchema>,
  actorId: string,
) {
  const existing = await prisma.product.findFirst({
    where: { id: productId, tenantId },
  });

  if (!existing) throw new NotFoundError('Produk', productId);

  const updated = await prisma.product.update({
    where: { id: productId },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'product_update',
    entityType: 'Product',
    entityId: productId,
    metadata: input,
  });

  return updated;
}
