-- Sales Order (Main OC → Delivery OC → Article → Colour/Size quantity lines), its masters, the Screen Layout
-- Configurator and buyer-wise views, approvals and the activity timeline. Specs: D:\Sprints\Sales Order Sprint
-- (Sprint-01, Sprint-02, Sprint-3 V2) and Order type handling (Back, Purchase, MTS).
-- Masters are seeded from knowledge/sales_order/masters.json (each record names its source); orders are transactional
-- data and live only here — a reindex never touches these tables.

-- ── masters ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS so_categories (code TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS so_buyers (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL REFERENCES so_categories(code),
  departments TEXT NOT NULL DEFAULT '[]', currency TEXT NOT NULL DEFAULT 'INR', seasons TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS so_articles (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, buyer TEXT REFERENCES so_buyers(code), category TEXT NOT NULL,
  colours TEXT NOT NULL DEFAULT '[]',          -- [{code,name}] from the colour card
  sizes TEXT NOT NULL DEFAULT '[]',            -- [{code,name}] from the size range
  inseams TEXT NOT NULL DEFAULT '[]',          -- from the size master
  price_per TEXT NOT NULL DEFAULT 'Article',   -- Article | Color | Size | Color/Size (inherited from the tech pack)
  base_price REAL,                             -- tech pack base selling price
  uom TEXT NOT NULL DEFAULT 'PCS', uom_decimals INTEGER NOT NULL DEFAULT 0,
  is_kit INTEGER NOT NULL DEFAULT 0, kit_name TEXT, kit_id TEXT,
  buyer_style_ref TEXT, source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS so_boms (
  id TEXT PRIMARY KEY, article TEXT NOT NULL REFERENCES so_articles(code), bom_no TEXT NOT NULL, version INTEGER NOT NULL,
  status TEXT NOT NULL, accepted INTEGER NOT NULL DEFAULT 0, accepted_on TEXT, selling_price REAL, routing TEXT, source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS so_cost_sheets (
  article TEXT NOT NULL REFERENCES so_articles(code), destination TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
  selling_price REAL NOT NULL, revised_on TEXT, source TEXT NOT NULL, PRIMARY KEY (article, destination)
);
CREATE TABLE IF NOT EXISTS so_ex_factory (
  shipment_mode TEXT NOT NULL, buyer TEXT NOT NULL, department TEXT NOT NULL DEFAULT '', days INTEGER NOT NULL, source TEXT NOT NULL,
  PRIMARY KEY (shipment_mode, buyer, department)
);
CREATE TABLE IF NOT EXISTS so_lookups (list TEXT NOT NULL, value TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY (list, value));

-- ── screen configuration ────────────────────────────────────────────
-- the field catalogue (Sprint-01 field table): level, default visibility, section
CREATE TABLE IF NOT EXISTS so_fields (
  key TEXT PRIMARY KEY, label TEXT NOT NULL, level TEXT NOT NULL,      -- Header | Article | Delivery | Delivery+SKU | Additional
  section TEXT NOT NULL,                                                -- Order Information | Other Detail | Instruction | Delivery Level Information | Additional Fields
  visibility TEXT NOT NULL,                                             -- Always (cannot be hidden) | Optional
  type TEXT NOT NULL DEFAULT 'text',                                    -- text | alphanumeric | numeric | date | dropdown | lookup (system list)
  multi INTEGER NOT NULL DEFAULT 0, options TEXT NOT NULL DEFAULT '[]', validation TEXT NOT NULL DEFAULT 'None', -- None | Alphanumeric | Numeric
  lookup TEXT, system INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL, source TEXT NOT NULL
);
-- company-level Screen Layout Configurator: one row per field and list type (New / List)
CREATE TABLE IF NOT EXISTS so_slc (
  list_type TEXT NOT NULL, field TEXT NOT NULL REFERENCES so_fields(key), visible INTEGER NOT NULL, mandatory INTEGER NOT NULL DEFAULT 0,
  editable INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL, PRIMARY KEY (list_type, field)
);
-- View Configurator: user/department views on top of the SLC; a "New" view is mapped to buyers
CREATE TABLE IF NOT EXISTS so_views (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, list_type TEXT NOT NULL, buyers TEXT NOT NULL DEFAULT '[]',
  fields TEXT NOT NULL DEFAULT '[]',          -- [{field, visible, mandatory, editable, position}]
  list_scope TEXT NOT NULL DEFAULT 'all',     -- List views: all | created | created-and-buyer
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS so_view_permissions (view_id INTEGER NOT NULL REFERENCES so_views(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, PRIMARY KEY (view_id, user_id));
-- approval value per approver (Program Permission › Sales Order New): 0 never, -1 always, > 0 above that value
CREATE TABLE IF NOT EXISTS so_approvers (user_id INTEGER PRIMARY KEY, approval_limit REAL NOT NULL DEFAULT -1, is_final INTEGER NOT NULL DEFAULT 0);
-- tool permissions per role for grid and header actions (Sprint-3: Program Permissions › Sales Order New › Tool Permission)
CREATE TABLE IF NOT EXISTS so_tool_permissions (role TEXT NOT NULL, tool TEXT NOT NULL, PRIMARY KEY (role, tool));
CREATE TABLE IF NOT EXISTS so_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- ── transactions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS so_orders (
  id INTEGER PRIMARY KEY, so_no TEXT NOT NULL UNIQUE, category TEXT NOT NULL, buyer TEXT NOT NULL REFERENCES so_buyers(code),
  view_id INTEGER, status TEXT NOT NULL DEFAULT 'Draft',  -- Draft | Pending Approval | Confirmed | Rejected | Cancelled | Closed
  revised INTEGER NOT NULL DEFAULT 0,                     -- Confirmed * : revised after confirmation, not yet re-confirmed
  header TEXT NOT NULL DEFAULT '{}',                      -- configured header / additional field values
  instructions TEXT NOT NULL DEFAULT '{}', currency TEXT NOT NULL DEFAULT 'INR',
  approver_id INTEGER, approval_level INTEGER NOT NULL DEFAULT 0, remarks TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, created_by_id INTEGER, created_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_so_orders_buyer ON so_orders(buyer, status);
CREATE TABLE IF NOT EXISTS so_deliveries (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES so_orders(id) ON DELETE CASCADE, delivery_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft',                   -- Draft | Open | Cancelled | Closed
  buyer_order_ref TEXT NOT NULL DEFAULT '', buyer_delivery_date TEXT, oc_delivery_date TEXT, shipment_mode TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '', fields TEXT NOT NULL DEFAULT '{}', remarks TEXT NOT NULL DEFAULT '',
  split_from INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (order_id, delivery_no)
);
CREATE TABLE IF NOT EXISTS so_delivery_articles (
  id INTEGER PRIMARY KEY, delivery_id INTEGER NOT NULL REFERENCES so_deliveries(id) ON DELETE CASCADE, article TEXT NOT NULL REFERENCES so_articles(code),
  bom_id TEXT REFERENCES so_boms(id), bom_selected INTEGER NOT NULL DEFAULT 0, price_source TEXT NOT NULL DEFAULT '',
  price_per TEXT NOT NULL, base_price REAL NOT NULL DEFAULT 0, fields TEXT NOT NULL DEFAULT '{}',
  extra_production_pct REAL NOT NULL DEFAULT 0, seq INTEGER NOT NULL DEFAULT 0
);
-- one quantity breakup grid per row of this table: the first one, then each "Add Qty"
CREATE TABLE IF NOT EXISTS so_breakups (
  id INTEGER PRIMARY KEY, article_line INTEGER NOT NULL REFERENCES so_delivery_articles(id) ON DELETE CASCADE, seq INTEGER NOT NULL,
  packing_type TEXT NOT NULL DEFAULT 'Solid Color / Solid Size', additional INTEGER NOT NULL DEFAULT 0, -- additional = Add Additional Qty grid
  packing_code TEXT NOT NULL DEFAULT '', prepack_code TEXT NOT NULL DEFAULT '', cartons INTEGER, inseam TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS so_qty (
  breakup_id INTEGER NOT NULL REFERENCES so_breakups(id) ON DELETE CASCADE, colour TEXT NOT NULL, size TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,                 -- pieces (for prepack types: PP × ratio)
  ratio REAL, pp REAL, upcharge REAL NOT NULL DEFAULT 0, inseam TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (breakup_id, colour, size)
);
CREATE TABLE IF NOT EXISTS so_approvals (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES so_orders(id) ON DELETE CASCADE, level INTEGER NOT NULL,
  approver_id INTEGER NOT NULL, approver TEXT NOT NULL, status TEXT NOT NULL, remarks TEXT NOT NULL DEFAULT '', acted_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_so_approvals_pending ON so_approvals(approver_id, status);
CREATE TABLE IF NOT EXISTS so_history (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, delivery_id INTEGER, action TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '',
  before TEXT, after TEXT, remarks TEXT NOT NULL DEFAULT '', user TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_so_history_order ON so_history(order_id, id);
