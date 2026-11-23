// UI-side permission helpers. These only decide what to SHOW; the API enforces every rule.
import type { Me } from "./types";

export const PERM = {
  usersView: "users.view",
  usersManage: "users.manage",
  rolesManage: "roles.manage",
  sessionsManage: "sessions.manage",
  auditView: "audit.view",
  securityView: "security.view",
  customersCreate: "customers.create",
  customersEdit: "customers.edit",
  customersAssign: "customers.assign",
  customersDelete: "customers.delete",
  projectsCreate: "projects.create",
  projectsEdit: "projects.edit",
  billsUpload: "bills.upload",
  billsReview: "bills.review",
  calculatorUse: "calculator.use",
  calculationsValidate: "calculations.validate",
  proposalsView: "proposals.view",
  proposalsCreate: "proposals.create",
  proposalsApprove: "proposals.approve",
  proposalsShare: "proposals.share",
  confidential: "commercial.confidential.view",
  pricingManage: "pricing.manage",
  reportsView: "reports.view",
} as const;

export function can(me: Pick<Me, "permissions"> | null | undefined, perm: string): boolean {
  if (!me) return false;
  return me.permissions.includes("*") || me.permissions.includes(perm);
}

export function canAny(me: Pick<Me, "permissions"> | null | undefined, ...perms: string[]): boolean {
  return perms.some((p) => can(me, p));
}
