import { getRequestIdentity, unauthenticatedResponse } from "@/app/lib/server/access";
import { ensureStore, getDatabase } from "@/app/lib/server/context";
import { enforceRateLimit, validateJsonMutation } from "@/app/lib/server/http-security";

type ProfileRow = {
  owner_key: string;
  owner_name: string;
  google_email: string;
  workspace_name: string;
  entity_type: string;
  annual_revenue: number;
  financial_year: string;
  opening_accounts: string;
  updated_at: number;
  business_type: string | null;
  custom_business_type: string | null;
  legal_structure: string | null;
  opening_bank_paise: number | null;
  cash_in_hand_paise: number | null;
  opening_capital_paise: number | null;
  connection_mode: string | null;
  setup_completed_at: number | null;
  profile_version: number;
};

const BUSINESS_TYPES = new Set([
  "freelancer",
  "retail",
  "service",
  "ecommerce",
  "agency",
  "manufacturing",
  "nonprofit",
  "personal",
  "other",
]);
const LEGAL_STRUCTURES = new Set(["not_specified", "sole", "partnership", "private"]);
const CONNECTION_MODES = new Set(["manual"]);

async function prepareStore() {
  const database = await getDatabase();
  await ensureStore(database);
  return database;
}

function storedPaise(value: number | null, field: string) {
  if (!Number.isSafeInteger(value) || (value ?? -1) < 0) {
    throw new Error(`Stored ${field} is invalid`);
  }
  return value as number;
}

function legacyOpeningBankPaise(openingAccounts: string) {
  try {
    const parsed = JSON.parse(openingAccounts) as Record<string, unknown>;
    const rupees = parsed.bankCash;
    if (
      typeof rupees === "number" &&
      Number.isSafeInteger(rupees) &&
      rupees >= 0 &&
      rupees <= Math.floor(Number.MAX_SAFE_INTEGER / 100)
    ) {
      return rupees * 100;
    }
  } catch {
    // A legacy JSON value is never guessed or coerced. The review flag below
    // tells the client that this profile needs owner confirmation.
  }
  return 0;
}

function publicProfile(row: ProfileRow) {
  const isCanonical = row.profile_version >= 2;
  const openingBankPaise = isCanonical
    ? storedPaise(row.opening_bank_paise, "opening bank balance")
    : legacyOpeningBankPaise(row.opening_accounts);
  const cashInHandPaise = isCanonical
    ? storedPaise(row.cash_in_hand_paise, "cash in hand")
    : 0;
  const openingCapitalPaise = row.profile_version >= 3
    ? storedPaise(row.opening_capital_paise, "opening capital")
    : 0;

  return {
    ownerName: row.owner_name,
    email: row.google_email,
    businessName: row.workspace_name,
    businessType: isCanonical && BUSINESS_TYPES.has(row.business_type ?? "")
      ? row.business_type
      : "other",
    customBusinessType: isCanonical ? row.custom_business_type ?? "" : "",
    legalStructure: isCanonical && LEGAL_STRUCTURES.has(row.legal_structure ?? "")
      ? row.legal_structure
      : LEGAL_STRUCTURES.has(row.entity_type)
        ? row.entity_type
        : "not_specified",
    openingBankPaise,
    cashInHandPaise,
    openingCapitalPaise,
    connectionMode: isCanonical && CONNECTION_MODES.has(row.connection_mode ?? "")
      ? row.connection_mode
      : "manual",
    financialYear: row.financial_year,
    updatedAt: row.updated_at,
    setupCompletedAt: row.setup_completed_at ?? row.updated_at,
    requiresOwnerReview: row.profile_version < 3,
    provenance: {
      email: "authenticated_session",
      openingBalances: isCanonical ? "owner_onboarding" : "legacy_owner_record",
    },
  };
}

