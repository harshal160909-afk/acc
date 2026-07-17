const MAX_SAFE_PAISE_TEXT = String(Number.MAX_SAFE_INTEGER);

export type MoneyValidationErrorCode =
  | "not_a_string"
  | "empty"
  | "currency_only"
  | "negative"
  | "scientific_notation"
  | "non_finite"
  | "malformed"
  | "unsafe_integer";

export type MoneyValidationResult =
  | { valid: true; amountPaise: number; ok: true; paise: number }
  | {
      valid: false;
      amountPaise?: never;
      ok: false;
      paise?: never;
      code: MoneyValidationErrorCode;
      error: string;
    };

const plainIntegerPattern = /^\d+$/;
const westernGroupedIntegerPattern = /^\d{1,3}(?:,\d{3})+$/;
const indianGroupedIntegerPattern = /^\d{1,2}(?:,\d{2})*,\d{3}$/;

function invalid(
  code: MoneyValidationErrorCode,
  error: string,
): MoneyValidationResult {
  return { valid: false, ok: false, code, error };
}

function isValidGroupedInteger(value: string): boolean {
  if (!value.includes(",")) return plainIntegerPattern.test(value);

  return (
    westernGroupedIntegerPattern.test(value) ||
    indianGroupedIntegerPattern.test(value)
  );
}

/**
 * Validates a rupee string and converts it to exact integer paise.
 *
 * Accepted examples: 1000, 1,000, 1000.50, ₹1,000 and ₹ 1,000.
 * Grouped input may use either consistent Indian or western grouping. Output
 * formatting always uses the Indian numbering system.
 */
export function validateMoneyValue(value: unknown): MoneyValidationResult {
  if (typeof value !== "string") {
    return invalid("not_a_string", "Enter the amount as text.");
  }

  const trimmed = value.trim();

  if (!trimmed) return invalid("empty", "Enter an amount.");
  if (/^-/.test(trimmed) || /^\s*₹\s*-/.test(trimmed)) {
    return invalid("negative", "Enter an amount greater than or equal to zero.");
  }
  if (/^\+/.test(trimmed) || /^\s*₹\s*\+/.test(trimmed)) {
    return invalid("malformed", "Enter the amount without a plus sign.");
  }
  if (/[eE]/.test(trimmed)) {
    return invalid(
      "scientific_notation",
      "Scientific notation is not accepted. Enter the full amount.",
    );
  }
  if (/^(?:₹\s*)?(?:NaN|Infinity)$/i.test(trimmed)) {
    return invalid("non_finite", "Enter a finite monetary amount.");
  }

  const withoutCurrency = trimmed.startsWith("₹")
    ? trimmed.slice(1).trimStart()
    : trimmed;

  if (!withoutCurrency) {
    return invalid("currency_only", "Enter an amount after the rupee symbol.");
  }

  // A rupee sign is only valid as the single leading currency symbol.
  if (withoutCurrency.includes("₹")) {
    return invalid("malformed", "The amount contains an invalid rupee symbol.");
  }

  const decimalParts = withoutCurrency.split(".");
  if (decimalParts.length > 2) {
    return invalid("malformed", "Use no more than one decimal point.");
  }

  const [integerPart, fractionPart] = decimalParts;
  if (!integerPart || !isValidGroupedInteger(integerPart)) {
    return invalid(
      "malformed",
      "Enter a valid amount with correctly placed commas.",
    );
  }

  if (
    fractionPart !== undefined &&
    !/^\d{1,2}$/.test(fractionPart)
  ) {
    return invalid("malformed", "Use at most two digits after the decimal point.");
  }

  const integerDigits = integerPart.replaceAll(",", "");
  const fractionDigits = (fractionPart ?? "").padEnd(2, "0");

  const normalisedRupees = integerDigits.replace(/^0+(?=\d)/, "");
  const paiseText = `${normalisedRupees}${fractionDigits || "00"}`.replace(
    /^0+(?=\d)/,
    "",
  );
  if (
    paiseText.length > MAX_SAFE_PAISE_TEXT.length ||
    (paiseText.length === MAX_SAFE_PAISE_TEXT.length &&
      paiseText > MAX_SAFE_PAISE_TEXT)
  ) {
    return invalid(
      "unsafe_integer",
      "This amount is too large to store without losing precision.",
    );
  }

  const amountPaise = Number(paiseText);
  return { valid: true, amountPaise, ok: true, paise: amountPaise };
}

/**
 * Parses a money field without throwing. The discriminated result prevents an
 * invalid value from being mistaken for a verified zero.
 */
export function parseMoneyInput(value: string): MoneyValidationResult {
  return validateMoneyValue(value);
}

/** Returns exact integer paise and throws a descriptive error when invalid. */
export function parseMoneyInputOrThrow(value: string): number {
  const result = parseMoneyInput(value);

  if (!result.valid) throw new TypeError(result.error);
  return result.amountPaise;
}

export function isSafePaise(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Number.isFinite(value)
  );
}

function assertSafePaise(value: number): void {
  if (!isSafePaise(value)) {
    throw new RangeError("Money must be stored as a safe integer number of paise.");
  }
}

function groupIndianDigits(digits: string): string {
  if (digits.length <= 3) return digits;

  const lastThree = digits.slice(-3);
  const leading = digits.slice(0, -3);
  const groupedLeading = leading.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${groupedLeading},${lastThree}`;
}

function formatPaiseParts(
  amountPaise: number,
  includeCurrency: boolean,
): string {
  assertSafePaise(amountPaise);

  const negative = amountPaise < 0;
  const absoluteText = Math.abs(amountPaise).toString().padStart(3, "0");
  const rupeesText = absoluteText.slice(0, -2).replace(/^0+(?=\d)/, "");
  const paiseText = absoluteText.slice(-2);
  const groupedRupees = groupIndianDigits(rupeesText);
  const fraction = paiseText === "00" ? "" : `.${paiseText}`;
  const sign = negative ? "-" : "";
  const currency = includeCurrency ? "₹" : "";

  return `${sign}${currency}${groupedRupees}${fraction}`;
}

/** Formats exact integer paise as a full INR amount using Indian grouping. */
export function formatINR(amountPaise: number): string {
  return formatPaiseParts(amountPaise, true);
}

/** Formats exact integer paise for an editable money field, without a symbol. */
export function formatMoneyInput(amountPaise: number): string {
  return formatPaiseParts(amountPaise, false);
}
