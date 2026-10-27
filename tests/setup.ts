// Test bootstrap. Route modules are imported directly (no HTTP server), so
// any env var the Prisma client or Paystack calls need at construction time
// gets a clearly-fake placeholder. Real credentials are never used in tests.
process.env.DATABASE_URL ??= 'postgresql://dummy:dummy@localhost:5432/dummy'
process.env.PAYSTACK_SECRET_KEY ??= 'sk_test_dummy_placeholder'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'
