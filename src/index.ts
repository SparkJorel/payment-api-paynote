/**
 * Point d'entrée de l'API de paiement Y-Note/MTN Mobile Money
 *
 * Ce serveur Express expose les endpoints nécessaires pour:
 * - Initier des paiements MTN Mobile Money
 * - Vérifier le statut des paiements
 * - Recevoir les callbacks de Y-Note
 * - Gérer les remboursements (admin)
 */

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

// Configuration
import config, { validateEnv, logConfig, CORS_CONFIG, SERVER_CONFIG } from "./config/env";

// Services
import ynoteService from "./services/ynote.service";

// Routes
import paymentRoutes from "./routes/payment.routes";
import webhookRoutes from "./routes/webhook.routes";

// Initialiser Express
const app = express();

// ============== MIDDLEWARE ==============

// CORS - Configuration simple et permissive pour le développement
const corsOptions = SERVER_CONFIG.isProduction
  ? {
      origin: CORS_CONFIG.allowedOrigins,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    }
  : {
      origin: true, // Autorise TOUTES les origines en développement
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    };

app.use(cors(corsOptions));

// Sécurité: headers HTTP (après CORS) - désactivé en dev pour éviter les conflits
if (SERVER_CONFIG.isProduction) {
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" },
  }));
}

// Logging des requêtes
app.use(morgan(SERVER_CONFIG.isProduction ? "combined" : "dev"));

// Parser JSON
app.use(express.json());

// Parser URL-encoded
app.use(express.urlencoded({ extended: true }));

// ============== ROUTES ==============

// Route de santé (health check)
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    service: "payment-api",
    status: "healthy",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: SERVER_CONFIG.nodeEnv,
  });
});

// Route racine
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "API de paiement Y-Note/MTN Mobile Money",
    version: "1.0.0",
    documentation: "/api/docs",
    endpoints: {
      health: "GET /health",
      payments: {
        initiate: "POST /api/payments/initiate",
        status: "POST /api/payments/status",
        statusGet: "GET /api/payments/status/:referenceId",
        refund: "POST /api/payments/refund (admin)",
        validatePhone: "POST /api/payments/validate-phone",
      },
      webhooks: {
        callback: "POST /api/webhooks/ynote-callback",
        health: "GET /api/webhooks/health",
      },
    },
  });
});

// Documentation basique
app.get("/api/docs", (req: Request, res: Response) => {
  res.status(200).json({
    title: "API de paiement Y-Note/MTN Mobile Money",
    version: "1.0.0",
    description: "API pour gérer les paiements MTN Mobile Money via Y-Note/Paynote au Cameroun",
    baseUrl: `http://localhost:${SERVER_CONFIG.port}`,
    authentication: "Firebase ID Token dans le header Authorization: Bearer <token>",
    endpoints: [
      {
        method: "POST",
        path: "/api/payments/initiate",
        description: "Initier un paiement MTN Mobile Money",
        auth: "required",
        body: {
          campaignId: "string (requis)",
          amount: "number (requis, min 100 FCFA)",
          phoneNumber: "string (requis, numéro MTN Cameroun)",
          payerMessage: "string (optionnel)",
        },
        response: {
          success: "boolean",
          referenceId: "string (UUID)",
          status: "PENDING | SUCCESSFUL | FAILED",
          message: "string",
        },
      },
      {
        method: "POST",
        path: "/api/payments/status",
        description: "Vérifier le statut d'un paiement",
        auth: "required",
        body: {
          referenceId: "string (requis)",
          campaignId: "string (optionnel)",
        },
        response: {
          success: "boolean",
          status: "PENDING | SUCCESSFUL | FAILED",
          amount: "string",
          currency: "XAF",
          financialTransactionId: "string",
          reason: "string (si échec)",
        },
      },
      {
        method: "POST",
        path: "/api/payments/refund",
        description: "Demander un remboursement (admin uniquement)",
        auth: "required (admin)",
        body: {
          referenceId: "string (requis)",
          amount: "number (requis)",
          phoneNumber: "string (requis)",
          reason: "string (requis)",
        },
      },
      {
        method: "POST",
        path: "/api/payments/validate-phone",
        description: "Valider un numéro MTN Cameroun",
        auth: "non requis",
        body: {
          phoneNumber: "string (requis)",
        },
      },
      {
        method: "POST",
        path: "/api/webhooks/ynote-callback",
        description: "Webhook pour les callbacks Y-Note (appelé par Y-Note)",
        auth: "non requis",
      },
    ],
    errorCodes: {
      UNAUTHENTICATED: "Token d'authentification manquant ou invalide",
      TOKEN_EXPIRED: "Token expiré",
      INVALID_ARGUMENT: "Paramètre manquant ou invalide",
      INVALID_PHONE: "Numéro de téléphone MTN invalide",
      NOT_FOUND: "Ressource introuvable",
      PERMISSION_DENIED: "Accès non autorisé",
      INVALID_STATUS: "Statut de campagne invalide pour cette opération",
      INTERNAL_ERROR: "Erreur serveur interne",
    },
  });
});

// Routes de paiement
app.use("/api/payments", paymentRoutes);

// Routes webhook
app.use("/api/webhooks", webhookRoutes);

// ============== GESTION DES ERREURS ==============

// Route 404
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} non trouvée`,
    code: "NOT_FOUND",
  });
});

// Gestionnaire d'erreurs global
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("❌ Erreur non gérée:", err);

  // Erreur CORS
  if (err.message.includes("CORS")) {
    res.status(403).json({
      success: false,
      error: "Accès CORS refusé",
      code: "CORS_ERROR",
    });
    return;
  }

  // Erreur JSON parsing
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({
      success: false,
      error: "JSON invalide dans le corps de la requête",
      code: "INVALID_JSON",
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: SERVER_CONFIG.isProduction ? "Erreur serveur interne" : err.message,
    code: "INTERNAL_ERROR",
  });
});

// ============== DÉMARRAGE DU SERVEUR ==============

async function startServer(): Promise<void> {
  try {
    console.log("\n🚀 Démarrage du serveur Payment API...\n");

    // Valider les variables d'environnement
    validateEnv();

    // Afficher la configuration
    logConfig();

    // Initialiser Firebase Admin SDK
    ynoteService.initializeFirebase();

    // Démarrer le serveur
    const PORT = SERVER_CONFIG.port;
    app.listen(PORT, () => {
      console.log(`\n✅ Serveur démarré sur http://localhost:${PORT}`);
      console.log(`📋 Documentation: http://localhost:${PORT}/api/docs`);
      console.log(`🏥 Health check: http://localhost:${PORT}/health`);
      console.log(`\n📌 Endpoints disponibles:`);
      console.log(`   POST /api/payments/initiate`);
      console.log(`   POST /api/payments/status`);
      console.log(`   GET  /api/payments/status/:referenceId`);
      console.log(`   POST /api/payments/refund (admin)`);
      console.log(`   POST /api/payments/validate-phone`);
      console.log(`   POST /api/webhooks/ynote-callback`);
      console.log(`\n🎉 Prêt à recevoir des requêtes!\n`);
    });
  } catch (error) {
    console.error("❌ Erreur au démarrage:", error);
    process.exit(1);
  }
}

// Gestion de l'arrêt propre
process.on("SIGINT", () => {
  console.log("\n👋 Arrêt du serveur...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n👋 Arrêt du serveur (SIGTERM)...");
  process.exit(0);
});

// Démarrer le serveur
startServer();

export default app;
