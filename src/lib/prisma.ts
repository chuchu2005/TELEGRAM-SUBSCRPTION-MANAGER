import { PrismaClient } from '@prisma/client'
import { withAccelerate } from '@prisma/extension-accelerate'

// Prisma Accelerate routes all queries through Prisma's HTTP gateway. This is
// REQUIRED on Cloudflare Workers: Prisma's MongoDB connector uses a Rust query
// engine (native binary) that cannot run inside the Workers V8 isolate, and
// there is no MongoDB driver adapter. At runtime DATABASE_URL must be the
// Accelerate proxy URL (prisma://...); DIRECT_DATABASE_URL is the real
// mongodb+srv:// used only for `prisma db push` / migrations.
//
// We apply $extends(withAccelerate()) at runtime, but cast the result back to
// PrismaClient for TypeScript. The extended client is API-compatible with
// PrismaClient for every standard query this app uses, and casting preserves
// correct relation/include payload inference — the Accelerate extension's own
// types drop relation inference in this Prisma version, which broke the build.
// Accelerate-specific options (e.g. cacheStrategy) are not used here.
function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  }).$extends(withAccelerate()) as unknown as PrismaClient
}

// Singleton pattern to prevent multiple Prisma Client instances in development.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
