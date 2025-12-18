/**
 * Routes Webhook pour les callbacks Y-Note/MTN
 * Reçoit les notifications de changement de statut de paiement
 */

import { Router, Request, Response } from "express";
import ynoteService from "../services/ynote.service";

const router = Router();

/**
 * POST /api/webhooks/ynote-callback
 * Webhook pour recevoir les callbacks de Y-Note/MTN
 *
 * Ce endpoint est appelé par Y-Note quand le statut d'un paiement change.
 * Il ne nécessite pas d'authentification Firebase mais peut implémenter
 * une vérification de signature si Y-Note le supporte.
 *
 * Body attendu (peut varier selon Y-Note):
 * - referenceId ou order_id: string
 * - status: string (SUCCESSFUL, FAILED, etc.)
 * - financialTransactionId?: string
 * - amount?: number
 * - message?: string
 */
router.post("/ynote-callback", async (req: Request, res: Response): Promise<void> => {
  console.log("📨 Webhook Y-Note reçu");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));

  // Vérifier que c'est bien une requête POST
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  try {
    // Traiter le callback
    await ynoteService.handleCallback(req.body);

    // Répondre avec succès
    res.status(200).json({ success: true, message: "Callback traité avec succès" });
  } catch (error: any) {
    console.error("❌ Erreur traitement callback:", error.message);

    // Même en cas d'erreur, on renvoie un 200 pour éviter les retentatives
    // mais on logue l'erreur pour investigation
    if (error.message.includes("introuvable")) {
      res.status(404).json({ error: error.message });
      return;
    }

    if (error.message.includes("manquant")) {
      res.status(400).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Erreur interne lors du traitement" });
  }
});

/**
 * GET /api/webhooks/ynote-callback
 * Endpoint de vérification pour Y-Note (certains providers font un GET d'abord)
 */
router.get("/ynote-callback", (req: Request, res: Response): void => {
  console.log("📨 Webhook Y-Note GET (vérification)");

  // Répondre avec un 200 pour confirmer que l'endpoint existe
  res.status(200).json({
    success: true,
    message: "Webhook endpoint actif",
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/webhooks/test
 * Endpoint de test pour simuler un callback (développement uniquement)
 */
router.post("/test", async (req: Request, res: Response): Promise<void> => {
  // Uniquement en développement
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  console.log("🧪 Test callback reçu:", JSON.stringify(req.body, null, 2));

  try {
    // Simuler le traitement
    const { referenceId, status } = req.body;

    if (!referenceId) {
      res.status(400).json({ error: "referenceId requis pour le test" });
      return;
    }

    // Appeler le handler avec les données de test
    await ynoteService.handleCallback({
      referenceId,
      status: status || "SUCCESSFUL",
      financialTransactionId: `TEST_${Date.now()}`,
    });

    res.status(200).json({
      success: true,
      message: "Test callback traité",
      data: req.body,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/webhooks/health
 * Endpoint de santé pour vérifier que le service webhook fonctionne
 */
router.get("/health", (req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    service: "webhook",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

export default router;
