"""Permission catalogue and default roles.

Rules:
* Roles are lists of permission strings. "*" means every permission (Super Administrator only).
* A user can only grant permissions they hold themselves (prevents privilege escalation).
* Roles holding any permission in MFA_REQUIRED must have MFA enabled before they can act.
"""
from __future__ import annotations

PERMISSIONS: dict[str, str] = {
    # Administration
    "users.view": "View employee accounts",
    "users.manage": "Approve, reject, disable users and assign roles/departments",
    "roles.manage": "Create and edit roles and permissions",
    "sessions.manage": "View and revoke any user's sessions",
    "audit.view": "View audit logs",
    "security.view": "View the security dashboard and alerts",
    "settings.manage": "Change application settings",
    # Customers
    "customers.view": "View customers assigned to me",
    "customers.view_department": "View all customers in my department",
    "customers.view_all": "View all customers",
    "customers.create": "Create customers",
    "customers.edit": "Edit customers I can see",
    "customers.assign": "Assign customers to employees",
    "customers.delete": "Delete customers",
    # Projects
    "projects.create": "Create projects for customers I can see",
    "projects.edit": "Edit projects I can see",
    # Bills
    "bills.upload": "Upload electricity bills",
    "bills.review": "Review and correct extracted bill data",
    # Calculator
    "calculator.use": "Run BESS calculations",
    "calculations.validate": "Technically validate (approve/reject) BESS configurations",
    # Proposals
    "proposals.view": "View proposals for projects I can see",
    "proposals.create": "Generate proposals",
    "proposals.approve": "Commercially approve proposals",
    "proposals.share": "Share approved proposals externally",
    # Commercial / reporting
    "commercial.confidential.view": "See vendor pricing, purchase costs and margins",
    "pricing.manage": "Edit vendor pricing and financial assumptions",
    "reports.view": "View management dashboards and reports",
}

ADMIN_PERMISSIONS = {"users.manage", "roles.manage", "sessions.manage", "settings.manage", "pricing.manage"}
MFA_REQUIRED = ADMIN_PERMISSIONS | {"*"}

DEFAULT_ROLES: dict[str, dict] = {
    "Super Administrator": {
        "description": "Full access to everything, including roles and security.",
        "permissions": ["*"],
    },
    "IT/Security Administrator": {
        "description": "Manages accounts, sessions and security monitoring. No customer or commercial data.",
        "permissions": [
            "users.view", "users.manage", "roles.manage", "sessions.manage",
            "audit.view", "security.view", "settings.manage",
        ],
    },
    "Management": {
        "description": "Company-wide visibility, approvals and reporting.",
        "permissions": [
            "users.view", "customers.view", "customers.view_all", "customers.assign",
            "projects.edit", "proposals.view", "proposals.approve", "commercial.confidential.view",
            "reports.view", "calculator.use", "audit.view",
        ],
    },
    "BESS Engineer": {
        "description": "Technical design and validation of BESS configurations.",
        "permissions": [
            "customers.view", "projects.edit", "bills.upload", "bills.review",
            "calculator.use", "calculations.validate", "proposals.view",
        ],
    },
    "Sales Executive": {
        "description": "Manages own customers, uploads bills and prepares proposals.",
        "permissions": [
            "customers.view", "customers.create", "customers.edit", "projects.create", "projects.edit",
            "bills.upload", "bills.review", "calculator.use", "proposals.view", "proposals.create",
            "proposals.share",
        ],
    },
    "Finance/Commercial Team": {
        "description": "Pricing, margins and commercial approval.",
        "permissions": [
            "customers.view", "customers.view_all", "proposals.view", "proposals.approve",
            "commercial.confidential.view", "pricing.manage", "reports.view", "calculator.use",
        ],
    },
    "Read-only User": {
        "description": "Read-only access to assigned customers and their proposals.",
        "permissions": ["customers.view", "proposals.view"],
    },
}

DEFAULT_DEPARTMENTS = ["Management", "Sales", "Engineering", "Finance", "IT", "Operations"]


def expand(perms: list[str] | None) -> set[str]:
    perms = perms or []
    if "*" in perms:
        return set(PERMISSIONS) | {"*"}
    return {p for p in perms if p in PERMISSIONS}


def requires_mfa(perms: list[str] | None) -> bool:
    return bool(set(perms or []) & MFA_REQUIRED)


def can_grant(granter_perms: set[str], requested: list[str]) -> bool:
    if "*" in granter_perms:
        return True
    if "*" in requested:
        return False
    return set(requested) <= granter_perms
