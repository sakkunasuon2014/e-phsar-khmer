# Plan — billing addresses (saved list, picker modal, add/edit form)

Captain's request (2026-10-26), from five reference screenshots: the checkout should carry an
**Address** card with a saved address and a **Change Address** action; changing opens a **Billing
Address** modal listing saved addresses; **Add Address** opens a form with name, company, email,
phone, location, address, map, tax id, category and a default toggle.

**There is no billing-address backend today** — no table, no route, no action. `/me/billing-addresses`
is a mock page whose form posts nothing (and whose "location" dropdown is a list of departments).

## Backend

New table `billing_addresses` (`src/db/schema/billing-addresses.schema.ts`):

| column                                 | type                           | notes                                                    |
| -------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| id                                     | uuid pk                        | `defaultRandom()`                                        |
| user_id                                | uuid not null                  | → `users.id`, `onDelete: cascade` (AccountPurgeService)  |
| label                                  | varchar(80) not null           | "Home" / "Work" / the "Save As" text                     |
| category                               | varchar(16) not null           | `home` \| `work` \| `other`                              |
| name                                   | varchar(200) not null          |                                                          |
| company                                | varchar(200)                   |                                                          |
| email                                  | varchar(254)                   |                                                          |
| phone                                  | varchar(32) not null           | stored as typed; no E.164 normalisation                  |
| address                                | text not null                  |                                                          |
| province_id / district_id / commune_id | uuid                           | → geography, `onDelete: restrict` (same rule as `users`) |
| latitude / longitude                   | numeric(10,7)                  | map pin                                                  |
| tax_id                                 | varchar(60)                    |                                                          |
| is_default                             | boolean not null default false | partial unique index per user                            |
| created_at / updated_at                | timestamptz                    |                                                          |

Migration generated with `drizzle-kit generate` (next number after `0042_omniscient_cloak`).

Routes on the existing `UsersController` (all JWT, ownership `and(id, userId)`):

```
GET    /api/v1/users/me/billing-addresses
POST   /api/v1/users/me/billing-addresses
PATCH  /api/v1/users/me/billing-addresses/:id
DELETE /api/v1/users/me/billing-addresses/:id
```

- Setting `isDefault` clears every other row's flag in the same transaction.
- Deleting the default promotes the newest remaining row, so a list never has rows but no default.
- List returns default first, then newest.

## Web

- `actions/billing-addresses.ts` — server actions over the four routes.
- `components/billing/BillingAddressDialog.tsx` — the picker: X + title + orange **Add Address**,
  radio cards (`Home` + `Default` badge, name / phone / address, kebab for edit + delete + set
  default), **Cancel** / **Apply**.
- `components/billing/AddressFormDialog.tsx` — add/edit form: Name\*, Company, Email, Phone\*,
  Location\* (`LocationPicker`, real province/district/commune cascade), Address\*, map
  (`LocationMapPicker`), Tax ID, Category Home/Work/Other\*, Save As\* (only when Other),
  Set as default. Orange Submit, grey Cancel.
- **Checkout** — the `Billing Address` card becomes the reference's address card: the selected (or
  default) address's name / phone / address, a small map when it has coordinates, and a full-width
  **Change Address** bar that opens the picker. Empty state = the old v1 "no saved addresses" box.
- Reuses `LocationPicker`, `LocationMapPicker` and the `Dialog` primitive — no new dependencies.

## Decisions to confirm

1. **The chosen address is display-only.** The payment API has no address field, so the selection is
   not sent with the checkout. Recording it on the purchase would need a new column — follow-up.
2. **`/me/billing-addresses` stays mock for now** unless the captain wants it wired in this pass; it
   is the same backend, so wiring it later is cheap but is a second surface.

## Risks

- **Applying the migration touches the shared dev DB.** `db:generate` then `db:migrate`; the known
  watermark trap (CLAUDE.md) says simulate before trusting a migrate on an older database. I will
  generate, show the SQL, and apply only with the captain's word.
- Map tiles need network; on an offline machine the thumbnail degrades to an empty box.

## Verification

- Backend: unit tests for the default-promotion and ownership rules; `pnpm --filter backend build`,
  `test`.
- Web: lint, `tsc --noEmit`, `next build`.
- Browser: create an address, see it on the checkout card, change address via the modal, delete it
  and confirm the empty state.

## Shipped 2026-10-26

- Migration `0043_sleepy_forge` applied. The dev ledger's watermark was stuck at `0040`, so
  `db:migrate` re-ran 0041 and aborted on `duplicate_object`; 0041/0042 were recorded as applied
  (backup `drizzle.__drizzle_migrations_backup_20261026034759`) after verifying their objects exist.
- API verified end to end over HTTP: create, list, invalid category → 400, short phone → 400,
  delete-the-default → the newest row is promoted, unknown id → 404.
- UI verified in headless Chromium: checkout address card with map + Change Address, the picker
  dialog, the add form, and the settings list.
- Not done: no unit spec for `BillingAddressesService` (behaviour was proven over HTTP instead);
  `components/profile/Add-Address.tsx` is now unreferenced (the `/add` route redirects).
