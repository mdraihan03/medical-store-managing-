export type UserRole = 'Admin' | 'Pharmacist' | 'Store Staff';

export interface UserSession {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  license_no: string;
}

export interface Supplier {
  id: number;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  gstin: string;
  city: string;
  lead_time_days: number;
}

export interface Medicine {
  id: number;
  brand_name: string;
  generic_name: string;
  strength: string;
  dosage_form: string;
  category: string;
  hsn_code: string;
  gst_rate: number;
  reorder_level: number;
  target_stock: number;
  preferred_supplier_id: number;
  preferred_supplier_name?: string;
  preferred_supplier_phone?: string;
  preferred_supplier_email?: string;
  rack_location: string;
  requires_rx: number;
  total_active_stock: number;
  total_expired_stock: number;
  active_batch_count: number;
  earliest_expiry: string | null;
  avg_mrp: number;
  avg_cost: number;
}

export interface Batch {
  id: number;
  medicine_id: number;
  brand_name: string;
  generic_name: string;
  strength: string;
  category: string;
  gst_rate: number;
  hsn_code: string;
  batch_no: string;
  mfg_date: string;
  expiry_date: string;
  qty_available: number;
  cost_price: number;
  mrp: number;
  rack_location: string;
  status: 'active' | 'quarantined';
  days_to_expiry: number;
  risk_tier: 'expired' | 'critical' | 'amber' | 'green' | 'safe';
  cost_value_at_risk: number;
}

export interface DrugInteractionAlert {
  id: number;
  generic_a: string;
  generic_b: string;
  medicine_a: string;
  medicine_b: string;
  severity: 'Mild' | 'Moderate' | 'Severe';
  clinical_effect: string;
  recommendation: string;
}

export interface FefoAllocation {
  batch_id: number;
  batch_no: string;
  expiry_date: string;
  days_to_expiry: number;
  qty_allocated: number;
  mrp: number;
  cost_price: number;
}

export interface BrandSwapOption {
  medicine_id: number;
  brand_name: string;
  generic_name: string;
  strength: string;
  total_active_stock: number;
  earliest_expiry: string | null;
  mrp: number;
  gst_rate: number;
}

export interface BillingLinePreview {
  medicine_id: number;
  brand_name: string;
  generic_name: string;
  strength: string;
  hsn_code: string;
  gst_rate: number;
  requested_qty: number;
  available_qty: number;
  shortfall_qty: number;
  expired_blocked_qty: number;
  allocations: FefoAllocation[];
  line_subtotal: number;
  cgst_amount: number;
  sgst_amount: number;
  line_total: number;
  brand_swaps: BrandSwapOption[];
}

export interface BillingPreviewResponse {
  lines: BillingLinePreview[];
  interactions: DrugInteractionAlert[];
  subtotal: number;
  cgst_total: number;
  sgst_total: number;
  grand_total: number;
  has_shortfall: boolean;
  has_severe_interaction: boolean;
}

export interface ReorderItem {
  medicine_id: number;
  brand_name: string;
  generic_name: string;
  strength: string;
  category: string;
  current_stock: number;
  reorder_level: number;
  target_stock: number;
  suggested_order_qty: number;
  est_unit_cost: number;
  est_order_cost: number;
  supplier_id: number;
  supplier_name: string;
  supplier_phone: string;
  supplier_email: string;
  lead_time_days: number;
}

export interface DashboardPayload {
  kpis: {
    total_stock_value: number;
    total_mrp_value: number;
    at_risk_90d_value: number;
    at_risk_90d_units: number;
    expired_quarantined_value: number;
    reorder_count: number;
    today_revenue: number;
    today_invoices: number;
    pending_rx_count: number;
  };
  expiry_shelf: Batch[];
  expiry_summary: {
    critical_value: number;
    critical_batches: number;
    amber_value: number;
    amber_batches: number;
    green_value: number;
    green_batches: number;
  };
  stock_value_trends: Array<{
    date: string;
    label: string;
    stock_value: number;
    daily_sales: number;
  }>;
  fast_moving_items: Array<{
    medicine_id: number;
    brand_name: string;
    generic_name: string;
    strength: string;
    units_sold: number;
    revenue: number;
    current_stock: number;
  }>;
  reorder_list: ReorderItem[];
}

export interface EmrPrescriptionItem {
  id: number;
  medicine_id: number;
  brand_name: string;
  generic_name: string;
  strength: string;
  dosage_instruction: string;
  prescribed_qty: number;
  available_stock: number;
  brand_swaps: BrandSwapOption[];
}

export interface EmrPrescription {
  id: number;
  rx_code: string;
  patient_name: string;
  patient_age: number;
  patient_gender: string;
  patient_phone: string;
  allergies: string;
  doctor_name: string;
  department: string;
  emr_notes: string;
  status: 'Pending' | 'Reviewed' | 'Dispensed';
  created_at: string;
  items: EmrPrescriptionItem[];
  interactions: DrugInteractionAlert[];
}

export interface InvoiceItemRecord {
  id: number;
  medicine_id: number;
  brand_name: string;
  generic_name: string;
  hsn_code: string;
  batch_id: number;
  batch_no: string;
  expiry_date: string;
  qty: number;
  mrp: number;
  gst_rate: number;
  cgst_amount: number;
  sgst_amount: number;
  line_total: number;
}

export interface InvoiceRecord {
  id: number;
  invoice_no: string;
  customer_name: string;
  customer_phone: string;
  rx_id: number | null;
  rx_code: string | null;
  payment_method: 'Cash' | 'UPI' | 'Card' | 'Insurance';
  payment_ref: string;
  subtotal: number;
  cgst_total: number;
  sgst_total: number;
  grand_total: number;
  interaction_ack_by: string | null;
  created_by: string;
  created_at: string;
  items: InvoiceItemRecord[];
}

export interface ReturnRecord {
  id: number;
  return_type: 'Customer Return' | 'Damaged Stock' | 'Expired Write-Off';
  invoice_no: string | null;
  medicine_id: number;
  brand_name: string;
  batch_id: number;
  batch_no: string;
  qty: number;
  amount: number;
  reason: string;
  restocked: number;
  processed_by: string;
  created_at: string;
}

export interface PurchaseOrderItem {
  id: number;
  medicine_id: number;
  brand_name: string;
  generic_name: string;
  qty_ordered: number;
  unit_cost: number;
  line_total: number;
}

export interface PurchaseOrder {
  id: number;
  po_number: string;
  supplier_id: number;
  supplier_name: string;
  supplier_email: string;
  supplier_phone: string;
  status: 'Draft' | 'Sent' | 'Received';
  total_amount: number;
  notes: string;
  emailed_at: string | null;
  created_by: string;
  created_at: string;
  items: PurchaseOrderItem[];
}

export interface GrnRecord {
  id: number;
  grn_number: string;
  po_id: number | null;
  po_number: string | null;
  supplier_id: number;
  supplier_name: string;
  invoice_ref: string;
  total_cost: number;
  received_by: string;
  created_at: string;
}

export interface AuditLog {
  id: number;
  actor_name: string;
  actor_role: string;
  action_type: string;
  entity: string;
  details: string;
  created_at: string;
}
