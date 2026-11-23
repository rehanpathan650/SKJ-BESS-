# Roles and permissions

All rules are enforced by the API. Admins can edit built-in roles (except Super Administrator) and create custom
roles in **Roles & permissions**. Nobody can grant a permission they don't hold themselves.

| Role | Sees customers | Can do | Confidential pricing | MFA |
|---|---|---|---|---|
| Super Administrator | All | Everything | Yes | Required |
| IT/Security Administrator | **None** | Approve users, roles, sessions, audit, security dashboard, settings | No | Required |
| Management | All | Assign customers, edit projects, approve proposals, reports, audit | Yes | Optional |
| BESS Engineer | Assigned + projects they engineer | Upload/review bills, calculator, **validate configurations** | No | Optional |
| Sales Executive | Assigned/own | Create customers & projects, bills, calculator, generate & share proposals | No | Optional |
| Finance/Commercial Team | All | Approve proposals, edit pricing & assumptions, reports | Yes | Required |
| Read-only User | Assigned | View customers and proposals | No | Optional |

Department visibility: give a custom role `customers.view_department` to see every customer in the user's department.

Workflow guards: an engineer cannot validate their own configuration; a proposal's author cannot approve it;
only approved proposals can be shared; drafts are watermarked.
