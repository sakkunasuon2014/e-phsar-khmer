# Tenant module (deferred)

No tenant module exists. Current subscription purchases and entitlements belong to individual users; organization tenancy is not required for the marketplace's single-platform Bakong checkout.

## Current billing ownership

- `payment_transactions.customerId` identifies the purchasing user.
- `payment_transactions.orderId` points to the `subscription_purchases` row for subscription checkout.
- `subscription_purchases.userId` and `user_subscriptions.userId` own the purchase and resulting entitlement.
- Bakong merchant configuration is platform-level, not selected by tenant.

A tenant means an organization or billing boundary, not an individual user purchasing a package. Do not add tenant tables, tenant administration, or tenant-scoped subscriptions unless product requirements introduce organizations that own accounts or pay on behalf of members.

## Revisit when organization billing is required

Before implementing tenants, decide whether subscriptions belong to an organization or to each member, how membership roles authorize purchases, and whether each organization needs its own payment-provider credentials. Then scope related data and payment routing together; tenant CRUD alone would not provide tenant isolation.
