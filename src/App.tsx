import { Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import Customers from "./pages/Customers";
import Pipeline from "./pages/Pipeline";
import ColourGrading from "./pages/ColourGrading";
import Designing from "./pages/Designing";
import Printing from "./pages/Printing";
import QualityControl from "./pages/QualityControl";
import Delivery from "./pages/Delivery";
import Payments from "./pages/Payments";
import Invoices from "./pages/Invoices";
import Reports from "./pages/Reports";
import Masters from "./pages/Masters";
import UsersRoles from "./pages/UsersRoles";
import SettingsPage from "./pages/Settings";
import Login from "./pages/Login";
import RoleHome from "./pages/RoleHome";
import OrderDetail from "./pages/OrderDetail";
import Notifications from "./pages/Notifications";
import { AuthProvider, RequireAuth, useAuth } from "./lib/auth";

function Home() {
  const { role } = useAuth();
  return role === "admin" ? <Dashboard /> : <RoleHome />;
}

export default function App() {
  return (
    <AuthProvider>
    <Routes>
      <Route path="login" element={<Login />} />
      <Route element={<RequireAuth><Shell /></RequireAuth>}>
        <Route index element={<Home />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="orders" element={<Orders />} />
        <Route path="customers" element={<Customers />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="colour-grading" element={<ColourGrading />} />
        <Route path="designing" element={<Designing />} />
        <Route path="designing/:orderId" element={<Designing />} />
        <Route path="printing" element={<Printing />} />
        <Route path="qc" element={<QualityControl />} />
        <Route path="delivery" element={<Delivery />} />
        <Route path="payments" element={<Payments />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="reports" element={<Reports />} />
        <Route path="masters" element={<Masters />} />
        <Route path="users" element={<UsersRoles />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<div className="p-10 text-sub">Page not found</div>} />
      </Route>
    </Routes>
    </AuthProvider>
  );
}
