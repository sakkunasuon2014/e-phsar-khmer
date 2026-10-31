import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { DbClient } from '../../db/drizzle.provider';
import { attributeOptions } from '../../db/schema/attributes.schema';
import { categories, subcategories } from '../../db/schema/categories.schema';

/**
 * Seed baseline data for the generic `attribute_options` lookup table.
 *
 * 17 attribute types are seeded (all except `years`, which is generated
 * dynamically by AttributesService.list). Each option carries a real
 * category/subcategory slug linkage resolved to UUIDs at seed time.
 *
 * Images are never seeded — every row starts `image: null` and admins
 * upload images themselves through the admin UI (ImageUpload → Supabase
 * storage → public URL stored in `image`). The seed never overwrites them.
 * The one exception: car body-type rows are gap-filled with the web app's
 * local /sub-img design assets below — null-only, so admin uploads (non-null
 * images) are never touched.
 *
 * Insert-only: rows are never overwritten on re-run, so admin edits to the
 * admin-managed types survive a re-seed.
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AttributeSeed {
  type: string;
  slug: string;
  name: string;
  image?: string | null;
  category: string | null;
  subcategories: string[];
  sortOrder: number;
}

const PHONES_SUBS = ['phones', 'tablets'];
const COMPUTER_SUBS = ['laptops', 'desktops', 'all-in-one'];
// Bedrooms/bathrooms/facings are lookup picklists for the property forms —
// the design does NOT show them as browse grids, so they carry no
// subcategory links (rows stay category-scoped for the admin UI / future form).
const UNLINKED: string[] = [];
// Every jobs subcategory shows the same Job Type grid (design).
const JOBS_SUBS = [
  'accounting-jobs',
  'administration',
  'architecture-engineering',
  'assistant-secretary',
  'audit-taxation',
  'banking-insurance',
  'cashier-receptionist',
  'catering-restaurant',
  'cleaner-maid',
  'consultancy',
  'customer-service',
  'design',
  'education-training',
  'finance',
  'freight-shipping-delivery-warehouse',
  'hotel-hospitality',
  'human-resources',
  'information-technology',
  'jobs-others',
  'lawyer-legal-services',
  'management',
  'manufacturing',
  'marketing',
  'media-advertising',
  'medical-health-nursing',
  'merchandising-purchasing',
  'operations',
  'project-management',
  'quality-control',
  'resort-casino',
  'sales',
  'security-driver',
  'technicians',
  'telecommunications',
  'translations-interpretation',
  'travel-agents-ticket-sales',
];

type BodyTypeTuple = [string, string, string[]];

// Order follows the vehicles-for-rent design grid (image: Motorcycle,
// Bicycle, Tuk Tuk, cars, buses, trucks, Other) — the single global
// sortOrder keeps every subcategory's filtered grid in its own design order
// (cars: sedan→other; lorries: heavy→tractor+other; rent: the full set).
// Convertible stays cars-for-sale-only at its design slot; the rent grid
// skips it because it carries no rent link.
const BODY_TYPES: BodyTypeTuple[] = [
  ['Motorcycle', 'motorcycle', ['vehicles-for-rent']],
  ['Bicycle', 'bicycle', ['vehicles-for-rent']],
  ['Tuk Tuk & Remork', 'tuk-tuk-and-remork', ['vehicles-for-rent']],
  ['Sedan', 'sedan', ['cars-for-sale', 'vehicles-for-rent']],
  ['Hatchback', 'hatchback', ['cars-for-sale', 'vehicles-for-rent']],
  ['Pickup', 'pickup', ['cars-for-sale', 'vehicles-for-rent']],
  ['SUV', 'suv', ['cars-for-sale', 'vehicles-for-rent']],
  ['Convertible', 'convertible', ['cars-for-sale']],
  ['City Bus', 'city-bus', ['vehicles-for-rent']],
  ['Express Bus', 'express-bus', ['vehicles-for-rent']],
  [
    'Heavy Truck',
    'heavy-truck',
    ['lorries-vans-and-tractors', 'vehicles-for-rent'],
  ],
  [
    'Industrial Vehicle',
    'industrial-vehicle',
    ['lorries-vans-and-tractors', 'vehicles-for-rent'],
  ],
  [
    'Light Truck',
    'light-truck',
    ['lorries-vans-and-tractors', 'vehicles-for-rent'],
  ],
  [
    'Medium Truck',
    'medium-truck',
    ['lorries-vans-and-tractors', 'vehicles-for-rent'],
  ],
  ['Mini Bus', 'mini-bus', ['lorries-vans-and-tractors', 'vehicles-for-rent']],
  [
    'Mini Truck',
    'mini-truck',
    ['lorries-vans-and-tractors', 'vehicles-for-rent'],
  ],
  ['MPV (Minivan)', 'mpv-minivan', ['cars-for-sale', 'vehicles-for-rent']],
  ['Sports', 'sports', ['cars-for-sale', 'vehicles-for-rent']],
  ['Station Wagon', 'station-wagon', ['cars-for-sale', 'vehicles-for-rent']],
  [
    'Tractor Unit',
    'tractor-unit',
    ['lorries-vans-and-tractors', 'vehicles-for-rent'],
  ],
  [
    'Other',
    'other-type',
    ['cars-for-sale', 'lorries-vans-and-tractors', 'vehicles-for-rent'],
  ],
];

type PropertyTypeTuple = [string, string, string[]];

const PROPERTY_TYPES: PropertyTypeTuple[] = [
  ['Flat', 'flat', ['house-for-sale', 'house-for-rent']],
  ['House', 'house', ['house-for-sale', 'house-for-rent']],
  ['Shophouse', 'shophouse', ['house-for-sale', 'house-for-rent']],
  ['Villa', 'villa', ['house-for-sale', 'house-for-rent']],
  [
    'Building',
    'building',
    ['commercial-properties-for-sale', 'commercial-properties-for-rent'],
  ],
  [
    'Factory',
    'factory',
    ['commercial-properties-for-sale', 'commercial-properties-for-rent'],
  ],
  [
    'Hotel',
    'hotel',
    ['commercial-properties-for-sale', 'commercial-properties-for-rent'],
  ],
  [
    'Offices',
    'offices',
    ['commercial-properties-for-sale', 'commercial-properties-for-rent'],
  ],
  [
    'Restaurant',
    'restaurant',
    ['commercial-properties-for-sale', 'commercial-properties-for-rent'],
  ],
  [
    'Shop',
    'shop',
    ['commercial-properties-for-sale', 'commercial-properties-for-rent'],
  ],
  [
    'Warehouse',
    'warehouse',
    ['commercial-properties-for-sale', 'commercial-properties-for-rent'],
  ],
];

export const ATTRIBUTE_SEEDS: AttributeSeed[] = [
  // ---- colors (cars) — plain dropdown, no image ----
  ...[
    'Beige',
    'Black',
    'Blue',
    'Brown',
    'Gold',
    'Gray',
    'Green',
    'Orange',
    'Purple',
    'Red',
    'Silver',
    'White',
    'Yellow',
    'Other',
  ].map((name, i) => ({
    type: 'colors',
    slug: name.toLowerCase(),
    name,
    category: 'cars-and-vehicles',
    subcategories: UNLINKED,
    sortOrder: i,
  })),

  // ---- rams (computers) ----
  ...[
    ['2GB & Under', '2gb-under'],
    ['3GB', '3gb'],
    ['4GB', '4gb'],
    ['5GB', '5gb'],
    ['6GB', '6gb'],
    ['8GB', '8gb'],
    ['10GB', '10gb'],
    ['12GB', '12gb'],
    ['16GB', '16gb'],
    ['24GB', '24gb'],
    ['32GB', '32gb'],
    ['64GB & Larger', '64gb-larger'],
  ].map(([name, slug], i) => ({
    type: 'rams',
    slug,
    name,
    category: 'computers-and-accessories',
    subcategories: COMPUTER_SUBS,
    sortOrder: i,
  })),

  // ---- cpus (computers) ----
  ...[
    'M1',
    'M1 Pro',
    'M1 Max',
    'M1 Ultra',
    'M2',
    'M2 Pro',
    'M2 Max',
    'M2 Ultra',
    'Intel Core 2',
    'Intel Core i3',
    'Intel Core i5',
    'Intel Core i7',
    'Intel Core i9',
    'Intel Xeon',
    'Intel Celeron',
    'Intel Pentium',
    'AMD Ryzen',
    'AMD Ryzen 3',
    'AMD Ryzen 5',
    'AMD Ryzen 7',
    'AMD Ryzen 9',
    'M3',
    'M3 Pro',
    'M3 Max',
    'M3 Ultra',
    'M4',
    'M4 Pro',
    'M4 Max',
    'M4 Ultra',
    'M5',
    'M5 Pro',
    'M5 Max',
    'M5 Ultra',
    'Other',
  ].map((name, i) => ({
    type: 'cpus',
    slug: name.toLowerCase().replace(/ /g, '-'),
    name,
    category: 'computers-and-accessories',
    subcategories: COMPUTER_SUBS,
    sortOrder: i,
  })),

  // ---- storages (two sets: phones + computers) ----
  ...[
    ['1TB & Above', '1tb-above'],
    ['128GB', '128gb'],
    ['256GB', '256gb'],
    ['512GB', '512gb'],
    ['64GB or below', '64gb-or-below'],
  ].map(([name, slug], i) => ({
    type: 'storage_phone',
    slug,
    name,
    category: 'phones-and-tablets',
    subcategories: PHONES_SUBS,
    sortOrder: i,
  })),
  ...[
    ['128GB & Under', '128gb-under'],
    ['250GB - 256GB', '250gb-256gb'],
    ['500GB - 512GB', '500gb-512gb'],
    ['1TB', '1tb'],
    ['2TB & Larger', '2tb-larger'],
  ].map(([name, slug], i) => ({
    type: 'storage_computer',
    slug,
    name,
    category: 'computers-and-accessories',
    subcategories: COMPUTER_SUBS,
    sortOrder: i,
  })),

  // ---- screensize_laptop / screensize_monitor ----
  ...[
    ['10.9" & Under', '10-9-under'],
    ['11" - 11.9"', '11-11-9'],
    ['12" & 12.9"', '12-12-9'],
    ['13" & 13.9"', '13-13-9'],
    ['14" & 14.9"', '14-14-9'],
    ['15" & 15.9"', '15-15-9'],
    ['16" & 16.9"', '16-16-9'],
    ['17" & Larger', '17-larger'],
  ].map(([name, slug], i) => ({
    type: 'screensize_laptop',
    slug,
    name,
    category: 'computers-and-accessories',
    subcategories: ['laptops'],
    sortOrder: i,
  })),
  ...[
    ['22.9" & Under', '22-9-under'],
    ['23" - 26.9"', '23-26-9'],
    ['27" & 32.9"', '27-32-9'],
    ['33" & 49"', '33-49'],
    ['50" & Larger', '50-larger'],
  ].map(([name, slug], i) => ({
    type: 'screensize_monitor',
    slug,
    name,
    category: 'computers-and-accessories',
    subcategories: ['all-in-one', 'monitors'],
    sortOrder: i,
  })),

  // ---- bodytypes (has image per spec one:216) ----
  ...BODY_TYPES.map(([name, slug, subs], i) => ({
    type: 'bodytypes',
    slug,
    name,
    category: 'cars-and-vehicles',
    subcategories: subs,
    sortOrder: i,
  })),

  // ---- enginetypes (cars) ----
  ...['Diesel', 'Electric', 'Hybrid', 'LPG', 'Petrol'].map((name, i) => ({
    type: 'enginetypes',
    slug: name.toLowerCase(),
    name,
    category: 'cars-and-vehicles',
    subcategories: ['cars-for-sale', 'vehicles-for-rent'],
    sortOrder: i,
  })),

  // ---- vehicletypes (vehicles-for-rent) — plain dropdown, no image ----
  ...[
    'Motorcycle',
    'Bicycle',
    'Tuk Tuk & Remork',
    'Sedan',
    'Hatchback',
    'Pickup',
    'SUV',
    'City Bus',
    'Convertible',
    'Express Bus',
    'Heavy Truck',
    'Industrial Vehicle',
    'Light Truck',
    'Medium Truck',
    'Mini Bus',
    'Mini Truck',
    'MPV (Minivan)',
    'Sports',
    'Station Wagon',
    'Tractor Unit',
    'Other',
  ].map((name, i) => ({
    type: 'vehicletypes',
    slug: name
      .toLowerCase()
      .replace(/ & /g, '-and-')
      .replace(/[()]/g, '')
      .replace(/ /g, '-'),
    name,
    category: 'cars-and-vehicles',
    subcategories: UNLINKED,
    sortOrder: i,
  })),

  // ---- accessories (phone set + fashion jewellery set; has image per spec
  //      two:52 / eight:64) ----
  //      ONE set serving two families, kept apart by per-subcategory ticks —
  //      the same shape `types` uses to serve seven families at once from one
  //      80-row set, with `other` shared across all of them. **Captain's call,
  //      2026-09-27: this is one set, not two.** A `fashion_accessories` split
  //      was built and reverted the same day; the reason is worth keeping, so
  //      nobody re-proposes it: the split was never required for correctness
  //      (ticks already scope each form), the shared `other` it was blamed for
  //      is exactly what `types` does across 14 subcategories, and the ordering
  //      wrinkle it caused is solved here by giving `other` the global
  //      last-place `sortOrder` (999) instead.
  //      The trade being accepted: ONE mis-tick in the admin can put a phone
  //      part (Chargers & Cables…) into the jewellery picker, because only the
  //      ticks separate the two slices.
  ...[
    ['Accessory Kits', 'accessory-kits', 'phone-accessories'],
    ['Batteries', 'batteries', 'phone-accessories'],
    ['Car Accessories', 'car-accessories', 'phone-accessories'],
    ['Cases & Covers', 'cases-covers', 'phone-accessories'],
    ['Chargers & Cables', 'chargers-cables', 'phone-accessories'],
    ['Headsets', 'headsets', 'phone-accessories'],
    ['Memory Cards', 'memory-cards', 'phone-accessories'],
    ['Replacement Parts', 'replacement-parts', 'phone-accessories'],
    ['Screen Protectors', 'screen-protectors', 'phone-accessories'],
    ['Rings', 'rings', 'fashion-accessories'],
    ['Necklaces', 'necklaces', 'fashion-accessories'],
    ['Earrings', 'earrings', 'fashion-accessories'],
    ['Jewelry Sets', 'jewelry-sets', 'fashion-accessories'],
    ['Jewelry Accessories', 'jewelry-accessories', 'fashion-accessories'],
    ['Sunglasses', 'sunglasses', 'fashion-accessories'],
  ].map(([name, slug, sub], i) => ({
    type: 'accessories',
    slug,
    name,
    category:
      sub === 'phone-accessories' ? 'phones-and-tablets' : 'fashion-and-beauty',
    subcategories: [sub],
    sortOrder: i,
  })),

  // The one shared `accessories` "Other", declared standalone because it
  // belongs to BOTH slices at once (Phone Accessories' 10 rows and Fashion
  // Accessories' 6 jewellery rows) — a mapped entry takes its slice-local index,
  // which would drop it between Screen Protectors and Rings, i.e. FIRST in the
  // jewellery list where the design puts it last. `dedupe()` unions
  // subcategories across same-(type, slug) rows but keeps the FIRST
  // declaration's order, so this has to be the only declaration and carry the
  // global last-place 999 — the exact shape of the shared `types` "other" row at
  // the end of this file.
  {
    type: 'accessories',
    slug: 'other',
    name: 'Other - ផ្សេងៗ',
    category: null,
    subcategories: ['phone-accessories', 'fashion-accessories'],
    sortOrder: 999,
  },

  // ---- jobtypes (has image per spec six:4) — every jobs subcategory shows
  //      the same Job Type grid (design: "each job subcategory has job type")
  ...[
    ['Full-time', 'full-time'],
    ['Part-time', 'part-time'],
    ['Internships', 'internships'],
    ['Freelance', 'freelance'],
    ['Contract', 'contract'],
    ['Volunteer', 'volunteer'],
    ['Other-Jobs', 'other-jobs'],
  ].map(([name, slug], i) => ({
    type: 'jobtypes',
    slug,
    name,
    category: 'jobs',
    subcategories: JOBS_SUBS,
    sortOrder: i,
  })),

  // ---- networks (phones) — images uploaded via admin ----
  ...['Cellcard', 'Metfone', 'Smart', 'Qube', 'Other'].map((name, i) => ({
    type: 'networks',
    slug: name.toLowerCase(),
    name,
    category: 'phones-and-tablets',
    subcategories: ['phone-numbers'],
    sortOrder: i,
  })),

  // ---- bedrooms / bathrooms / facings (home) ----
  ...['1', '2', '3', '4', '5', '6'].map((n, i) => ({
    type: 'bedrooms',
    slug: n,
    name: n,
    category: 'home-and-land',
    subcategories: UNLINKED,
    sortOrder: i,
  })),
  {
    type: 'bedrooms',
    slug: 'more',
    name: 'More+',
    category: 'home-and-land',
    subcategories: UNLINKED,
    sortOrder: 6,
  },
  ...['1', '2', '3', '4', '5', '6'].map((n, i) => ({
    type: 'bathrooms',
    slug: n,
    name: n,
    category: 'home-and-land',
    subcategories: UNLINKED,
    sortOrder: i,
  })),
  {
    type: 'bathrooms',
    slug: 'more',
    name: 'More+',
    category: 'home-and-land',
    subcategories: UNLINKED,
    sortOrder: 6,
  },
  ...[
    'East',
    'North',
    'Northeast',
    'Northwest',
    'South',
    'Southeast',
    'Southwest',
    'West',
  ].map((name, i) => ({
    type: 'facings',
    slug: name.toLowerCase(),
    name,
    category: 'home-and-land',
    subcategories: UNLINKED,
    sortOrder: i,
  })),

  // ---- experiences (jobs) ----
  {
    type: 'experiences',
    slug: 'no-experience',
    name: 'No experience',
    category: 'jobs',
    subcategories: [],
    sortOrder: 0,
  },
  ...Array.from({ length: 10 }, (_, i) => ({
    type: 'experiences',
    slug: `${i + 1}-year-plus`,
    name: `${i + 1} Year+`,
    category: 'jobs',
    subcategories: [],
    sortOrder: i + 1,
  })),

  // ---- vgas (computers) ----
  ...[
    'Integrated',
    '2GB & Under',
    '4GB',
    '6GB',
    '8GB',
    '12GB',
    '16GB & Larger',
  ].map((name, i) => ({
    type: 'vgas',
    slug: name
      .toLowerCase()
      .replace(/ & /g, '-')
      .replace(/ /g, '-')
      .replace(/larger/, 'larger')
      .replace(/^16gb-and-larger$/, '16gb-larger'),
    name,
    category: 'computers-and-accessories',
    subcategories: COMPUTER_SUBS,
    sortOrder: i,
  })),

  // ---- types (the big generic picklist; has image per spec four/eight/ten) ----
  ...[
    [
      'Keyboards,Mice(Mouse) & Input Devices',
      'keyboards-mice-and-input-devices',
    ],
    ['Speakers', 'speakers'],
    ['Headsets & Microphones', 'headsets-and-microphones'],
    ['Monitor Accessories', 'monitor-accessories'],
    ['Storage & Media', 'storage-and-media'],
    ['Memory Cards & Readers', 'memory-cards-and-readers'],
    ['Internet Modems', 'internet-modems'],
    ['Cables & Adapters', 'cables-and-adapters'],
    ['Laptop Batteries & Chargers', 'laptop-batteries-and-chargers'],
    ['Cases & Bags', 'cases-bags'],
    ['PC Components', 'pc-components'],
    ['Network Components', 'network-components'],
    ['Printers Inks & Toners', 'printers-inks-and-toners'],
    ['Printers & Scanners', 'printers-scanners'],
    ['Projectors & Accessory', 'projectors-and-accessory'],
    ['Stands', 'stands'],
  ].map(([name, slug], i) => ({
    type: 'types',
    slug,
    name,
    category: 'computers-and-accessories',
    subcategories: ['computers-parts-and-accessories'],
    sortOrder: i,
  })),
  // The electronics names are spec-detail-four.md's own wording. They used to
  // echo the slug (and, before that, the asset filename), which is what the
  // Type picker displays and what the form stores in `attributes.type` — so
  // 'Lens-filters' would have been buyer-visible. No listing held any of these
  // values when they were renamed (2026-09-22), so nothing is reinterpreted.
  ...[
    ['Digital Cameras', 'digital-cameras'],
    ['Camcorders', 'camcorders'],
    ['Lens & Filters', 'lens-filters'],
    ['Flashes & Flash Acc.', 'flashes-flash-acc'],
    ['Lighting & Studio', 'lighting-studio'],
    ['Cases & Bags', 'cases-bags'],
    ['Batteries & Chargers', 'batteries-chargers'],
  ].map(([name, slug], i) => ({
    type: 'types',
    slug,
    name,
    category: 'electronics-and-appliances',
    subcategories: ['cameras-and-camcorders'],
    sortOrder: 100 + i,
  })),
  // `speakers` and `microphones` are deliberately re-declared rather than
  // created again: `dedupe()` merges same-(type, slug) rows by UNIONING their
  // subcategories, so these two lines add the tvs link onto the rows that
  // already serve computers-parts-and-accessories and musical-instruments.
  // That is the same mechanism `cases-bags` uses two blocks up. The first
  // declaration wins for name/category/sortOrder, so the picker orders them by
  // the global sortOrder (Speakers sorts at the computers block's position,
  // i.e. first) — a shared row cannot hold two orderings at once.
  ...[
    ['Televisions', 'televisions'],
    ['Speakers', 'speakers'],
    ['Audio Interfaces', 'audio-interfaces'],
    ['Microphones', 'microphones'],
    ['Remotes', 'remotes'],
  ].map(([name, slug], i) => ({
    type: 'types',
    slug,
    name,
    category: 'electronics-and-appliances',
    subcategories: ['tvs-videos-and-audio'],
    sortOrder: 200 + i,
  })),
  ...PROPERTY_TYPES.map(([name, slug, subs], i) => ({
    type: 'types',
    slug,
    name,
    category: 'home-and-land',
    subcategories: subs,
    sortOrder: 300 + i,
  })),
  ...[
    ["Women's Accessories", 'women-accessories', 'womens-fashion'],
    ["Women's Clothing", 'women-clothing', 'womens-fashion'],
    ["Women's Handbags", 'women-handbags', 'womens-fashion'],
    ["Women's Watches", 'women-watches', 'womens-fashion'],
    ["Women's Shoes", 'women-shoes', 'womens-fashion'],
    ['Men Accessories', 'men-accessories', 'mens-fashion'],
    ['Men Clothing', 'men-clothing', 'mens-fashion'],
    ['Men Wallets', 'men-wallets', 'mens-fashion'],
    ['Men Shoes', 'men-shoes', 'mens-fashion'],
    ['Men Watches', 'men-watches', 'mens-fashion'],
    ['Kid Clothing', 'kid-clothing', 'baby-and-kids'],
    ['Kid Accessories', 'kid-accessories', 'baby-and-kids'],
    ['Kid Shoes', 'kid-shoes', 'baby-and-kids'],
    ['Kid Watches', 'kid-watches', 'baby-and-kids'],
    ['Backpacks', 'backpacks', 'travel-and-luggage'],
    ['Bags', 'bags', 'travel-and-luggage'],
    ['Luggage', 'luggage', 'travel-and-luggage'],
  ].map(([name, slug, sub], i) => ({
    type: 'types',
    slug,
    name,
    category: 'fashion-and-beauty',
    subcategories: [sub],
    sortOrder: 400 + i,
  })),
  ...[
    ['Dining Table', 'dining-table'],
    ['Game Table', 'game-table'],
    ['Kids Desks', 'kids-desks'],
    ['Office Desk', 'office-desk'],
    ['Student Desk', 'student-desk'],
    ['Wooden Table', 'wooden-table'],
    ['Barber Chair & Salon Chair', 'barber-chair-salon-chair'],
    ['Dining Chair', 'dining-chair'],
    ['Gaming Chair', 'gaming-chair'],
    ['Kids Chairs&Seats', 'kids-chairs-seats'],
    ['Office Chair', 'office-chair'],
    ['Sofa', 'sofa'],
    ['Student Chair', 'student-chair'],
    ['Waiting Room Chair', 'waiting-room-chair'],
    ['Wheelchair', 'wheelchair'],
    ['Wooden Chair', 'wooden-chair'],
  ].map(([name, slug], i) => ({
    type: 'types',
    slug,
    name,
    category: 'furniture-and-decor',
    subcategories:
      slug.startsWith('barber') || slug.includes('chair') || slug === 'sofa'
        ? ['chairs-and-sofas']
        : ['table-and-desks'],
    sortOrder: 500 + i,
  })),
  ...[
    ['Guitars & Basses', 'guitars-and-basses'],
    ['Pianos & Keyboards', 'pianos-and-keyboards'],
    ['Drums', 'drums'],
    ['Amps & Effects', 'amps-and-effects'],
    ['DJ', 'dj'],
    ['Headphones', 'headphones'],
    ['Microphones', 'microphones'],
    ['Recording', 'recording'],
    ['Traditional-instruments', 'traditional-instruments'],
    ['Accessories', 'accessories'],
  ].map(([name, slug], i) => ({
    type: 'types',
    slug,
    name,
    category: 'books-sports-and-hobbies',
    subcategories: ['musical-instruments'],
    sortOrder: 600 + i,
  })),

  // The generic "other" — one row spanning every category's subcategory list.
  // (Fashion/furniture/musical "other" rows collapse into this one; the mock
  // had per-category "Other - ផ្សេងៗ" rows sharing the same slug.)
  {
    type: 'types',
    slug: 'other',
    name: 'Other - ផ្សេងៗ',
    category: null,
    subcategories: [
      'computers-parts-and-accessories',
      'cameras-and-camcorders',
      'tvs-videos-and-audio',
      'house-for-sale',
      'house-for-rent',
      'commercial-properties-for-sale',
      'commercial-properties-for-rent',
      'womens-fashion',
      'mens-fashion',
      'baby-and-kids',
      'travel-and-luggage',
      'table-and-desks',
      'chairs-and-sofas',
      'musical-instruments',
    ],
    sortOrder: 999,
  },
];

/** Merge rows sharing (type, slug), unioning subcategories. */
function dedupe(seeds: AttributeSeed[]): AttributeSeed[] {
  const map = new Map<string, AttributeSeed>();
  for (const seed of seeds) {
    const key = `${seed.type}:${seed.slug}`;
    const existing = map.get(key);
    if (existing) {
      existing.subcategories = [
        ...new Set([...existing.subcategories, ...seed.subcategories]),
      ];
    } else {
      map.set(key, { ...seed });
    }
  }
  return [...map.values()];
}

