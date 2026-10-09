# AlbumPro — Album Operations CRM

Admin UI for an album design & printing company (SRS: `docs/SRS-v1.0.pdf`, mockups: `docs/design/admin/`).

Stack: Vite + React 19 + TypeScript + Tailwind v4 + react-router + recharts.

```bash
npm install
npm run dev     # http://localhost:5173
npm run build
```

## Status
Admin UI is complete as a clickable front-end running on **mock data** (`src/lib/data.ts` and per-page data). Screens: Dashboard, Orders, Customers, Production Pipeline, Colour Grading, Album Designing, Printing, Quality Control, Delivery, Payments, Invoices, Reports, Masters, Users & Roles, Settings.

Not built yet: authentication/MFA (SRS §2), backend/API + database, file storage, WhatsApp/email notifications, audit log persistence, and the non-admin role dashboards (Reception, Colour Grading, Designing, Printing, QC, Accounts).
