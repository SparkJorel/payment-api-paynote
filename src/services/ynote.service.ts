/**
 * Service Y-Note/MTN Mobile Money
 * Gère toute la logique de paiement via l'API Y-Note/Paynote
 *
 * Documentation: https://www.paynote.africa/
 * Endpoints Y-Note:
 * - Token: POST https://omapi-token.ynote.africa/oauth2/token
 * - Payment: POST https://omapi.ynote.africa/prod/webpayment
 * - Status: POST https://omapi.ynote.africa/prod/webpaymentmtn/status
 */

import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import * as admin from "firebase-admin";
import {
  YNOTE_CONFIG,
  YNOTE_CREDENTIALS,
  CALLBACK_CONFIG,
} from "../config/env";
import {
  CachedToken,
  PaymentResponse,
  PaymentStatusResponse,
  NormalizedYnoteStatus,
  InitiatePaymentRequest,
  MtnCallbackData,
  PaymentStatus,
} from "../types/payment.types";

// Cache pour le token OAuth (évite les requêtes répétées - erreur 429)
let cachedToken: CachedToken | null = null;

/**
 * Initialise Firebase Admin SDK
 */
export function initializeFirebase(): void {
  if (admin.apps.length === 0) {
    // En production, utiliser les credentials du service account
    // En dev, Firebase Admin peut utiliser l'émulateur ou les credentials par défaut
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    } else {
      // Initialisation sans credentials pour les tests locaux
      // Nécessite FIREBASE_AUTH_EMULATOR_HOST pour l'émulateur
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || "ilios-pub-c2eee",
      });
    }
    console.log("✅ Firebase Admin SDK initialisé");
  }
}

/**
 * Récupère l'instance Firestore
 */
export function getDb(): admin.firestore.Firestore {
  return admin.firestore();
}

/**
 * Vérifie que les credentials Y-Note sont configurées
 */
function validateCredentials(): void {
  const { clientId, clientSecret, customerKey, subscriptionKey } = YNOTE_CREDENTIALS;

  console.log("🔐 Vérification des credentials Y-Note:", {
    hasClientId: !!clientId,
    hasClientSecret: !!clientSecret,
    hasCustomerKey: !!customerKey,
    hasSubscriptionKey: !!subscriptionKey,
  });

  if (!clientId || !clientSecret) {
    throw new Error("Credentials Y-Note (clientId/clientSecret) non configurées. Vérifiez votre fichier .env");
  }

  if (!customerKey || !subscriptionKey) {
    throw new Error("Credentials client Y-Note (customerKey/subscriptionKey) non configurées. Vérifiez votre fichier .env");
  }
}

/**
 * Génère un token d'accès OAuth 2.0 pour l'API Y-Note
 * Utilise Basic Auth avec clientId:clientSecret et grant_type=client_credentials
 * Le token est mis en cache pour éviter les requêtes répétées (erreur 429)
 */
async function getAccessToken(): Promise<string> {
  const { clientId, clientSecret } = YNOTE_CREDENTIALS;

  // Vérifier si on a un token en cache encore valide (avec 60s de marge)
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60000) {
    console.log("🔄 Utilisation du token Y-Note en cache");
    return cachedToken.token;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  console.log("🔑 Obtention d'un nouveau token Y-Note...");

  try {
    const response = await axios.post(
      YNOTE_CONFIG.tokenUrl,
      "grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const data = response.data;
    console.log("✅ Token Y-Note obtenu avec succès");

    // Mettre en cache le token (expire généralement en 3600 secondes)
    const expiresIn = data.expires_in || 3600;
    cachedToken = {
      token: data.access_token,
      expiresAt: now + expiresIn * 1000,
    };

    return data.access_token;
  } catch (error: any) {
    console.error("❌ Erreur obtention token Y-Note:", error.response?.data || error.message);
    throw new Error(`Erreur d'authentification Y-Note: ${error.response?.status || "Unknown"}`);
  }
}

/**
 * Formate le numéro de téléphone au format MSISDN
 * Ex: 677123456 -> 237677123456 (Cameroun)
 */
export function formatPhoneNumber(phone: string): string {
  // Supprimer tous les caractères non numériques
  let cleaned = phone.replace(/\D/g, "");

  // Si le numéro commence par 0, le supprimer
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.substring(1);
  }

  // Si le numéro ne commence pas par l'indicatif pays (237 pour Cameroun)
  if (!cleaned.startsWith("237")) {
    cleaned = "237" + cleaned;
  }

  return cleaned;
}

