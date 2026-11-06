// Types for the in-memory Postgres helper used by the tests.
import type { PGlite } from "@electric-sql/pglite";
export function freshDb(): Promise<PGlite>;
