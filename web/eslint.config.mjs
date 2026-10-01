import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Spec §6: the service-role client (bypasses RLS) may only be imported by
  // privileged modules. Everything else must use the caller's JWT.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/privileged/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/privileged/service-role", "@/server/privileged/service-role"],
              message: "Service-role access is confined to src/server/privileged/*. Use supabaseServer() so RLS applies.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
