# 0001 Monorepo Foundation

Broadside starts as an npm workspace with separate app, API, and shared packages.

- `apps/app` owns the Expo Router client.
- `apps/api` owns the Fastify API and exposes an app factory for tests.
- `packages/shared` owns cross-platform constants, schemas, and API contracts.

Tests import public package boundaries so implementation details can move without rewriting the test suite.
