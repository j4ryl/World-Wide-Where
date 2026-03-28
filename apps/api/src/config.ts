import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { z } from "zod";

const rootDir = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

dotenv.config({ path: path.join(rootDir, ".env") });

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  API_PUBLIC_BASE_URL: z.string().url().optional(),
  VITE_API_BASE_URL: z.string().url().optional(),
  WORKER_BASE_URL: z.string().url().default("http://localhost:3001"),
  PUBLIC_APP_URL: z.string().url().default("http://localhost:5173"),
  DISCOVERY_MODE: z.enum(["hybrid", "live", "cache"]).default("hybrid"),
  LIVE_SCOUT_PER_QUERY_LIMIT: z.coerce.number().int().positive().default(3),
  VERIFY_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(6000),
  OPENAI_STEP_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  OPENAI_WEB_SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  DEMO_ATTRACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(7000),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_PLANNER_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_SYNTH_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-5.4-mini"),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
});

const parsedEnv = envSchema.parse(process.env);

export const config = {
  ...parsedEnv,
  API_PUBLIC_BASE_URL:
    parsedEnv.API_PUBLIC_BASE_URL ?? parsedEnv.VITE_API_BASE_URL ?? `http://localhost:${parsedEnv.PORT}`,
};
export { rootDir };
