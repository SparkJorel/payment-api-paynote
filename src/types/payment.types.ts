/**
 * Types pour le système de paiement Y-Note/MTN Mobile Money
 */

// ============== REQUÊTES ==============

/**
 * Requête pour initier un paiement MTN
 */
export interface InitiatePaymentRequest {
  campaignId: string;
  amount: number;
  phoneNumber: string;
  payerMessage?: string;
  payeeNote?: string;
}

/**
 * Requête pour vérifier le statut d'un paiement
 */
export interface CheckStatusRequest {
  referenceId: string;
  campaignId?: string;
}

/**
 * Requête pour effectuer un remboursement
 */
export interface RefundRequest {
  referenceId: string;
  amount: number;
  phoneNumber: string;
  reason: string;
}

// ============== RÉPONSES ==============

/**
 * Statut d'un paiement
 */
export type PaymentStatus = "PENDING" | "SUCCESSFUL" | "FAILED";

/**
 * Réponse après initiation d'un paiement
 */
export interface PaymentResponse {
  success: boolean;
  referenceId: string;
  status: PaymentStatus;
  message: string;
}

/**
 * Réponse de vérification de statut
 */
export interface PaymentStatusResponse {
  success: boolean;
  status: PaymentStatus;
  amount?: string;
  currency: string;
  financialTransactionId?: string;
  reason?: string;
}

/**
 * Réponse de remboursement
 */
export interface RefundResponse {
  success: boolean;
  refundId: string;
  message: string;
}

// ============== Y-NOTE API ==============

/**
 * Configuration Y-Note
 */
export interface YnoteConfig {
  tokenUrl: string;
  baseUrl: string;
  currency: string;
}

/**
 * Token OAuth Y-Note mis en cache
 */
export interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Corps de la requête de paiement Y-Note
 */
export interface YnotePaymentBody {
  API_MUT: {
    notifUrl: string;
    subscriberMsisdn: string;
    description: string;
    amount: string;
    order_id: string;
    customerkey: string;
    customersecret: string;
    PaiementMethod: string;
  };
}

/**
 * Réponse Y-Note normalisée
 */
export interface NormalizedYnoteStatus {
  status: PaymentStatus;
  amount?: number;
  transactionId?: string;
  reason?: string;
}

// ============== CALLBACK ==============

/**
 * Données du callback MTN/Y-Note
 */
export interface MtnCallbackData {
  referenceId?: string;
  order_id?: string;
  status?: string;
  financialTransactionId?: string;
  amount?: string | number;
  message?: string;
  [key: string]: unknown;
}

// ============== FIRESTORE ==============

/**
 * Transaction MTN stockée en Firestore
 */
export interface MtnTransaction {
  referenceId: string;
  campaignId: string;
  userId: string;
  amount: number;
  currency: string;
  phoneNumber: string;
  status: PaymentStatus;
  paymentMethod: string;
  ynoteResponse?: Record<string, unknown>;
  ynoteStatusResponse?: Record<string, unknown>;
  mtnCallbackData?: MtnCallbackData;
  financialTransactionId?: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

/**
 * Campagne (champs pertinents pour le paiement)
 */
export interface Campaign {
  id: string;
  name: string;
  userId: string;
  status: CampaignStatus;
  totalPrice: number;
  paymentMethod?: string;
  paymentAmount?: number;
  paidAt?: FirebaseFirestore.Timestamp;
  mtnReferenceId?: string;
  mtnPaymentStatus?: PaymentStatus;
  mtnTransactionId?: string;
  updatedAt?: FirebaseFirestore.Timestamp;
  updatedBy?: string;
}

export type CampaignStatus =
  | "draft"
  | "pending_validation"
  | "pending_payment"
  | "scheduled"
  | "active"
  | "paused"
  | "completed"
  | "rejected";

/**
 * Utilisateur (champs pertinents)
 */
export interface User {
  uid: string;
  role?: "user" | "admin" | "both";
}

/**
 * Notification
 */
export interface Notification {
  recipientId: string;
  recipientType: string;
  campaignId?: string;
  type: string;
  message: string;
  createdAt: FirebaseFirestore.Timestamp;
  isRead: boolean;
}

/**
 * Demande de remboursement
 */
export interface RefundRecord {
  refundId: string;
  originalReferenceId: string;
  amount: number;
  phoneNumber: string;
  reason: string;
  status: string;
  requestedBy: string;
  createdAt: FirebaseFirestore.Timestamp;
}

// ============== EXPRESS ==============

/**
 * Extension de Request Express avec l'utilisateur authentifié
 */
export interface AuthenticatedRequest {
  user?: {
    uid: string;
    email?: string;
    role?: string;
  };
}

/**
 * Réponse d'erreur API
 */
export interface ApiError {
  success: false;
  error: string;
  code?: string;
}

/**
 * Réponse générique API
 */
export type ApiResponse<T> = T | ApiError;
