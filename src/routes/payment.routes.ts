/**
 * Routes de paiement MTN Mobile Money
 * Endpoints pour initier, vérifier et rembourser des paiements
 */

import { Router, Response } from "express";
import { authenticateToken, requireAdmin, AuthenticatedRequest } from "../middleware/auth";
import ynoteService from "../services/ynote.service";
import {
  InitiatePaymentRequest,
  CheckStatusRequest,
  RefundRequest,
} from "../types/payment.types";

const router = Router();

/**
 * POST /api/payments/initiate
 * Initie un paiement MTN Mobile Money
 *
 * Body:
 * - campaignId: string (requis)
 * - amount: number (requis, minimum 100 FCFA)
 * - phoneNumber: string (requis, numéro MTN Cameroun)
 * - payerMessage?: string (optionnel)
 *
 * Headers:
 * - Authorization: Bearer <firebase_id_token>
 */
router.post(
  "/initiate",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { campaignId, amount, phoneNumber, payerMessage } = req.body as InitiatePaymentRequest;

      // Validation basique
      if (!campaignId) {
        res.status(400).json({
          success: false,
          error: "campaignId est requis",
          code: "INVALID_ARGUMENT",
        });
        return;
      }

      if (!amount || amount < 100) {
        res.status(400).json({
          success: false,
          error: "Le montant minimum est de 100 FCFA",
          code: "INVALID_ARGUMENT",
        });
        return;
      }

      if (!phoneNumber) {
        res.status(400).json({
          success: false,
          error: "phoneNumber est requis",
          code: "INVALID_ARGUMENT",
        });
        return;
      }

      // Valider le numéro MTN
      const phoneValidation = ynoteService.validateMtnPhoneNumber(phoneNumber);
      if (!phoneValidation.isValid) {
        res.status(400).json({
          success: false,
          error: phoneValidation.error || "Numéro de téléphone MTN invalide",
          code: "INVALID_PHONE",
        });
        return;
      }

      // Initier le paiement
      const result = await ynoteService.initiatePayment(
        { campaignId, amount, phoneNumber, payerMessage },
        req.user!.uid
      );

      res.status(200).json(result);
    } catch (error: any) {
      console.error("❌ Erreur /initiate:", error.message);

      // Mapper les erreurs métier
      if (error.message.includes("introuvable")) {
        res.status(404).json({
          success: false,
          error: error.message,
          code: "NOT_FOUND",
        });
        return;
      }

      if (error.message.includes("appartient pas")) {
        res.status(403).json({
          success: false,
          error: error.message,
          code: "PERMISSION_DENIED",
        });
        return;
      }

      if (error.message.includes("attente de paiement")) {
        res.status(400).json({
          success: false,
          error: error.message,
          code: "INVALID_STATUS",
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: error.message || "Erreur lors de l'initiation du paiement",
        code: "INTERNAL_ERROR",
      });
    }
  }
);

/**
 * POST /api/payments/status
 * Vérifie le statut d'un paiement
 *
 * Body:
 * - referenceId: string (requis)
 * - campaignId?: string (optionnel, pour mise à jour automatique)
 *
 * Headers:
 * - Authorization: Bearer <firebase_id_token>
 */
router.post(
  "/status",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { referenceId, campaignId } = req.body as CheckStatusRequest;

      if (!referenceId) {
        res.status(400).json({
          success: false,
          error: "referenceId est requis",
          code: "INVALID_ARGUMENT",
        });
        return;
      }

      const result = await ynoteService.checkPaymentStatus(
        referenceId,
        campaignId,
        req.user?.uid
      );

      res.status(200).json(result);
    } catch (error: any) {
      console.error("❌ Erreur /status:", error.message);

      res.status(500).json({
        success: false,
        error: error.message || "Erreur lors de la vérification du statut",
        code: "INTERNAL_ERROR",
      });
    }
  }
);

/**
 * GET /api/payments/status/:referenceId
 * Vérifie le statut d'un paiement (GET alternatif)
 *
 * Params:
 * - referenceId: string
 *
 * Query:
 * - campaignId?: string
 *
 * Headers:
 * - Authorization: Bearer <firebase_id_token>
 */
router.get(
  "/status/:referenceId",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { referenceId } = req.params;
      const { campaignId } = req.query;

      if (!referenceId) {
        res.status(400).json({
          success: false,
          error: "referenceId est requis",
          code: "INVALID_ARGUMENT",
        });
        return;
      }

      const result = await ynoteService.checkPaymentStatus(
        referenceId,
        campaignId as string | undefined,
        req.user?.uid
      );

      res.status(200).json(result);
    } catch (error: any) {
      console.error("❌ Erreur GET /status:", error.message);

      res.status(500).json({
        success: false,
        error: error.message || "Erreur lors de la vérification du statut",
        code: "INTERNAL_ERROR",
      });
    }
  }
);

/**
 * POST /api/payments/refund
 * Crée une demande de remboursement (admin uniquement)
 *
 * Body:
 * - referenceId: string (requis)
 * - amount: number (requis)
 * - phoneNumber: string (requis)
 * - reason: string (requis)
 *
 * Headers:
 * - Authorization: Bearer <firebase_id_token> (admin)
 */
router.post(
  "/refund",
  authenticateToken,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { referenceId, amount, phoneNumber, reason } = req.body as RefundRequest;

      if (!referenceId || !amount || !phoneNumber || !reason) {
        res.status(400).json({
          success: false,
          error: "Tous les champs sont requis: referenceId, amount, phoneNumber, reason",
          code: "INVALID_ARGUMENT",
        });
        return;
      }

      const result = await ynoteService.createRefundRequest(
        referenceId,
        amount,
        phoneNumber,
        reason,
        req.user!.uid
      );

      res.status(200).json(result);
    } catch (error: any) {
      console.error("❌ Erreur /refund:", error.message);

      if (error.message.includes("administrateurs")) {
        res.status(403).json({
          success: false,
          error: error.message,
          code: "PERMISSION_DENIED",
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: error.message || "Erreur lors de la demande de remboursement",
        code: "INTERNAL_ERROR",
      });
    }
  }
);

/**
 * POST /api/payments/validate-phone
 * Valide un numéro de téléphone MTN (sans authentification requise)
 *
 * Body:
 * - phoneNumber: string
 */
router.post("/validate-phone", (req, res): void => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    res.status(400).json({
      success: false,
      error: "phoneNumber est requis",
      code: "INVALID_ARGUMENT",
    });
    return;
  }

  const validation = ynoteService.validateMtnPhoneNumber(phoneNumber);

  if (validation.isValid) {
    res.status(200).json({
      success: true,
      isValid: true,
      formattedNumber: ynoteService.formatPhoneNumber(phoneNumber),
    });
  } else {
    res.status(200).json({
      success: true,
      isValid: false,
      error: validation.error,
    });
  }
});

export default router;
