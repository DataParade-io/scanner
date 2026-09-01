import { scanFixturePersonalDataLayer, scanCanonicalPersonalDataLayer } from "../personal-data-adapter";

export async function scanFixtureDataItems(fixture: string) {
  return scanFixturePersonalDataLayer(fixture, "data-items");
}

export async function scanCanonicalDataItems(fixture: string) {
  return scanCanonicalPersonalDataLayer(fixture, "data-items");
}
