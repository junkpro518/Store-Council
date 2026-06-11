export const config = {
  anthropicModel: "claude-opus-4-8",
  port: Number(process.env.PORT ?? 3000),
  dataDir: process.env.DATA_DIR ?? "./data",
  dailyCron: process.env.DAILY_CRON ?? "0 5 * * *",
  salla: {
    clientId: process.env.SALLA_CLIENT_ID ?? "",
    clientSecret: process.env.SALLA_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.SALLA_REDIRECT_URI ??
      "http://localhost:3000/auth/salla/callback",
    authBase: "https://accounts.salla.sa/oauth2",
    apiBase: "https://api.salla.dev/admin/v2",
  },
};