export async function seedAttributes(db: DbClient): Promise<void> {
  const seeds = dedupe(ATTRIBUTE_SEEDS);

  // Fail fast in dev if a slug violates the DTO slug rule.
  const bad = seeds.filter((s) => !SLUG_RE.test(s.slug));
  if (bad.length > 0) {
    throw new Error(
      `attributes.seed: invalid slug(s) (must match ${SLUG_RE}): ` +
        bad.map((b) => `${b.type}:${b.slug}`).join(', '),
    );
  }

  const categorySlugs = [
    ...new Set(seeds.map((s) => s.category).filter((c): c is string => !!c)),
  ];
  const subSlugs = [...new Set(seeds.flatMap((s) => s.subcategories))];

  const [catRows, subRows] = await Promise.all([
    categorySlugs.length
      ? db
          .select({ id: categories.id, slug: categories.slug })
          .from(categories)
          .where(inArray(categories.slug, categorySlugs))
      : Promise.resolve([]),
    subSlugs.length
      ? db
          .select({ id: subcategories.id, slug: subcategories.slug })
          .from(subcategories)
          .where(inArray(subcategories.slug, subSlugs))
      : Promise.resolve([]),
  ]);

  const catSlugToId = new Map(catRows.map((r) => [r.slug, r.id]));
  const subSlugToId = new Map(subRows.map((r) => [r.slug, r.id]));

  const byType = new Map<string, number>();
  for (const seed of seeds) {
    const categoryId = seed.category
      ? (catSlugToId.get(seed.category) ?? null)
      : null;
    const subIds = seed.subcategories
      .map((s) => subSlugToId.get(s))
      .filter((id): id is string => !!id);

    await db
      .insert(attributeOptions)
      .values({
        type: seed.type,
        slug: seed.slug,
        name: seed.name.trim(),
        image: seed.image ?? null,
        categoryId,
        subcategoryIds: subIds,
        sortOrder: seed.sortOrder,
        isActive: true,
      })
      .onConflictDoNothing();

    byType.set(seed.type, (byType.get(seed.type) ?? 0) + 1);
  }

  // Body-type Khmer names (captain's mock, 2026-10-22). Null-only: an
  // admin-entered Khmer name is never overwritten by a later re-seed.
  const CAR_BODY_TYPE_KM: Record<string, string> = {
    sedan: 'សេដាន',
    hatchback: 'កញ្ជី',
    pickup: 'ភីកអាប់',
    suv: 'អេសយូវី',
    convertible: 'បើកដំបូល',
    'mpv-minivan': 'MPV (រថយន្តគ្រួសារ)',
    sports: 'រថយន្តស្ព័រ',
    'station-wagon': 'គ្រឿង',
    'other-type': 'ផ្សេងៗ',
  };
  for (const [slug, nameKm] of Object.entries(CAR_BODY_TYPE_KM)) {
    await db
      .update(attributeOptions)
      .set({ nameKm })
      .where(
        and(
          eq(attributeOptions.type, 'bodytypes'),
          eq(attributeOptions.slug, slug),
          isNull(attributeOptions.nameKm),
        ),
      );
  }

  // Car colour Khmer names (captain's file, 2026-10-23). Colours are
  // seed-owned — they are not in the admin attribute UI — so this map is
  // authoritative and overwrites existing rows on every re-seed.
  const CAR_COLORS_KM: Record<string, string> = {
    beige: 'ពណ៌ត្នោតខ្ចី',
    black: 'ពណ៌ខ្មៅ',
    blue: 'ពណ៌ខៀវ',
    brown: 'ពណ៌ត្នោត',
    gold: 'ពណ៌មាស',
    gray: 'ពណ៌ប្រផេះ',
    green: 'ពណ៌បៃតង',
    orange: 'ពណ៌ទឹកក្រូច',
    purple: 'ពណ៌ស្វាយ',
    red: 'ពណ៌ក្រហម',
    silver: 'ពណ៌ប្រាក់',
    white: 'ពណ៌ស',
    yellow: 'ពណ៌លឿង',
    other: 'ផ្សេងៗ',
  };
  for (const [slug, nameKm] of Object.entries(CAR_COLORS_KM)) {
    await db
      .update(attributeOptions)
      .set({ nameKm })
      .where(
        and(
          eq(attributeOptions.type, 'colors'),
          eq(attributeOptions.slug, slug),
        ),
      );
  }

  // Camera & camcorder Type Khmer names (captain's mock, 2026-10-23).
  // `types` is admin-managed, so this gap-fills only nulls — an admin-entered
  // Khmer name is never overwritten by a re-seed. `Lens & Filters` stays
  // English (the mock shows no Khmer name); the shared `other` row gets its
  // km label in the TV map below.
  const CAMERA_TYPE_KM: Record<string, string> = {
    'digital-cameras': 'កាមេរ៉ាឌីជីថល',
    camcorders: 'ម៉ាស៊ីនថតវីដេអូ',
    'flashes-flash-acc': 'ភ្លើង និងគ្រឿងបន្លែម',
    'lighting-studio': 'ពន្លឺ និងស្ទូឌីយ៉ូ',
    'cases-bags': 'ស្រោម និងកាបូប',
    'batteries-chargers': 'ថ្ម និងឆ្នាំងសាក',
  };
  for (const [slug, nameKm] of Object.entries(CAMERA_TYPE_KM)) {
    await db
      .update(attributeOptions)
      .set({ nameKm })
      .where(
        and(
          eq(attributeOptions.type, 'types'),
          eq(attributeOptions.slug, slug),
          isNull(attributeOptions.nameKm),
        ),
      );
  }

  // TV, Videos & Audio Type Khmer names (captain's mock, 2026-10-23). Same
  // null-only rule. `speakers` and `microphones` are shared rows, so their
  // km labels also serve the other families that use those `types` rows; the
  // shared `other` row gets `ផ្សេងៗ` here, which applies to every Type picker.
  const TV_TYPE_KM: Record<string, string> = {
    televisions: 'ទូរទស្សន៍',
    speakers: 'អូឌីយ៉ូ',
    'audio-interfaces': 'ឧបករណ៍អូឌីយ៉ូ',
    microphones: 'មីក្រូហ្វូន',
    remotes: 'រីម៉ូត',
    other: 'ផ្សេងៗ',
  };
  for (const [slug, nameKm] of Object.entries(TV_TYPE_KM)) {
    await db
      .update(attributeOptions)
      .set({ nameKm })
      .where(
        and(
          eq(attributeOptions.type, 'types'),
          eq(attributeOptions.slug, slug),
          isNull(attributeOptions.nameKm),
        ),
      );
  }

  // Car body-type icons are the web app's local /sub-img design assets —
  // interim until they move to Supabase storage. Gap-fills only null icons
  // (admin-uploaded images are never overwritten); the insert-only loop
  // above keeps every other row untouched.
  const CAR_BODY_TYPE_FILES: Record<string, string> = {
    sedan: 'sedan',
    hatchback: 'hatchback',
    pickup: 'pickup',
    suv: 'suv',
    convertible: 'convertible',
    'mpv-minivan': 'mpv-minivan',
    sports: 'sports',
    'station-wagon': 'station-wagon',
    'other-type': 'other',
  };
  for (const [slug, file] of Object.entries(CAR_BODY_TYPE_FILES)) {
    await db
      .update(attributeOptions)
      .set({
        image: `/sub-img/car_vehicles/cars-for-sale/body_type/${file}.png`,
      })
      .where(
        and(
          eq(attributeOptions.type, 'bodytypes'),
          eq(attributeOptions.slug, slug),
          isNull(attributeOptions.image),
        ),
      );
  }

  // Vehicles-for-rent body types — same gap-fill pattern, rent assets. Only
  // the 5 rental-exclusive rows are null at insert; the shared rows already
  // carry the admin-uploaded icons (never overwritten here).
  const RENT_BODY_TYPE_FILES: Record<string, string> = {
    motorcycle: 'motorcycle',
    bicycle: 'bicycle',
    'tuk-tuk-and-remork': 'tuk-tuk-and-remork',
    'city-bus': 'city-bus',
    'express-bus': 'express-bus',
  };
  for (const [slug, file] of Object.entries(RENT_BODY_TYPE_FILES)) {
    await db
      .update(attributeOptions)
      .set({
        image: `/sub-img/car_vehicles/vehicles-for-rent/body_type/${file}.png`,
      })
      .where(
        and(
          eq(attributeOptions.type, 'bodytypes'),
          eq(attributeOptions.slug, slug),
          isNull(attributeOptions.image),
        ),
      );
  }

  // Musical-instruments type rows carry the design's icons (they live in the
  // /sub-img/books-sports-hobbies/brands/ folder) — the browse grid then
  // renders brand-style icon tiles instead of text tiles. Null-only, like
  // the other gap-fills (admin uploads survive).
  const MUSICAL_TYPE_FILES: Record<string, string> = {
    'guitars-and-basses': 'guitars-and-basses',
    'pianos-and-keyboards': 'pianos-and-keyboards',
    drums: 'drums',
    'amps-and-effects': 'amps-and-effects',
    dj: 'dj',
    headphones: 'headphones',
    microphones: 'microphones',
    recording: 'recording',
    'traditional-instruments': 'traditional-instrument',
    accessories: 'accessories',
    other: 'other',
  };
  for (const [slug, file] of Object.entries(MUSICAL_TYPE_FILES)) {
    await db
      .update(attributeOptions)
      .set({
        image: `/sub-img/books-sports-hobbies/brands/${file}.png`,
      })
      .where(
        and(
          eq(attributeOptions.type, 'types'),
          eq(attributeOptions.slug, slug),
          isNull(attributeOptions.image),
        ),
      );
  }

  for (const [type, count] of byType) {
    console.log(`  ✓ seeded ${count} ${type}`);
  }
}
