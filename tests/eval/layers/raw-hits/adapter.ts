import { scanFixturePersonalDataLayer, scanCanonicalPersonalDataLayer } from "../personal-data-adapter";

export async function scanFixtureRawHits(fixture: string) {
  return scanFixturePersonalDataLayer(fixture, "raw-hits");
}

export async function scanCanonicalRawHits(fixture: string) {
  return scanCanonicalPersonalDataLayer(fixture, "raw-hits");
}
