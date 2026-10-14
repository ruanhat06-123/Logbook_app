export const SARS_TRAVEL_COST_RULES = Object.freeze({
  taxYear: "2027",
  effectiveFrom: "2026-03-01",
  effectiveTo: "2027-02-28",
  sourceUrl: "https://www.sars.gov.za/wp-content/uploads/Docs/PAYE/Tables/tables2026/PAYE-GEN-01-G03-A01-Rate-per-Kilometre-Schedule-External-Annexure.pdf",
  bands: Object.freeze([
    { upToRand: 115000, annualFixedCostRand: 38344, fuelCentsPerKm: 132.9, maintenanceCentsPerKm: 49.1 },
    { upToRand: 230000, annualFixedCostRand: 68487, fuelCentsPerKm: 148.4, maintenanceCentsPerKm: 61.4 },
    { upToRand: 345000, annualFixedCostRand: 98689, fuelCentsPerKm: 161.2, maintenanceCentsPerKm: 67.8 },
    { upToRand: 460000, annualFixedCostRand: 125393, fuelCentsPerKm: 173.4, maintenanceCentsPerKm: 74 },
    { upToRand: 575000, annualFixedCostRand: 152097, fuelCentsPerKm: 185.5, maintenanceCentsPerKm: 86.9 },
    { upToRand: 690000, annualFixedCostRand: 180078, fuelCentsPerKm: 212.8, maintenanceCentsPerKm: 102 },
    { upToRand: 805000, annualFixedCostRand: 208106, fuelCentsPerKm: 216.5, maintenanceCentsPerKm: 114.5 },
    { upToRand: 920000, annualFixedCostRand: 237679, fuelCentsPerKm: 220.1, maintenanceCentsPerKm: 126.1 },
    { upToRand: null, annualFixedCostRand: 237679, fuelCentsPerKm: 220.1, maintenanceCentsPerKm: 126.9 },
  ]),
  reimbursiveRateRandPerKm: 4.95,
  wearAndTear: Object.freeze({
    sourceUrl: "https://www.sars.gov.za/wp-content/uploads/Legal/Notes/IntR-IN-2021-01-Arc-01-IN-47-Issue-4-IN47-Wear-And-Tear-Depreciation-Allowance-9-February-2021.pdf",
    sourceStatus: "archived-guidance",
    indicativePassengerCarLifeYears: 5,
    indicativeDeliveryVehicleLifeYears: 4,
  }),
  fringeBenefit: Object.freeze({
    standardMonthlyRate: 0.035,
    maintenancePlanMonthlyRate: 0.0325,
  }),
});

