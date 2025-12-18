/**
 * Middleware d'authentification
 * Vérifie les tokens Firebase ID Token
 */

import { Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin";

/**
 * Interface pour les requêtes authentifiées
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    role?: string;
  };
}

/**
 * Middleware pour vérifier l'authentification via Firebase ID Token
 * Le token doit être passé dans le header Authorization: Bearer <token>
 */
export async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      error: "Token d'authentification manquant",
      code: "UNAUTHENTICATED",
    });
    return;
  }

  const token = authHeader.split("Bearer ")[1];

  try {
    // Vérifier le token avec Firebase Admin
    const decodedToken = await admin.auth().verifyIdToken(token);

    // Attacher les informations utilisateur à la requête
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };

    // Optionnel: récupérer le rôle depuis Firestore
    try {
      const userDoc = await admin.firestore().collection("users").doc(decodedToken.uid).get();
      if (userDoc.exists) {
        req.user.role = userDoc.data()?.role;
      }
    } catch (error) {
      // Ignorer l'erreur si on ne peut pas récupérer le rôle
      console.warn("⚠️  Impossible de récupérer le rôle utilisateur:", error);
    }

    next();
  } catch (error: any) {
    console.error("❌ Erreur vérification token:", error.message);

    if (error.code === "auth/id-token-expired") {
      res.status(401).json({
        success: false,
        error: "Token expiré, veuillez vous reconnecter",
        code: "TOKEN_EXPIRED",
      });
      return;
    }

    res.status(401).json({
      success: false,
      error: "Token invalide",
      code: "INVALID_TOKEN",
    });
  }
}

/**
 * Middleware pour vérifier que l'utilisateur est admin
 * Doit être utilisé APRÈS authenticateToken
 */
export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: "Non authentifié",
      code: "UNAUTHENTICATED",
    });
    return;
  }

  if (req.user.role !== "admin" && req.user.role !== "both") {
    res.status(403).json({
      success: false,
      error: "Accès réservé aux administrateurs",
      code: "FORBIDDEN",
    });
    return;
  }

  next();
}

/**
 * Middleware optionnel pour extraire l'utilisateur sans bloquer
 * Utile pour les endpoints qui fonctionnent avec ou sans authentification
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    // Pas de token, continuer sans utilisateur
    next();
    return;
  }

  const token = authHeader.split("Bearer ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };
  } catch (error) {
    // Ignorer l'erreur, continuer sans utilisateur
    console.warn("⚠️  Token invalide (optionalAuth)");
  }

  next();
}

export default {
  authenticateToken,
  requireAdmin,
  optionalAuth,
};
