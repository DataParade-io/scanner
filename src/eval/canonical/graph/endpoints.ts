import type { OptionalAssertion } from "../types";
import {
  ProseFlowKeyError,
  type AssertedFlowEndpoints,
  type ParseTypedFlowKeyResult,
  type TypedComponentEndpoint,
} from "./types";

const FLOW_PREFIX = "flow:";

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

/**
 * Parse a single component endpoint key `type:name` (e.g. `asset:api`).
 * Returns null for prose keys without a type prefix (e.g. `password`).
 */
export function parseComponentEndpointKey(key: string): TypedComponentEndpoint | null {
  const normalized = normalizeToken(key);
  const colon = normalized.indexOf(":");
  if (colon <= 0) {
    return null;
  }
  const componentType = normalized.slice(0, colon);
  const endpointKey = normalized.slice(colon + 1);
  if (!componentType || !endpointKey) {
    return null;
  }
  return { componentType, endpointKey };
}

function parseTypedFlowBody(body: string): AssertedFlowEndpoints | null {
  const arrow = body.indexOf("->");
  if (arrow <= 0) {
    return null;
  }
  const sourcePart = body.slice(0, arrow);
  const targetPart = body.slice(arrow + 2);
  const source = parseComponentEndpointKey(sourcePart);
  const target = parseComponentEndpointKey(targetPart);
  if (!source || !target) {
    return null;
  }
  return { source, target };
}

/**
 * Parse already-typed flow keys only: `flow:{type}:{name}->{type}:{name}`.
 * Prose corpus keys (e.g. `flow:password->wp_check_password`) are not parsed.
 */
export function parseTypedFlowKey(key: string): ParseTypedFlowKeyResult {
  const normalized = normalizeToken(key);
  if (!normalized.startsWith(FLOW_PREFIX)) {
    return { parsed: false, reason: "missing flow: prefix" };
  }
  const body = normalized.slice(FLOW_PREFIX.length);
  const endpoints = parseTypedFlowBody(body);
  if (!endpoints) {
    return {
      parsed: false,
      reason: "sides must be typed component keys (type:name on both source and target)",
    };
  }
  return { parsed: true, endpoints };
}

export function parseTypedFlowKeyOrThrow(key: string): AssertedFlowEndpoints {
  const result = parseTypedFlowKey(key);
  if (!result.parsed) {
    throw new ProseFlowKeyError(key, result.reason);
  }
  return result.endpoints;
}

function optionalAssertionsMatch(
  expected?: Pick<OptionalAssertion, "vendor" | "instance">,
  actual?: Pick<OptionalAssertion, "vendor" | "instance">,
): boolean {
  if (!expected) {
    return true;
  }
  if (expected.vendor !== undefined && actual?.vendor !== expected.vendor) {
    return false;
  }
  if (expected.instance !== undefined && actual?.instance !== expected.instance) {
    return false;
  }
  return true;
}

export function typedComponentEndpointsMatch(
  expected: TypedComponentEndpoint,
  actual: TypedComponentEndpoint,
): boolean {
  if (normalizeToken(expected.componentType) !== normalizeToken(actual.componentType)) {
    return false;
  }
  if (normalizeToken(expected.endpointKey) !== normalizeToken(actual.endpointKey)) {
    return false;
  }
  if (
    expected.componentSubtype !== undefined &&
    normalizeToken(expected.componentSubtype) !== normalizeToken(actual.componentSubtype ?? "")
  ) {
    return false;
  }
  return optionalAssertionsMatch(expected.optionalAssertion, actual.optionalAssertion);
}

export function flowEndpointsMatch(
  expected: AssertedFlowEndpoints,
  actual: AssertedFlowEndpoints,
): boolean {
  return (
    typedComponentEndpointsMatch(expected.source, actual.source) &&
    typedComponentEndpointsMatch(expected.target, actual.target)
  );
}

export function flowDataCategoriesMatch(
  expected: readonly string[],
  actual: readonly string[],
): boolean {
  const normalizedExpected = expected.map(normalizeToken).sort();
  const normalizedActual = actual.map(normalizeToken).sort();
  if (normalizedExpected.length !== normalizedActual.length) {
    return false;
  }
  return normalizedExpected.every((category, index) => category === normalizedActual[index]);
}
