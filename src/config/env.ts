/**
 * Configuration des variables d'environnement
 * Charge et valide toutes les variables nécessaires
 */

import dotenv from "dotenv";
import path from "path";

// Charger le fichier .env
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

/**
 * Configuration du serveur
 */
export const SERVER_CONFIG = {
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
};

/**
 * Configuration Y-Note/Paynote
 */
export const YNOTE_CONFIG = {
  tokenUrl: process.env.YNOTE_TOKEN_URL || "https://omapi-token.ynote.africa/oauth2/token",
  baseUrl: process.env.YNOTE_BASE_URL || "https://omapi.ynote.africa/prod",
  currency: "XAF",
};

/**
 * Credentials Y-Note
 */
export const YNOTE_CREDENTIALS = {
  clientId: process.env.YNOTE_CLIENT_ID || "",
  clientSecret: process.env.YNOTE_CLIENT_SECRET || "",
  customerKey: process.env.YNOTE_CUSTOMER_KEY || "",
  subscriptionKey: process.env.YNOTE_SUBSCRIPTION_KEY || "",
};

/**
 * Configuration Firebase Admin
 */
export const FIREBASE_CONFIG = {
  projectId: process.env.FIREBASE_PROJECT_ID || "ilios-pub-c2eee",
  // Le chemin vers le fichier de credentials (service account)
  credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || "",
};

/**
 * Configuration CORS
 */
export const CORS_CONFIG = {
  // URLs autorisées pour les requêtes cross-origin
  allowedOrigins: [
    "http://localhost:5173",
    "http://localhost:8080",
    "http://localhost:3000",
    "http://localhost:3001",
    "https://ilios-pub-c2eee.web.app",
    "https://ilios-pub-c2eee.firebaseapp.com",
    ...(process.env.ADDITIONAL_CORS_ORIGINS?.split(",") || []),
  ].filter(Boolean),
};

/**
 * Configuration du callback
 */
export const CALLBACK_CONFIG = {
  host: process.env.CALLBACK_HOST || "http://localhost:3001",
  path: "/api/webhooks/ynote-callback",
  get url() {
    return `${this.host}${this.path}`;
  },
};

/**
 * Valide que toutes les variables d'environnement requises sont présentes
 * @throws Error si une variable requise est manquante
 */
export function validateEnv(): void {
  const required: { key: string; value: string }[] = [
    { key: "YNOTE_CLIENT_ID", value: YNOTE_CREDENTIALS.clientId },
    { key: "YNOTE_CLIENT_SECRET", value: YNOTE_CREDENTIALS.clientSecret },
    { key: "YNOTE_CUSTOMER_KEY", value: YNOTE_CREDENTIALS.customerKey },
    { key: "YNOTE_SUBSCRIPTION_KEY", value: YNOTE_CREDENTIALS.subscriptionKey },
  ];

  const missing = required.filter((item) => !item.value);

  if (missing.length > 0) {
    const missingKeys = missing.map((item) => item.key).join(", ");
    console.error(`❌ Variables d'environnement manquantes: ${missingKeys}`);
    console.error("📝 Consultez le fichier .env.example pour la configuration");

    if (SERVER_CONFIG.isProduction) {
      throw new Error(`Variables d'environnement manquantes: ${missingKeys}`);
    } else {
      console.warn("⚠️  Mode développement: continuant sans toutes les credentials...");
    }
  }
}

/**
 * Affiche la configuration actuelle (sans les secrets)
 */
export function logConfig(): void {
  console.log("📋 Configuration chargée:");
  console.log(`   - Port: ${SERVER_CONFIG.port}`);
  console.log(`   - Environnement: ${SERVER_CONFIG.nodeEnv}`);
  console.log(`   - Y-Note Base URL: ${YNOTE_CONFIG.baseUrl}`);
  console.log(`   - Firebase Project: ${FIREBASE_CONFIG.projectId}`);
  console.log(`   - Callback URL: ${CALLBACK_CONFIG.url}`);
  console.log(`   - CORS Origins: ${CORS_CONFIG.allowedOrigins.length} domaines`);
  console.log(`   - Credentials Y-Note: ${YNOTE_CREDENTIALS.clientId ? "✅" : "❌"}`);
}

export default {
  server: SERVER_CONFIG,
  ynote: YNOTE_CONFIG,
  credentials: YNOTE_CREDENTIALS,
  firebase: FIREBASE_CONFIG,
  cors: CORS_CONFIG,
  callback: CALLBACK_CONFIG,
  validateEnv,
  logConfig,
};