function isPlainText(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

function isCanonicalPaise(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

async function verifiedEntryAggregate(
  database: Awaited<ReturnType<typeof prepareStore>>,
  ownerKey: string,
) {
  const table = await database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounting_entries' LIMIT 1")
    .all<{ name: string }>();
  if (!table.results.length) return { count: 0, totalPaise: BigInt(0) };

  const result = await database.prepare(`
    SELECT COUNT(*) AS entry_count,
      CAST(COALESCE(SUM(amount_paise), 0) AS TEXT) AS total_paise
    FROM accounting_entries
    WHERE owner_key = ? AND status = 'posted' AND source_type IN ('manual', 'ai_approved')
      AND amount_paise IS NOT NULL AND amount_paise > 0
  `).bind(ownerKey).all<{ entry_count: number; total_paise: string }>();
  const row = result.results[0];
  return {
    count: Number.isSafeInteger(row?.entry_count) ? row.entry_count : 0,
    totalPaise: BigInt(row?.total_paise ?? "0"),
  };
}

function validFinancialYear(value: unknown) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})[\u2013-](\d{2})$/.exec(value.trim());
  if (!match) return false;
  return String(Number(match[1]) + 1).slice(-2) === match[2];
}

function profileSelect() {
  return `
    SELECT owner_key, owner_name, google_email, workspace_name, entity_type,
      annual_revenue, financial_year, opening_accounts, updated_at,
      business_type, custom_business_type, legal_structure,
      opening_bank_paise, cash_in_hand_paise, opening_capital_paise, connection_mode,
      setup_completed_at, profile_version
    FROM business_profiles WHERE owner_key = ? LIMIT 1
  `;
}

