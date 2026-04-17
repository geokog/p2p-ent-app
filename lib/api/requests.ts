/**
 * API functions for the core Request entity.
 *
 * Thin async wrappers around the db layer — add authorization,
 * caching, or transformation logic here.
 *
 * CUSTOMIZE: Rename and adjust to match your core entity.
 */

import type { Request, Document, Comment, AuditEvent } from "@/lib/types";
import {
  getAllRequests,
  getRequestById as _getRequestById,
  getDocumentsForRequest as _getDocumentsForRequest,
  getCommentsForRequest as _getCommentsForRequest,
  getAuditEventsForRequest as _getAuditEventsForRequest,
} from "@/lib/db";

export async function listRequests(): Promise<Request[]> {
  return getAllRequests();
}

export async function getRequestById(
  id: string,
): Promise<Request | undefined> {
  return _getRequestById(id);
}

export async function getDocumentsForRequest(
  requestId: string,
): Promise<Document[]> {
  return _getDocumentsForRequest(requestId);
}

export async function getCommentsForRequest(
  requestId: string,
): Promise<Comment[]> {
  return _getCommentsForRequest(requestId);
}

export async function getAuditEventsForRequest(
  requestId: string,
): Promise<AuditEvent[]> {
  return _getAuditEventsForRequest(requestId);
}
