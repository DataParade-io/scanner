// @ts-nocheck
import { JsonServiceClient } from "@servicestack/client";

const client = new JsonServiceClient("/");

export async function loadTodos() {
  return client.api(new QueryTodos());
}