function requireFinite(name, value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === "") {
    throw new RangeError(`${name} is required.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new RangeError(`${name} must be a finite number between ${min} and ${max}.`);
  }
  return number;
}

function roundRand(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function findTravelBand(valueRand, rules) {
  return rules.bands.find((band) => band.upToRand === null || valueRand <= band.upToRand);
}

function businessProportion(businessKm, totalKm) {
  const business = requireFinite("businessKm", businessKm);
  const total = requireFinite("totalKm", totalKm);
  if (business > total) throw new RangeError("businessKm cannot exceed totalKm.");
  if (total === 0 && business !== 0) throw new RangeError("A non-zero business distance requires totalKm.");
  return total === 0 ? 0 : business / total;
}

/**
 * Section 11(e) straight-line illustration. It is not a determination of the
 * allowable deduction: asset classification, use, commencement date, cost
 * basis, private use, and SARS rulings can change the tax treatment.
 */
export function calculateWearAndTear({
  costRand,
  usefulLifeYears = SARS_TRAVEL_COST_RULES.wearAndTear.indicativePassengerCarLifeYears,
  residualValueRand = 0,
  businessUsePercent = 100,
  daysInUseThisTaxYear = 365,
  daysInTaxYear = 365,
} = {}) {
  const cost = requireFinite("costRand", costRand);
  const residual = requireFinite("residualValueRand", residualValueRand, { max: cost });
  const life = requireFinite("usefulLifeYears", usefulLifeYears, { min: 1, max: 100 });
  const businessUse = requireFinite("businessUsePercent", businessUsePercent, { max: 100 }) / 100;
  const daysInUse = requireFinite("daysInUseThisTaxYear", daysInUseThisTaxYear, { min: 0, max: 366 });
  const daysInYear = requireFinite("daysInTaxYear", daysInTaxYear, { min: 1, max: 366 });
  if (daysInUse > daysInYear) throw new RangeError("Days in use cannot exceed days in the tax year.");

  const depreciableBasis = cost - residual;
  const fullYearDepreciation = depreciableBasis / life;
  const timeApportioned = fullYearDepreciation * (daysInUse / daysInYear);
  return {
    method: "straight-line-illustration",
    usefulLifeYears: life,
    depreciableBasisRand: roundRand(depreciableBasis),
    fullYearAmountRand: roundRand(fullYearDepreciation),
    businessUseAmountRand: roundRand(timeApportioned * businessUse),
    businessUsePercent: Number((businessUse * 100).toFixed(2)),
    sourceStatus: SARS_TRAVEL_COST_RULES.wearAndTear.sourceStatus,
    requiresTaxReview: true,
  };
}

/**
 * The SARS kilometre schedule for a qualifying travel allowance calculation.
 * Fuel and maintenance components are included only when the employee bore
 * those full costs; fixed cost is apportioned for the business-use period.
 */
export function calculateDeemedTravelCosts({
  determinedValueRand,
  totalKm,
  businessKm,
  businessUseMonths = 12,
  employerExpectedBusinessUsePercent = 0,
  employeeBoreFullFuelCost = false,
  employeeBoreFullMaintenanceCost = false,
  rules = SARS_TRAVEL_COST_RULES,
} = {}) {
  const value = requireFinite("determinedValueRand", determinedValueRand, { min: 1 });
  const total = requireFinite("totalKm", totalKm);
  const business = requireFinite("businessKm", businessKm);
  const ratio = businessProportion(business, total);
  const months = requireFinite("businessUseMonths", businessUseMonths, { min: 0, max: 12 });
  const expectedBusinessUse = requireFinite(
    "employerExpectedBusinessUsePercent",
    employerExpectedBusinessUsePercent,
    { max: 100 },
  );
  const band = findTravelBand(value, rules);
  if (!band) throw new Error(`No SARS kilometre cost band is configured for tax year ${rules.taxYear}.`);

  const annualFixedCostForPeriod = band.annualFixedCostRand * (months / 12);
  const fixedCostBusinessShare = total > 0
    ? annualFixedCostForPeriod * (business / total)
    : 0;
  const fuelCost = employeeBoreFullFuelCost
    ? (band.fuelCentsPerKm / 100) * business
    : 0;
  const maintenanceCost = employeeBoreFullMaintenanceCost
    ? (band.maintenanceCentsPerKm / 100) * business
    : 0;

  return {
    taxYear: rules.taxYear,
    determinedValueBandUpToRand: band.upToRand,
    fixedCostRand: roundRand(fixedCostBusinessShare),
    fuelCostRand: roundRand(fuelCost),
    maintenanceCostRand: roundRand(maintenanceCost),
    totalRand: roundRand(fixedCostBusinessShare + fuelCost + maintenanceCost),
    businessKm: business,
    totalKm: total,
    businessUsePercent: Number((ratio * 100).toFixed(2)),
    monthlyTravelAllowancePayeInclusionPercent: expectedBusinessUse >= 80 ? 20 : 80,
    sourceUrl: rules.sourceUrl,
    requiresTaxReview: true,
  };
}

/**
 * Estimates annual taxable value for private use of an employer-provided
 * vehicle under the standard monthly valuation rate. It does not calculate
 * PAYE or the final assessment adjustment for business kilometres.
 */
export function calculateVehicleFringeBenefit({
  determinedValueRand,
  monthsAvailable,
  maintenancePlanAtAcquisition = false,
  employeeMonthlyContributionRand = 0,
} = {}) {
  const value = requireFinite("determinedValueRand", determinedValueRand, { min: 1 });
  const months = requireFinite("monthsAvailable", monthsAvailable, { min: 0, max: 12 });
  const contribution = requireFinite("employeeMonthlyContributionRand", employeeMonthlyContributionRand);
  const rate = maintenancePlanAtAcquisition
    ? SARS_TRAVEL_COST_RULES.fringeBenefit.maintenancePlanMonthlyRate
    : SARS_TRAVEL_COST_RULES.fringeBenefit.standardMonthlyRate;
  const grossMonthlyValue = value * rate;
  const netMonthlyValue = Math.max(0, grossMonthlyValue - contribution);
  return {
    monthlyRatePercent: rate * 100,
    monthsAvailable: months,
    grossMonthlyValueRand: roundRand(grossMonthlyValue),
    employeeContributionRand: roundRand(contribution),
    estimatedTaxableValueRand: roundRand(netMonthlyValue * months),
    requiresTaxReview: true,
  };
}

/**
 * Compares an actual business-use apportionment with the SARS deemed-cost
 * schedule. The caller supplies actual expenses already assessed as eligible.
 */
export function compareActualAndDeemedTravelCosts({
  determinedValueRand,
  totalKm,
  businessKm,
  businessUseMonths = 12,
  employerExpectedBusinessUsePercent = 0,
  eligibleActualCosts = {},
  employeeBoreFullFuelCost = false,
  employeeBoreFullMaintenanceCost = false,
  rules = SARS_TRAVEL_COST_RULES,
} = {}) {
  const ratio = businessProportion(businessKm, totalKm);
  const actualTotal = Object.entries(eligibleActualCosts).reduce((sum, [category, amount]) => {
    return sum + requireFinite(`eligibleActualCosts.${category}`, amount);
  }, 0);
  const actualBusinessShare = actualTotal * ratio;
  const deemed = calculateDeemedTravelCosts({
    determinedValueRand,
    totalKm,
    businessKm,
    businessUseMonths,
    employerExpectedBusinessUsePercent,
    employeeBoreFullFuelCost,
    employeeBoreFullMaintenanceCost,
    rules,
  });
  return {
    taxYear: rules.taxYear,
    actualBusinessCostsRand: roundRand(actualBusinessShare),
    deemedBusinessCostsRand: deemed.totalRand,
    differenceRand: roundRand(actualBusinessShare - deemed.totalRand),
    businessUsePercent: Number((ratio * 100).toFixed(2)),
    eligibleActualCostCategories: Object.keys(eligibleActualCosts),
    deemed,
    requiresTaxReview: true,
  };
}

export async function saveVehicleTaxProfile(supabase, {
  userId,
  vehicleId,
  costBasisRand,
  purchaseDate,
  assetCategory,
  usefulLifeYears,
  businessUsePercent,
  maintenancePlan = false,
} = {}) {
  if (!supabase || !userId || !vehicleId) {
    throw new TypeError("Supabase, userId, and vehicleId are required.");
  }
  const updates = {
    tax_cost_basis_rand: costBasisRand === null || costBasisRand === undefined
      ? null
      : requireFinite("costBasisRand", costBasisRand),
    tax_purchase_date: purchaseDate || null,
    tax_asset_category: assetCategory || null,
    tax_useful_life_years: usefulLifeYears == null
      ? null
      : requireFinite("usefulLifeYears", usefulLifeYears, { min: 1, max: 100 }),
    tax_business_use_percent: businessUsePercent == null
      ? null
      : requireFinite("businessUsePercent", businessUsePercent, { max: 100 }),
    tax_maintenance_plan: maintenancePlan === true,
  };
  const { data, error } = await supabase
    .from("vehicles")
    .update(updates)
    .eq("id", vehicleId)
    .eq("user_id", userId)
    .select("id, tax_cost_basis_rand, tax_purchase_date, tax_asset_category, tax_useful_life_years, tax_business_use_percent, tax_maintenance_plan")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The tax profile was not saved. Check vehicle ownership and access.");
  return data;
}

export async function saveTaxCalculation(supabase, {
  userId,
  vehicleId,
  taxYear = SARS_TRAVEL_COST_RULES.taxYear,
  rulesVersion = `sars-travel-cost-${SARS_TRAVEL_COST_RULES.taxYear}-v1`,
  calculationType,
  inputs,
  result,
} = {}) {
  if (!supabase || !userId || !vehicleId) {
    throw new TypeError("Supabase, userId, and vehicleId are required.");
  }
  if (!["wear_and_tear", "travel_allowance", "fringe_benefit", "comparison"].includes(calculationType)) {
    throw new RangeError("Unsupported vehicle tax calculation type.");
  }
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    throw new TypeError("Calculation inputs must be a JSON object.");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("Calculation result must be a JSON object.");
  }
  const { data, error } = await supabase
    .from("vehicle_tax_calculations")
    .upsert({
      user_id: userId,
      vehicle_id: vehicleId,
      tax_year: taxYear,
      rules_version: rulesVersion,
      calculation_type: calculationType,
      inputs,
      result,
    }, { onConflict: "user_id,vehicle_id,tax_year,calculation_type" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export default {
  SARS_TRAVEL_COST_RULES,
  calculateWearAndTear,
  calculateDeemedTravelCosts,
  calculateVehicleFringeBenefit,
  compareActualAndDeemedTravelCosts,
  saveVehicleTaxProfile,
  saveTaxCalculation,
};
