// Pricing masters (SRS §3.1 / §3.2). Replace with API-backed masters later.
export const ALBUM_TYPES: Record<string, number> = { "Premium Album": 8500, "Classic Album": 6200, "Magnetic Album": 10500, "Acrylic Album": 12000, "Photobook": 3800, "Layflat Album": 9500, "Coffee Table": 14000 };
export const SIZES = ["8x12", "10x30", "12x18", "12x30", "12x36", "14x40", "Custom"];
export const PAPER: Record<string, { gsm: number[]; perSheet: number }> = { Silk: { gsm: [250, 300], perSheet: 55 }, Metallic: { gsm: [250, 300], perSheet: 95 }, Matte: { gsm: [250, 300], perSheet: 60 }, Glossy: { gsm: [250], perSheet: 58 }, Velvet: { gsm: [300], perSheet: 90 }, "Fine Art": { gsm: [300, 350], perSheet: 110 } };
export const COVERS: Record<string, number> = { Leatherette: 0, Acrylic: 1500, "Photo Wrap": 500, Fabric: 800, Custom: 1200 };
export const LAMINATION: Record<string, number> = { None: 0, Matte: 300, Gloss: 300, Texture: 450 };
export const BINDING = ["Lay-flat", "Flush mount", "Standard", "Custom"];
export const BOXES: Record<string, number> = { None: 0, Standard: 400, Premium: 900, Wooden: 1800, Acrylic: 1500, Custom: 1500 };
export const EVENT_TYPES = ["Wedding", "Pre Wedding", "Reception", "Engagement", "Baby", "Corporate", "Birthday", "Other"];
export const FINISHES: Record<string, number> = { "UV Printing": 600, Foiling: 800, Embossing: 700 };
export const DESIGN_CHARGE = 4000;       // applies when order type includes design (ALB-FR-0033)
export const GRADING_PER_IMAGE = 4;      // colour grading, per image (ALB-FR-0034)
export const GST_RATE = 0.18;            // ALB-FR-0037
export const DISCOUNT_APPROVAL_PCT = 10; // discounts above this need admin approval (ALB-FR-0036)

export interface Spec { albumType: string; paper: string; sheets: number; copies: number; cover: string; lamination: string; box: string; finishes: string[]; designed: boolean; images: number; discountPct: number }
export function price(s: Spec) {
  const base = (ALBUM_TYPES[s.albumType] ?? 0) * s.copies;
  const sheets = (PAPER[s.paper]?.perSheet ?? 0) * s.sheets * s.copies;
  const addons = ((COVERS[s.cover] ?? 0) + (LAMINATION[s.lamination] ?? 0) + (BOXES[s.box] ?? 0) + s.finishes.reduce((a, f) => a + (FINISHES[f] ?? 0), 0)) * s.copies;
  const design = s.designed ? DESIGN_CHARGE : 0;
  const grading = s.designed ? s.images * GRADING_PER_IMAGE : 0;
  const sub = base + sheets + addons + design + grading;
  const discount = Math.round((sub * s.discountPct) / 100);
  const taxable = sub - discount;
  const gst = Math.round(taxable * GST_RATE);
  return { base, sheets, addons, design, grading, sub, discount, taxable, gst, total: taxable + gst };
}
