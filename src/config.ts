/**
 * Static configuration only. Everything the owner should be able to change at
 * runtime lives in src/settings/settings.ts and is editable from the dashboard.
 */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: process.env.DATA_DIR ?? "./data",
  salla: {
    authBase: process.env.SALLA_ACCOUNTS_BASE ?? "https://accounts.salla.sa/oauth2",
    apiBase: "https://api.salla.dev/admin/v2",
  },
};
