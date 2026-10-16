export const config = {
  app: {
    port: Number(process.env.PORT) || 3000,
    env: process.env.NODE_ENV || 'development',
  },
  db: {
    nis: {
      host: process.env.DB_NIS_HOST || '127.0.0.1',
      port: Number(process.env.DB_NIS_PORT) || 3306,
      user: process.env.DB_NIS_USER || 'root',
      password: process.env.DB_NIS_PASSWORD || '',
      database: process.env.DB_NIS_NAME || 'nis_db',
    },
    dashboard: {
      host: process.env.DB_DASHBOARD_HOST || '127.0.0.1',
      port: Number(process.env.DB_DASHBOARD_PORT) || 3306,
      user: process.env.DB_DASHBOARD_USER || 'root',
      password: process.env.DB_DASHBOARD_PASSWORD || '',
      database: process.env.DB_DASHBOARD_NAME || 'digital_bisnis',
    }
  },
  nusawork: {
    apiUrl: process.env.NUSAWORK_API_URL || '',
    clientId: process.env.NUSAWORK_CLIENT_ID || '',
    clientSecret: process.env.NUSAWORK_CLIENT_SECRET || '',
  },
  auth: {
    apiUrl: process.env.AUTH_API_URL || '',
    jwtSecret: process.env.JWT_SECRET || 'secret',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },
  feedback: {
    // Web app Apps Script yang menulis feedback ke Google Sheet (lihat apps-script/feedback.gs)
    appsScriptUrl: process.env.FEEDBACK_APPS_SCRIPT_URL || '',
    appsScriptSecret: process.env.FEEDBACK_APPS_SCRIPT_SECRET || '',
    // Origin publik backend ini (yang menyajikan /api/uploads), untuk link lampiran di sheet
    appUrl: process.env.APP_URL || '',
  },
  client: {
    // API key untuk client eksternal (/api/commission/:email), dipisah koma kalau lebih dari satu
    apiKeys: (process.env.CLIENT_API_KEYS || '').split(',').map(key => key.trim()).filter(Boolean),
  }
};