/**
 * Valide un numéro de téléphone MTN Cameroun
 */
export function validateMtnPhoneNumber(phone: string): { isValid: boolean; error?: string } {
  const cleaned = phone.replace(/\D/g, "");

  // Vérifier la longueur
  if (cleaned.length < 9) {
    return { isValid: false, error: "Numéro trop court" };
  }

  // Supprimer le préfixe 237 si présent pour la validation
  let numberToCheck = cleaned;
  if (cleaned.startsWith("237")) {
    numberToCheck = cleaned.substring(3);
  }

  // Supprimer le 0 initial si présent
  if (numberToCheck.startsWith("0")) {
    numberToCheck = numberToCheck.substring(1);
  }

  // Vérifier que c'est un numéro MTN (préfixes: 65, 67, 68)
  const mtnPrefixes = ["65", "67", "68"];
  const prefix = numberToCheck.substring(0, 2);

  if (!mtnPrefixes.includes(prefix)) {
    return { isValid: false, error: "Ce n'est pas un numéro MTN Cameroun" };
  }

  return { isValid: true };
}

/**
 * Initie un paiement MTN Mobile Money via Y-Note
 */
export async function initiatePayment(
  request: InitiatePaymentRequest,
  userId: string
): Promise<PaymentResponse> {
  console.log("💳 Initiation paiement MTN:", { ...request, userId });

  // Valider les credentials
  validateCredentials();

  const { campaignId, amount, phoneNumber, payerMessage } = request;

  // Validation des paramètres
  if (!campaignId || !amount || !phoneNumber) {
    throw new Error("Paramètres manquants: campaignId, amount, phoneNumber requis");
  }

  if (amount < 100) {
    throw new Error("Le montant minimum est de 100 FCFA");
  }

  // Valider le numéro MTN
  const phoneValidation = validateMtnPhoneNumber(phoneNumber);
  if (!phoneValidation.isValid) {
    throw new Error(phoneValidation.error || "Numéro de téléphone invalide");
  }

  const db = getDb();

  // Vérifier que la campagne existe et appartient à l'utilisateur
  const campaignRef = db.collection("campaigns").doc(campaignId);
  const campaignDoc = await campaignRef.get();

  if (!campaignDoc.exists) {
    throw new Error("Campagne introuvable");
  }

  const campaignData = campaignDoc.data();
  if (campaignData?.userId !== userId) {
    throw new Error("Cette campagne ne vous appartient pas");
  }

  if (campaignData?.status !== "pending_payment") {
    throw new Error("Cette campagne n'est pas en attente de paiement");
  }

  try {
    // Obtenir le token d'accès Y-Note
    const accessToken = await getAccessToken();

    // Générer un ID de référence unique
    const referenceId = uuidv4();

    // Formater le numéro de téléphone avec le préfixe 237
    const formattedPhone = formatPhoneNumber(phoneNumber);

    console.log("📱 Numéro formaté:", formattedPhone);

    // Préparer la requête de paiement Y-Note
    const paymentBody = {
      API_MUT: {
        notifUrl: CALLBACK_CONFIG.url,
        subscriberMsisdn: formattedPhone, // Avec préfixe 237
        description: payerMessage || `Paiement campagne Ilios: ${campaignData?.name || campaignId}`,
        amount: amount.toString(),
        order_id: referenceId,
        customerkey: YNOTE_CREDENTIALS.customerKey,
        customersecret: YNOTE_CREDENTIALS.subscriptionKey,
        PaiementMethod: "MTN_CMR",
      },
    };

    console.log("📤 Envoi requête paiement Y-Note...");

    // Appeler l'API Y-Note webpayment
    const paymentUrl = `${YNOTE_CONFIG.baseUrl}/webpayment`;
    const response = await axios.post(paymentUrl, paymentBody, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const paymentResponse = response.data;
    console.log("📥 Réponse Y-Note:", JSON.stringify(paymentResponse));

    // Vérifier si Y-Note a retourné une erreur (même avec HTTP 200)
    // Note: Y-Note peut retourner errorCode: 200 pour indiquer un succès, donc on l'ignore
    const errorCode = paymentResponse.errorCode || paymentResponse.ErrorCode;
    const successCodes = [200, 201, "200", "201"];
    if (errorCode && !successCodes.includes(errorCode)) {
      console.error("❌ Erreur Y-Note:", paymentResponse);
      const errorMessage = paymentResponse.ErrorMessage || paymentResponse.body || paymentResponse.message || "Erreur inconnue";
      throw new Error(`Erreur Y-Note (${errorCode}): ${errorMessage}`);
    }

    // Extraire le MessageId de Y-Note (c'est cet ID qu'il faut utiliser pour vérifier le statut)
    const ynoteMessageId = paymentResponse.parameters?.MessageId || referenceId;
    console.log("✅ Paiement Y-Note initié, ynoteMessageId:", ynoteMessageId, "referenceId:", referenceId);

    // Sauvegarder la transaction dans Firestore
    const transactionRef = db.collection("mtn_transactions").doc(referenceId);
    await transactionRef.set({
      referenceId,
      ynoteMessageId, // ID Y-Note pour vérifier le statut
      campaignId,
      userId,
      amount,
      currency: YNOTE_CONFIG.currency,
      phoneNumber: formattedPhone,
      status: paymentResponse.status || "PENDING",
      paymentMethod: "mtn",
      ynoteResponse: paymentResponse,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });

    // Mettre à jour la campagne avec la référence de transaction
    await campaignRef.update({
      mtnReferenceId: referenceId,
      ynoteMessageId, // ID Y-Note pour vérifier le statut
      mtnPaymentStatus: "PENDING",
      updatedAt: admin.firestore.Timestamp.now(),
    });

    console.log(`✅ Transaction ${referenceId} enregistrée pour campagne ${campaignId}`);

    return {
      success: true,
      referenceId: ynoteMessageId, // Retourner le MessageId Y-Note pour la vérification du statut
      status: "PENDING",
      message: "Paiement initié. Veuillez confirmer sur votre téléphone.",
    };
  } catch (error: any) {
    console.error("❌ Erreur initiation paiement:", error.message);
    throw error;
  }
}

/**
 * Normalise la réponse de statut Y-Note vers un format standard
 */
function normalizeYnoteStatus(ynoteResponse: any): NormalizedYnoteStatus {
  // Y-Note peut retourner le statut dans différents champs selon la version de l'API
  const status = ynoteResponse.status || ynoteResponse.transactionStatus || "PENDING";

  // Mapper les statuts Y-Note vers les statuts standard
  let normalizedStatus: PaymentStatus = "PENDING";

  if (status === "SUCCESSFUL" || status === "SUCCESS" || status === "COMPLETED") {
    normalizedStatus = "SUCCESSFUL";
  } else if (status === "FAILED" || status === "REJECTED" || status === "CANCELLED" || status === "EXPIRED") {
    normalizedStatus = "FAILED";
  }

  return {
    status: normalizedStatus,
    amount: ynoteResponse.amount ? parseInt(ynoteResponse.amount) : undefined,
    transactionId: ynoteResponse.transactionId || ynoteResponse.financialTransactionId || ynoteResponse.externalId,
    reason: ynoteResponse.reason || ynoteResponse.message || ynoteResponse.errorMessage,
  };
}

/**
 * Vérifie le statut d'un paiement via Y-Note
 */
export async function checkPaymentStatus(
  referenceId: string,
  campaignId?: string,
  userId?: string
): Promise<PaymentStatusResponse> {
  console.log("🔍 Vérification statut paiement:", { referenceId, campaignId });

  if (!referenceId) {
    throw new Error("referenceId requis");
  }

  // Valider les credentials
  validateCredentials();

  const db = getDb();

  try {
    // Obtenir le token d'accès Y-Note
    const accessToken = await getAccessToken();

    // Vérifier le statut auprès de Y-Note
    const statusUrl = `${YNOTE_CONFIG.baseUrl}/webpaymentmtn/status`;
    console.log("📤 Appel API statut Y-Note:", statusUrl);

    const response = await axios.post(
      statusUrl,
      {
        message_id: referenceId,
        customerkey: YNOTE_CREDENTIALS.customerKey,
        customersecret: YNOTE_CREDENTIALS.subscriptionKey,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const paymentStatus = response.data;
    console.log("📥 Statut Y-Note:", JSON.stringify(paymentStatus));

    // Normaliser le statut
    const normalizedStatus = normalizeYnoteStatus(paymentStatus);

    // Mettre à jour la transaction dans Firestore
    const transactionRef = db.collection("mtn_transactions").doc(referenceId);
    const transactionDoc = await transactionRef.get();

    if (transactionDoc.exists) {
      await transactionRef.update({
        status: normalizedStatus.status,
        ynoteStatusResponse: paymentStatus,
        updatedAt: admin.firestore.Timestamp.now(),
      });
    }

    // Si le paiement est réussi, mettre à jour la campagne
    if (normalizedStatus.status === "SUCCESSFUL" && campaignId) {
      await handleSuccessfulPayment(campaignId, referenceId, normalizedStatus, userId);
    }

    return {
      success: true,
      status: normalizedStatus.status,
      amount: normalizedStatus.amount?.toString(),
      currency: YNOTE_CONFIG.currency,
      financialTransactionId: normalizedStatus.transactionId,
      reason: normalizedStatus.reason,
    };
  } catch (error: any) {
    console.error("❌ Erreur vérification statut:", error.response?.data || error.message);
    throw new Error(error.message || "Erreur lors de la vérification du statut");
  }
}

/**
 * Gère un paiement réussi - met à jour la campagne et crée une notification
 */
async function handleSuccessfulPayment(
  campaignId: string,
  referenceId: string,
  status: NormalizedYnoteStatus,
  userId?: string
): Promise<void> {
  const db = getDb();
  const campaignRef = db.collection("campaigns").doc(campaignId);
  const campaignDoc = await campaignRef.get();

  if (campaignDoc.exists && campaignDoc.data()?.status === "pending_payment") {
    const campaignData = campaignDoc.data();

    await campaignRef.update({
      status: "scheduled",
      paymentMethod: "mtn",
      paymentAmount: status.amount || 0,
      paidAt: admin.firestore.Timestamp.now(),
      mtnPaymentStatus: "SUCCESSFUL",
      mtnTransactionId: status.transactionId || referenceId,
      updatedAt: admin.firestore.Timestamp.now(),
      updatedBy: userId || campaignData?.userId,
    });

    console.log(`✅ Campagne ${campaignId} mise à jour vers scheduled`);

    // Créer une notification pour l'utilisateur
    await db.collection("notifications").add({
      recipientId: campaignData?.userId,
      recipientType: "user",
      campaignId,
      type: "payment_success",
      message: `Paiement MTN Mobile Money de ${status.amount || 0} FCFA confirmé pour votre campagne.`,
      createdAt: admin.firestore.Timestamp.now(),
      isRead: false,
    });
  }
}

/**
 * Traite le callback de Y-Note/MTN
 */
export async function handleCallback(callbackData: MtnCallbackData): Promise<void> {
  console.log("📨 Callback Y-Note reçu:", JSON.stringify(callbackData));

  const referenceId = callbackData.referenceId || callbackData.order_id;
  const status = callbackData.status;
  const financialTransactionId = callbackData.financialTransactionId;

  if (!referenceId) {
    throw new Error("referenceId manquant dans le callback");
  }

  const db = getDb();

  // Récupérer la transaction
  const transactionRef = db.collection("mtn_transactions").doc(referenceId);
  const transactionDoc = await transactionRef.get();

  if (!transactionDoc.exists) {
    console.error(`❌ Transaction ${referenceId} introuvable`);
    throw new Error("Transaction introuvable");
  }

  const transactionData = transactionDoc.data();

  // Mettre à jour la transaction
  await transactionRef.update({
    status,
    financialTransactionId,
    mtnCallbackData: callbackData,
    updatedAt: admin.firestore.Timestamp.now(),
  });

  console.log(`✅ Transaction ${referenceId} mise à jour: ${status}`);

  // Si le paiement est réussi, mettre à jour la campagne
  if (status === "SUCCESSFUL" && transactionData?.campaignId) {
    const campaignRef = db.collection("campaigns").doc(transactionData.campaignId);
    const campaignDoc = await campaignRef.get();

    if (campaignDoc.exists && campaignDoc.data()?.status === "pending_payment") {
      await campaignRef.update({
        status: "scheduled",
        paymentMethod: "mtn",
        paymentAmount: transactionData.amount,
        paidAt: admin.firestore.Timestamp.now(),
        mtnPaymentStatus: "SUCCESSFUL",
        mtnTransactionId: financialTransactionId || referenceId,
        updatedAt: admin.firestore.Timestamp.now(),
        updatedBy: transactionData.userId,
      });

      console.log(`✅ Campagne ${transactionData.campaignId} mise à jour via callback`);

      // Créer une notification pour l'utilisateur
      await db.collection("notifications").add({
        recipientId: transactionData.userId,
        recipientType: "user",
        campaignId: transactionData.campaignId,
        type: "payment_success",
        message: `Paiement MTN Mobile Money de ${transactionData.amount} FCFA confirmé pour votre campagne.`,
        createdAt: admin.firestore.Timestamp.now(),
        isRead: false,
      });
    }
  } else if (status === "FAILED" && transactionData?.campaignId) {
    // Notifier l'utilisateur de l'échec
    await db.collection("notifications").add({
      recipientId: transactionData.userId,
      recipientType: "user",
      campaignId: transactionData.campaignId,
      type: "payment_failed",
      message: `Le paiement MTN Mobile Money de ${transactionData.amount} FCFA a échoué. Veuillez réessayer.`,
      createdAt: admin.firestore.Timestamp.now(),
      isRead: false,
    });

    // Mettre à jour le statut de la campagne
    const campaignRef = db.collection("campaigns").doc(transactionData.campaignId);
    await campaignRef.update({
      mtnPaymentStatus: "FAILED",
      updatedAt: admin.firestore.Timestamp.now(),
    });
  }
}

/**
 * Crée une demande de remboursement (traitement manuel)
 */
export async function createRefundRequest(
  referenceId: string,
  amount: number,
  phoneNumber: string,
  reason: string,
  requestedBy: string
): Promise<{ success: boolean; refundId: string; message: string }> {
  console.log("💰 Demande de remboursement:", { referenceId, amount, requestedBy });

  if (!referenceId || !amount || !phoneNumber) {
    throw new Error("Paramètres manquants pour le remboursement");
  }

  const db = getDb();

  // Vérifier que l'utilisateur est admin
  const userDoc = await db.collection("users").doc(requestedBy).get();
  const userRole = userDoc.data()?.role;

  if (userRole !== "admin" && userRole !== "both") {
    throw new Error("Seuls les administrateurs peuvent effectuer des remboursements");
  }

  // Note: Pour un remboursement automatique, il faudrait utiliser l'API Disbursement de MTN
  // qui nécessite une configuration séparée. Pour l'instant, on enregistre la demande
  // pour traitement manuel.

  const refundId = uuidv4();

  await db.collection("mtn_refunds").add({
    refundId,
    originalReferenceId: referenceId,
    amount,
    phoneNumber: formatPhoneNumber(phoneNumber),
    reason,
    status: "PENDING_MANUAL",
    requestedBy,
    createdAt: admin.firestore.Timestamp.now(),
  });

  console.log(`✅ Demande de remboursement créée: ${refundId}`);

  return {
    success: true,
    refundId,
    message: "Demande de remboursement enregistrée. Traitement manuel requis.",
  };
}

export default {
  initializeFirebase,
  getDb,
  formatPhoneNumber,
  validateMtnPhoneNumber,
  initiatePayment,
  checkPaymentStatus,
  handleCallback,
  createRefundRequest,
};
