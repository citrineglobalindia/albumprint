import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AuthProvider, RequireAuth, useAuth } from "./lib/auth";

// Route-level code splitting: only the shell + the page being visited are downloaded. Login and the public proof page stay tiny.
const Shell = lazy(() => import("./components/Shell"));
const NewOrderProvider = lazy(() => import("./components/NewOrderWizard").then((m) => ({ default: m.NewOrderProvider })));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Orders = lazy(() => import("./pages/Orders"));
const Customers = lazy(() => import("./pages/Customers"));
const Pipeline = lazy(() => import("./pages/Pipeline"));
const ColourGrading = lazy(() => import("./pages/ColourGrading"));
const Designing = lazy(() => import("./pages/Designing"));
const Printing = lazy(() => import("./pages/Printing"));
const QualityControl = lazy(() => import("./pages/QualityControl"));
const Delivery = lazy(() => import("./pages/Delivery"));
const Payments = lazy(() => import("./pages/Payments"));
const Invoices = lazy(() => import("./pages/Invoices"));
const Reports = lazy(() => import("./pages/Reports"));
const Masters = lazy(() => import("./pages/Masters"));
const UsersRoles = lazy(() => import("./pages/UsersRoles"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const Login = lazy(() => import("./pages/Login"));
const RoleHome = lazy(() => import("./pages/RoleHome"));
const OrderDetail = lazy(() => import("./pages/OrderDetail"));
const Notifications = lazy(() => import("./pages/Notifications"));
const ControlCenter = lazy(() => import("./pages/ControlCenter"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const FilesPage = lazy(() => import("./pages/FilesPage"));
const ProofPortal = lazy(() => import("./pages/ProofPortal"));

function PageSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading page" data-testid="page-skeleton" className="animate-pulse space-y-4 p-1">
      <div className="h-8 w-56 rounded-lg bg-slate-200/70" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl bg-slate-200/70" />)}</div>
      <div className="h-72 rounded-2xl bg-slate-200/70" />
    </div>
  );
}
const FullSkeleton = () => <div className="p-4 sm:p-7"><PageSkeleton /></div>;
const page = (el: React.ReactNode) => <Suspense fallback={<PageSkeleton />}>{el}</Suspense>;

function Home() {
  const { role } = useAuth();
  return page(role === "admin" ? <Dashboard /> : <RoleHome />);
}

function Protected() {
  return (
    <RequireAuth>
      <Suspense fallback={<FullSkeleton />}>
        <NewOrderProvider><Shell /></NewOrderProvider>
      </Suspense>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<FullSkeleton />}>
        <Routes>
          <Route path="login" element={<Login />} />
          <Route path="proof/:token" element={<ProofPortal />} />
          <Route element={<Protected />}>
            <Route index element={<Home />} />
            <Route path="orders/:id" element={page(<OrderDetail />)} />
            <Route path="notifications" element={page(<Notifications />)} />
            <Route path="control" element={page(<ControlCenter />)} />
            <Route path="audit" element={page(<AuditLog />)} />
            <Route path="files" element={page(<FilesPage />)} />
            <Route path="orders" element={page(<Orders />)} />
            <Route path="customers" element={page(<Customers />)} />
            <Route path="pipeline" element={page(<Pipeline />)} />
            <Route path="colour-grading" element={page(<ColourGrading />)} />
            <Route path="designing" element={page(<Designing />)} />
            <Route path="designing/:orderId" element={page(<Designing />)} />
            <Route path="printing" element={page(<Printing />)} />
            <Route path="qc" element={page(<QualityControl />)} />
            <Route path="delivery" element={page(<Delivery />)} />
            <Route path="payments" element={page(<Payments />)} />
            <Route path="invoices" element={page(<Invoices />)} />
            <Route path="reports" element={page(<Reports />)} />
            <Route path="masters" element={page(<Masters />)} />
            <Route path="users" element={page(<UsersRoles />)} />
            <Route path="settings" element={page(<SettingsPage />)} />
            <Route path="*" element={<div className="p-10 text-sub">Page not found</div>} />
          </Route>
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
