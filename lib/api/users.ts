/**
 * API functions for Users.
 *
 * CUSTOMIZE: Adjust role handling and mock users for your domain.
 */

import type { User, UserRole } from "@/lib/types";
import { MOCK_USERS } from "@/lib/types";
import { getAllUsers, getUserById as _getUserById } from "@/lib/db";

export async function listUsers(): Promise<User[]> {
  return getAllUsers();
}

export async function getUserById(id: string): Promise<User | undefined> {
  return _getUserById(id);
}

/**
 * Returns a mock user for the given role.
 * Useful for demo/dev mode when no real auth is configured.
 * CUSTOMIZE: Update MOCK_USERS in lib/types.ts to match your roles.
 */
export function getUserForRole(role: UserRole): User {
  return MOCK_USERS[role];
}
