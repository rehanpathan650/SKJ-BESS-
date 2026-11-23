import { lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { useAuth } from "./lib/auth";
import { ForgotPage, LoginPage, ResetPage, SignupPage, VerifyEmailPage } from "./pages/auth/AuthPages";
import { MfaSetupPage, PendingPage } from "./pages/auth/Gates";

// Each page is its own download: the first load only fetches the shell and the page you open.
const RolesPage = lazy(() => import("./pages/admin/Roles").then((m) => ({ default: m.RolesPage })));
const PricingPage = lazy(() => import("./pages/admin/Pricing").then((m) => ({ default: m.PricingPage })));
const UsersPage = lazy(() => import("./pages/admin/Users").then((m) => ({ default: m.UsersPage })));
const BillReviewPage = lazy(() => import("./pages/BillReview").then((m) => ({ default: m.BillReviewPage })));
const CalculatorPage = lazy(() => import("./pages/Calculator").then((m) => ({ default: m.CalculatorPage })));
const CustomerDetailPage = lazy(() => import("./pages/CustomerDetail").then((m) => ({ default: m.CustomerDetailPage })));
const CustomersPage = lazy(() => import("./pages/Customers").then((m) => ({ default: m.CustomersPage })));
const DashboardPage = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const NotificationsPage = lazy(() => import("./pages/Notifications").then((m) => ({ default: m.NotificationsPage })));
const ProfilePage = lazy(() => import("./pages/Profile").then((m) => ({ default: m.ProfilePage })));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetail").then((m) => ({ default: m.ProjectDetailPage })));
const ProjectsPage = lazy(() => import("./pages/Projects").then((m) => ({ default: m.ProjectsPage })));
const ProposalDetailPage = lazy(() => import("./pages/ProposalDetail").then((m) => ({ default: m.ProposalDetailPage })));
const ProposalsPage = lazy(() => import("./pages/Proposals").then((m) => ({ default: m.ProposalsPage })));
const NewQuotationPage = lazy(() => import("./pages/NewQuotation").then((m) => ({ default: m.NewQuotationPage })));
const SecurityPage = lazy(() => import("./pages/Security").then((m) => ({ default: m.SecurityPage })));

const PUBLIC = ["/login", "/signup", "/verify-email", "/forgot-password", "/reset-password"];

export function App() {
  const { me, loading } = useAuth();
  const loc = useLocation();

  if (loading) return <Loading what="Starting" />;

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPage />} />
        <Route path="/reset-password" element={<ResetPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: loc.pathname }} />} />
      </Routes>
    );
  }
  if (me.status !== "active") return <PendingPage />;
  if (me.mfa_required && !me.mfa_enabled) return <MfaSetupPage forced />;
  if (PUBLIC.includes(loc.pathname)) return <Navigate to="/" replace />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="bills/:id" element={<BillReviewPage />} />
        <Route path="calculator" element={<CalculatorPage />} />
        <Route path="quotations/new" element={<NewQuotationPage />} />
        <Route path="proposals" element={<ProposalsPage />} />
        <Route path="proposals/:id" element={<ProposalDetailPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="admin/users" element={<UsersPage />} />
        <Route path="admin/roles" element={<RolesPage />} />
        <Route path="admin/pricing" element={<PricingPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
