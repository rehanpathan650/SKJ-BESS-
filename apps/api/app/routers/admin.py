"""User approval, role management, departments and session administration."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app import audit
from app.db import get_db
from app.deps import Principal, not_found, require
from app.models import AuthSession, Department, Role, User, UserStatus
from app.security import permissions as P
from app.services.notify import notify, queue_email

router = APIRouter(tags=["admin"])


def utcnow():
    return datetime.now(timezone.utc)


def user_out(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "status": u.status,
        "role": {"id": u.role.id, "name": u.role.name} if u.role else None,
        "department": {"id": u.department.id, "name": u.department.name} if u.department else None,
        "requested_department": (
            {"id": u.requested_department.id, "name": u.requested_department.name}
            if u.requested_department else None
        ),
        "mfa_enabled": u.mfa_enabled,
        "locked_until": u.locked_until,
        "last_login_at": u.last_login_at,
        "created_at": u.created_at,
    }


def _target_guard(p: Principal, target: User) -> None:
    """An admin may not act on themselves or on someone with more privileges than they have."""
    if target.id == p.id:
        raise HTTPException(400, "You cannot change your own account here.")
    target_perms = P.expand(target.role.permissions if target.role else [])
    if not P.can_grant(p.perms, sorted(target_perms)):
        raise HTTPException(403, "You cannot manage a user with more privileges than you.")


def _role_for_grant(db: Session, p: Principal, role_id: str) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise HTTPException(400, "Unknown role")
    if not P.can_grant(p.perms, role.permissions):
        audit.record("security", "privilege_escalation.blocked", actor=p.user, outcome="denied",
                     details={"role": role.name})
        raise HTTPException(403, "You cannot assign a role with permissions you do not have.")
    return role


# ---------- users ----------

@router.get("/users")
def list_users(status: str | None = None, q: str | None = None,
               p: Principal = Depends(require("users.view")), db: Session = Depends(get_db)):
    stmt = select(User).order_by(User.created_at.desc())
    if status:
        stmt = stmt.where(User.status == status)
    if q:
        like = f"%{q.lower()[:100]}%"
        stmt = stmt.where(func.lower(User.email).like(like) | func.lower(User.full_name).like(like))
    return [user_out(u) for u in db.execute(stmt.limit(500)).scalars()]


@router.get("/users/{user_id}")
def get_user(user_id: str, p: Principal = Depends(require("users.view")), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise not_found()
    return user_out(u)


class ApproveIn(BaseModel):
    role_id: str = Field(max_length=36)
    department_id: str | None = Field(default=None, max_length=36)


@router.post("/users/{user_id}/approve")
def approve_user(user_id: str, data: ApproveIn, p: Principal = Depends(require("users.manage")),
                 db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise not_found()
    if u.id == p.id:
        raise HTTPException(400, "You cannot approve yourself.")
    if u.status != UserStatus.PENDING_APPROVAL:
        raise HTTPException(400, f"User is {u.status.replace('_', ' ')}, not awaiting approval.")
    role = _role_for_grant(db, p, data.role_id)
    dept_id = data.department_id or u.requested_department_id
    if dept_id and db.get(Department, dept_id) is None:
        raise HTTPException(400, "Unknown department")
    u.role_id = role.id
    u.department_id = dept_id
    u.status = UserStatus.ACTIVE
    u.approved_by_id = p.id
    u.approved_at = utcnow()
    notify(db, [u.id], "account", "Your account has been approved", f"You have been given the {role.name} role.", "/")
    queue_email(db, u.email, "Your SKJ account is approved",
                f"Hello {u.full_name},\n\nYour account has been approved with the role: {role.name}.\n"
                "You can now log in to the web or Android app.")
    db.commit()
    audit.record("user", "user.approved", actor=p.user, target_type="user", target_id=u.id,
                 details={"role": role.name, "department_id": dept_id})
    return user_out(u)


class RejectIn(BaseModel):
    reason: str = Field(default="", max_length=500)


@router.post("/users/{user_id}/reject")
def reject_user(user_id: str, data: RejectIn, p: Principal = Depends(require("users.manage")),
                db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise not_found()
    if u.status not in (UserStatus.PENDING_APPROVAL, UserStatus.PENDING_VERIFICATION):
        raise HTTPException(400, "Only pending accounts can be rejected.")
    u.status = UserStatus.REJECTED
    db.execute(update(AuthSession).where(AuthSession.user_id == u.id, AuthSession.revoked_at.is_(None))
               .values(revoked_at=utcnow(), revoked_reason="rejected"))
    db.commit()
    audit.record("user", "user.rejected", actor=p.user, target_type="user", target_id=u.id,
                 details={"reason": data.reason})
    return user_out(u)


class UserUpdateIn(BaseModel):
    role_id: str | None = Field(default=None, max_length=36)
    department_id: str | None = Field(default=None, max_length=36)
    full_name: str | None = Field(default=None, min_length=2, max_length=200)


@router.patch("/users/{user_id}")
def update_user(user_id: str, data: UserUpdateIn, p: Principal = Depends(require("users.manage")),
                db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise not_found()
    _target_guard(p, u)
    changes = {}
    if data.role_id is not None and data.role_id != u.role_id:
        role = _role_for_grant(db, p, data.role_id)
        changes["role"] = {"from": u.role.name if u.role else None, "to": role.name}
        u.role_id = role.id
        # New permissions take effect on next request; force re-login for a clean slate.
        db.execute(update(AuthSession).where(AuthSession.user_id == u.id, AuthSession.revoked_at.is_(None))
                   .values(revoked_at=utcnow(), revoked_reason="role_changed"))
    if data.department_id is not None:
        if data.department_id and db.get(Department, data.department_id) is None:
            raise HTTPException(400, "Unknown department")
        changes["department_id"] = data.department_id or None
        u.department_id = data.department_id or None
    if data.full_name:
        u.full_name = data.full_name.strip()
        changes["full_name"] = True
    db.commit()
    audit.record("user", "user.updated", actor=p.user, target_type="user", target_id=u.id, details=changes)
    db.refresh(u)
    return user_out(u)


@router.post("/users/{user_id}/disable")
def disable_user(user_id: str, p: Principal = Depends(require("users.manage")), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise not_found()
    _target_guard(p, u)
    u.status = UserStatus.DISABLED
    n = db.execute(update(AuthSession).where(AuthSession.user_id == u.id, AuthSession.revoked_at.is_(None))
                   .values(revoked_at=utcnow(), revoked_reason="account_disabled")).rowcount
    db.commit()
    audit.record("user", "user.disabled", actor=p.user, target_type="user", target_id=u.id,
                 details={"sessions_revoked": n})
    return user_out(u)


@router.post("/users/{user_id}/enable")
def enable_user(user_id: str, p: Principal = Depends(require("users.manage")), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise not_found()
    _target_guard(p, u)
    if u.status != UserStatus.DISABLED:
        raise HTTPException(400, "User is not disabled")
    u.status = UserStatus.ACTIVE if u.role_id else UserStatus.PENDING_APPROVAL
    u.locked_until = None
    u.failed_logins = 0
    db.commit()
    audit.record("user", "user.enabled", actor=p.user, target_type="user", target_id=u.id)
    return user_out(u)


@router.post("/users/{user_id}/unlock")
def unlock_user(user_id: str, p: Principal = Depends(require("users.manage")), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise not_found()
    u.locked_until = None
    u.failed_logins = 0
    db.commit()
    audit.record("security", "account.unlocked", actor=p.user, target_type="user", target_id=u.id)
    return user_out(u)


@router.post("/users/{user_id}/reset-mfa")
def reset_mfa(user_id: str, p: Principal = Depends(require("users.manage")), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise not_found()
    _target_guard(p, u)
    u.mfa_enabled = False
    u.mfa_secret_enc = None
    db.execute(update(AuthSession).where(AuthSession.user_id == u.id, AuthSession.revoked_at.is_(None))
               .values(revoked_at=utcnow(), revoked_reason="mfa_reset"))
    db.commit()
    audit.record("security", "mfa.reset_by_admin", actor=p.user, target_type="user", target_id=u.id)
    return user_out(u)


# ---------- sessions (admin) ----------

@router.get("/admin/sessions")
def all_sessions(p: Principal = Depends(require("sessions.manage")), db: Session = Depends(get_db)):
    rows = db.execute(
        select(AuthSession).where(AuthSession.revoked_at.is_(None)).order_by(AuthSession.last_used_at.desc()).limit(500)
    ).scalars()
    out = []
    for s in rows:
        exp = s.expires_at if s.expires_at.tzinfo else s.expires_at.replace(tzinfo=timezone.utc)
        if exp < utcnow():
            continue
        out.append({"id": s.id, "user": {"id": s.user.id, "email": s.user.email, "full_name": s.user.full_name},
                    "client_type": s.client_type, "ip": s.ip, "user_agent": s.user_agent,
                    "created_at": s.created_at, "last_used_at": s.last_used_at})
    return out


@router.delete("/admin/sessions/{session_id}")
def admin_revoke_session(session_id: str, p: Principal = Depends(require("sessions.manage")),
                         db: Session = Depends(get_db)):
    s = db.get(AuthSession, session_id)
    if s is None:
        raise not_found()
    s.revoked_at = utcnow()
    s.revoked_reason = "admin_revoked"
    db.commit()
    audit.record("security", "session.revoked_by_admin", actor=p.user, target_type="session", target_id=s.id,
                 details={"user_id": s.user_id})
    return {"detail": "Session revoked"}


@router.post("/users/{user_id}/revoke-sessions")
def revoke_user_sessions(user_id: str, p: Principal = Depends(require("sessions.manage")),
                         db: Session = Depends(get_db)):
    if db.get(User, user_id) is None:
        raise not_found()
    n = db.execute(update(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
                   .values(revoked_at=utcnow(), revoked_reason="admin_revoked_all")).rowcount
    db.commit()
    audit.record("security", "sessions.revoked_all", actor=p.user, target_type="user", target_id=user_id,
                 details={"count": n})
    return {"revoked": n}


# ---------- roles ----------

def role_out(r: Role, counts: dict[str, int] | None = None) -> dict:
    return {"id": r.id, "name": r.name, "description": r.description, "is_system": r.is_system,
            "permissions": r.permissions, "user_count": (counts or {}).get(r.id, 0)}


@router.get("/roles")
def list_roles(p: Principal = Depends(require("users.view", "roles.manage", any_of=True)),
               db: Session = Depends(get_db)):
    counts = dict(db.execute(select(User.role_id, func.count()).group_by(User.role_id)).all())
    return [role_out(r, counts) for r in db.execute(select(Role).order_by(Role.name)).scalars()]


@router.get("/roles/permissions")
def permission_catalogue(p: Principal = Depends(require("users.view", "roles.manage", any_of=True))):
    return [{"key": k, "description": v, "requires_mfa": k in P.MFA_REQUIRED} for k, v in P.PERMISSIONS.items()]


class RoleIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    description: str = Field(default="", max_length=500)
    permissions: list[str] = Field(default_factory=list, max_length=100)


def _validate_perms(p: Principal, perms: list[str]) -> list[str]:
    unknown = [x for x in perms if x not in P.PERMISSIONS]
    if unknown:
        raise HTTPException(400, f"Unknown permissions: {', '.join(unknown[:5])}")
    if not P.can_grant(p.perms, perms):
        audit.record("security", "privilege_escalation.blocked", actor=p.user, outcome="denied",
                     details={"permissions": perms})
        raise HTTPException(403, "You cannot grant permissions you do not have.")
    return sorted(set(perms))


@router.post("/roles", status_code=201)
def create_role(data: RoleIn, p: Principal = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    if db.execute(select(Role).where(func.lower(Role.name) == data.name.lower())).scalar_one_or_none():
        raise HTTPException(400, "A role with this name already exists")
    role = Role(name=data.name.strip(), description=data.description, permissions=_validate_perms(p, data.permissions))
    db.add(role)
    db.commit()
    audit.record("role", "role.created", actor=p.user, target_type="role", target_id=role.id,
                 details={"name": role.name, "permissions": role.permissions})
    return role_out(role)


@router.patch("/roles/{role_id}")
def update_role(role_id: str, data: RoleIn, p: Principal = Depends(require("roles.manage")),
                db: Session = Depends(get_db)):
    role = db.get(Role, role_id)
    if role is None:
        raise not_found()
    if "*" in role.permissions:
        raise HTTPException(400, "The Super Administrator role cannot be edited.")
    if not P.can_grant(p.perms, role.permissions):
        raise HTTPException(403, "You cannot edit a role with permissions you do not have.")
    before = list(role.permissions)
    role.permissions = _validate_perms(p, data.permissions)
    role.description = data.description
    if not role.is_system:
        role.name = data.name.strip()
    # Sessions of users with this role are revoked so new permissions apply immediately.
    user_ids = select(User.id).where(User.role_id == role.id).scalar_subquery()
    db.execute(update(AuthSession).where(AuthSession.user_id.in_(user_ids), AuthSession.revoked_at.is_(None))
               .values(revoked_at=utcnow(), revoked_reason="role_changed"))
    db.commit()
    audit.record("role", "role.updated", actor=p.user, target_type="role", target_id=role.id,
                 details={"before": before, "after": role.permissions})
    return role_out(role)


@router.delete("/roles/{role_id}")
def delete_role(role_id: str, p: Principal = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    role = db.get(Role, role_id)
    if role is None:
        raise not_found()
    if role.is_system:
        raise HTTPException(400, "Built-in roles cannot be deleted.")
    in_use = db.execute(select(func.count()).select_from(User).where(User.role_id == role.id)).scalar()
    if in_use:
        raise HTTPException(400, f"Role is assigned to {in_use} user(s). Reassign them first.")
    db.delete(role)
    db.commit()
    audit.record("role", "role.deleted", actor=p.user, target_type="role", target_id=role_id,
                 details={"name": role.name})
    return {"detail": "Role deleted"}


# ---------- departments ----------

class DepartmentIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)


@router.post("/departments", status_code=201)
def create_department(data: DepartmentIn, p: Principal = Depends(require("users.manage")),
                      db: Session = Depends(get_db)):
    if db.execute(select(Department).where(func.lower(Department.name) == data.name.lower())).scalar_one_or_none():
        raise HTTPException(400, "Department exists")
    d = Department(name=data.name.strip())
    db.add(d)
    db.commit()
    audit.record("admin", "department.created", actor=p.user, target_type="department", target_id=d.id,
                 details={"name": d.name})
    return {"id": d.id, "name": d.name}