export async function GET(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) return unauthenticatedResponse();

  try {
    const database = await prepareStore();
    const result = await database.prepare(profileSelect()).bind(identity.userId).all<ProfileRow>();
    return Response.json(
      { profile: result.results[0] ? publicProfile(result.results[0]) : null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Profile storage is unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const rejected = validateJsonMutation(request);
  if (rejected) return rejected;
  const identity = await getRequestIdentity(request);
  if (!identity) return unauthenticatedResponse();
  const ownerKey = identity.userId;
  const email = identity.email;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const ownerName = typeof body.ownerName === "string" ? body.ownerName.trim() : "";
  const businessName = typeof body.businessName === "string" ? body.businessName.trim() : "";
  const businessType = typeof body.businessType === "string" ? body.businessType : "";
  const customBusinessType = typeof body.customBusinessType === "string" ? body.customBusinessType.trim() : "";
  const legalStructure = typeof body.legalStructure === "string" ? body.legalStructure : "";
  const connectionMode = typeof body.connectionMode === "string" ? body.connectionMode : "";
  const financialYear = typeof body.financialYear === "string" ? body.financialYear.trim() : "";
  const openingBankPaise = body.openingBankPaise;
  const cashInHandPaise = body.cashInHandPaise;
  const openingCapitalPaise = body.openingCapitalPaise;

  if (!isPlainText(ownerName, 100) || !isPlainText(businessName, 120)) {
    return Response.json({ error: "Owner name and business name are required" }, { status: 400 });
  }
  if (!BUSINESS_TYPES.has(businessType)) {
    return Response.json({ error: "Choose a supported business type" }, { status: 400 });
  }
  if (businessType === "other" && !isPlainText(customBusinessType, 80)) {
    return Response.json({ error: "Describe the business type" }, { status: 400 });
  }
  if (businessType !== "other" && customBusinessType.length > 0 && !isPlainText(customBusinessType, 80)) {
    return Response.json({ error: "Custom business type is invalid" }, { status: 400 });
  }
  if (!LEGAL_STRUCTURES.has(legalStructure)) {
    return Response.json({ error: "Choose a supported legal structure" }, { status: 400 });
  }
  if (!CONNECTION_MODES.has(connectionMode)) {
    return Response.json({ error: "Only manual records are currently supported" }, { status: 400 });
  }
  if (!validFinancialYear(financialYear)) {
    return Response.json({ error: "Financial year must look like 2026-27" }, { status: 400 });
  }
  if (!isCanonicalPaise(openingBankPaise) || !isCanonicalPaise(cashInHandPaise) || !isCanonicalPaise(openingCapitalPaise)) {
    return Response.json({ error: "Opening balances must be non-negative whole paise" }, { status: 400 });
  }
  const openingTotalPaise = openingBankPaise + cashInHandPaise;
  if (!Number.isSafeInteger(openingTotalPaise)) {
    return Response.json(
      { error: "Combined opening balances are too large to store without losing paise precision" },
      { status: 400 },
    );
  }
  if (!Number.isSafeInteger(openingTotalPaise + openingCapitalPaise)) {
    return Response.json({ error: "Opening cash and capital are too large to store without losing paise precision" }, { status: 400 });
  }

  try {
    const database = await prepareStore();
    const limited = await enforceRateLimit(database, ownerKey, "profile:write", 20, 60_000);
    if (limited) return limited;
    const [existingResult, entryAggregate] = await Promise.all([
      database.prepare(profileSelect()).bind(ownerKey).all<ProfileRow>(),
      verifiedEntryAggregate(database, ownerKey),
    ]);
    const existing = existingResult.results[0];
    if (
      existing && existing.profile_version >= 2 && entryAggregate.count > 0 &&
      (existing.opening_bank_paise !== openingBankPaise || existing.cash_in_hand_paise !== cashInHandPaise || (existing.profile_version >= 3 && existing.opening_capital_paise !== openingCapitalPaise))
    ) {
      return Response.json(
        { error: "Opening balances are locked after the first posted entry. Record an adjustment through the Journal instead." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (BigInt(openingTotalPaise) + entryAggregate.totalPaise > BigInt(Number.MAX_SAFE_INTEGER)) {
      return Response.json(
        { error: "Opening balances plus posted records exceed ACC's exact paise range" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const now = Date.now();
    const openingAccounts = JSON.stringify({
      schemaVersion: 3,
      openingBankPaise,
      cashInHandPaise,
      openingCapitalPaise,
      source: "owner_onboarding",
    });
    await database.prepare(`
      INSERT INTO business_profiles (
        owner_key, owner_name, google_email, workspace_name, entity_type,
        annual_revenue, financial_year, opening_accounts, updated_at,
        business_type, custom_business_type, legal_structure,
        opening_bank_paise, cash_in_hand_paise, opening_capital_paise, connection_mode,
        setup_completed_at, profile_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 3)
      ON CONFLICT(owner_key) DO UPDATE SET
        owner_name = excluded.owner_name,
        google_email = excluded.google_email,
        workspace_name = excluded.workspace_name,
        entity_type = excluded.entity_type,
        annual_revenue = excluded.annual_revenue,
        financial_year = excluded.financial_year,
        opening_accounts = excluded.opening_accounts,
        updated_at = excluded.updated_at,
        business_type = excluded.business_type,
        custom_business_type = excluded.custom_business_type,
        legal_structure = excluded.legal_structure,
        opening_bank_paise = excluded.opening_bank_paise,
        cash_in_hand_paise = excluded.cash_in_hand_paise,
        opening_capital_paise = excluded.opening_capital_paise,
        connection_mode = excluded.connection_mode,
        setup_completed_at = COALESCE(business_profiles.setup_completed_at, excluded.setup_completed_at),
        profile_version = 3
    `).bind(
      ownerKey,
      ownerName,
      email,
      businessName,
      legalStructure,
      0,
      financialYear,
      openingAccounts,
      now,
      businessType,
      customBusinessType,
      legalStructure,
      openingBankPaise,
      cashInHandPaise,
      openingCapitalPaise,
      connectionMode,
      now,
    ).run();

    const result = await database.prepare(profileSelect()).bind(ownerKey).all<ProfileRow>();
    if (!result.results[0]) throw new Error("Saved profile could not be read back");
    return Response.json(
      { profile: publicProfile(result.results[0]) },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Unable to save the profile" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
