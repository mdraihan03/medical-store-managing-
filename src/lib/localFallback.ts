import type {
  AuditLog,
  Batch,
  BillingLinePreview,
  BillingPreviewResponse,
  BrandSwapOption,
  DashboardPayload,
  DrugInteractionAlert,
  EmrPrescription,
  FefoAllocation,
  GrnRecord,
  InvoiceRecord,
  Medicine,
  PurchaseOrder,
  ReorderItem,
  ReturnRecord,
  Supplier,
  UserRole,
  UserSession,
} from '../types';

const STORAGE_KEY = 'medoryx_edge_store_v1';

interface LocalDbState {
  suppliers: Supplier[];
  medicinesMeta: Array<{
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
    rack_location: string;
    requires_rx: number;
  }>;
  batchesRaw: Array<{
    id: number;
    medicine_id: number;
    batch_no: string;
    mfg_date: string;
    expiry_date: string;
    qty_available: number;
    cost_price: number;
    mrp: number;
    rack_location: string;
    status: 'active' | 'quarantined';
  }>;
  interactions: Array<{
    id: number;
    generic_a: string;
    generic_b: string;
    severity: 'Mild' | 'Moderate' | 'Severe';
    clinical_effect: string;
    recommendation: string;
  }>;
  prescriptionsRaw: Array<{
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
    items: Array<{
      id: number;
      medicine_id: number;
      dosage_instruction: string;
      prescribed_qty: number;
    }>;
  }>;
  invoices: InvoiceRecord[];
  returns: ReturnRecord[];
  purchaseOrders: PurchaseOrder[];
  grnRecords: GrnRecord[];
  auditLogs: AuditLog[];
}

function addDaysIso(offsetDays: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function addDaysTs(offsetDays: number, h = 10, m = 30): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(h, m, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function diffDays(targetIso: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(`${targetIso}T00:00:00`);
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function computeRiskTier(days: number, status: string): 'expired' | 'critical' | 'amber' | 'green' | 'safe' {
  if (days <= 0 || status === 'quarantined') return 'expired';
  if (days <= 30) return 'critical';
  if (days <= 60) return 'amber';
  if (days <= 90) return 'green';
  return 'safe';
}

function createSeedState(): LocalDbState {
  const suppliers: Supplier[] = [
    { id: 1, name: 'Cipla MedLife Distributors', contact_person: 'Sandeep Deshpande', phone: '+91 98204 11230', email: 'orders@ciplamedlife.in', gstin: '27AABCC1234D1Z5', city: 'Mumbai', lead_time_days: 2 },
    { id: 2, name: 'Sun Pharma Wholesale Depot', contact_person: 'Neha Parekh', phone: '+91 98981 44512', email: 'supply@sunwholesale.in', gstin: '24AADCS5678E1Z2', city: 'Ahmedabad', lead_time_days: 3 },
    { id: 3, name: 'Apollo HealthCare Logistics', contact_person: 'Karthik Subramanian', phone: '+91 99002 77341', email: 'procurement@apollologistics.in', gstin: '29AABCA9012F1Z8', city: 'Bengaluru', lead_time_days: 1 },
    { id: 4, name: "Dr. Reddy's Regional Stockist", contact_person: 'Anjali Verma', phone: '+91 98490 66219', email: 'dispatch@drreddysstock.in', gstin: '36AABCD3456G1Z9', city: 'Hyderabad', lead_time_days: 2 },
  ];

  const medicinesMeta = [
    { id: 1, brand_name: 'Warf-5', generic_name: 'Warfarin Sodium', strength: '5 mg', dosage_form: 'Tablet', category: 'Anticoagulant', hsn_code: '30049099', gst_rate: 12, reorder_level: 40, target_stock: 120, preferred_supplier_id: 1, rack_location: 'A-01', requires_rx: 1 },
    { id: 2, brand_name: 'Ecosprin-75', generic_name: 'Aspirin', strength: '75 mg', dosage_form: 'Tablet', category: 'Antiplatelet', hsn_code: '30049099', gst_rate: 5, reorder_level: 80, target_stock: 240, preferred_supplier_id: 2, rack_location: 'A-02', requires_rx: 0 },
    { id: 3, brand_name: 'Loprin-75', generic_name: 'Aspirin', strength: '75 mg', dosage_form: 'Tablet', category: 'Antiplatelet', hsn_code: '30049099', gst_rate: 5, reorder_level: 60, target_stock: 180, preferred_supplier_id: 3, rack_location: 'A-02', requires_rx: 0 },
    { id: 4, brand_name: 'Augmentin 625 Duo', generic_name: 'Amoxicillin + Clavulanic Acid', strength: '625 mg', dosage_form: 'Tablet', category: 'Antibiotic', hsn_code: '30041020', gst_rate: 12, reorder_level: 50, target_stock: 160, preferred_supplier_id: 1, rack_location: 'B-04', requires_rx: 1 },
    { id: 5, brand_name: 'Moxikind-CV 625', generic_name: 'Amoxicillin + Clavulanic Acid', strength: '625 mg', dosage_form: 'Tablet', category: 'Antibiotic', hsn_code: '30041020', gst_rate: 12, reorder_level: 45, target_stock: 140, preferred_supplier_id: 1, rack_location: 'B-04', requires_rx: 1 },
    { id: 6, brand_name: 'Clavam 625', generic_name: 'Amoxicillin + Clavulanic Acid', strength: '625 mg', dosage_form: 'Tablet', category: 'Antibiotic', hsn_code: '30041020', gst_rate: 12, reorder_level: 40, target_stock: 140, preferred_supplier_id: 3, rack_location: 'B-05', requires_rx: 1 },
    { id: 7, brand_name: 'Dolo 650', generic_name: 'Paracetamol', strength: '650 mg', dosage_form: 'Tablet', category: 'Analgesic', hsn_code: '30049011', gst_rate: 12, reorder_level: 120, target_stock: 360, preferred_supplier_id: 3, rack_location: 'C-01', requires_rx: 0 },
    { id: 8, brand_name: 'Calpol 650', generic_name: 'Paracetamol', strength: '650 mg', dosage_form: 'Tablet', category: 'Analgesic', hsn_code: '30049011', gst_rate: 12, reorder_level: 100, target_stock: 300, preferred_supplier_id: 4, rack_location: 'C-01', requires_rx: 0 },
    { id: 9, brand_name: 'Glycomet-GP 1', generic_name: 'Metformin + Glimepiride', strength: '500mg/1mg', dosage_form: 'Tablet', category: 'Antidiabetic', hsn_code: '30049099', gst_rate: 5, reorder_level: 90, target_stock: 240, preferred_supplier_id: 2, rack_location: 'D-02', requires_rx: 1 },
    { id: 10, brand_name: 'Ciplox 500', generic_name: 'Ciprofloxacin', strength: '500 mg', dosage_form: 'Tablet', category: 'Antibiotic', hsn_code: '30042019', gst_rate: 12, reorder_level: 40, target_stock: 120, preferred_supplier_id: 1, rack_location: 'B-07', requires_rx: 1 },
    { id: 11, brand_name: 'Atorva 20', generic_name: 'Atorvastatin', strength: '20 mg', dosage_form: 'Tablet', category: 'Cardiovascular', hsn_code: '30049099', gst_rate: 12, reorder_level: 60, target_stock: 180, preferred_supplier_id: 4, rack_location: 'A-06', requires_rx: 1 },
    { id: 12, brand_name: 'Tonact 20', generic_name: 'Atorvastatin', strength: '20 mg', dosage_form: 'Tablet', category: 'Cardiovascular', hsn_code: '30049099', gst_rate: 12, reorder_level: 50, target_stock: 150, preferred_supplier_id: 2, rack_location: 'A-06', requires_rx: 1 },
    { id: 13, brand_name: 'Azithral 500', generic_name: 'Azithromycin', strength: '500 mg', dosage_form: 'Tablet', category: 'Antibiotic', hsn_code: '30042031', gst_rate: 12, reorder_level: 45, target_stock: 150, preferred_supplier_id: 1, rack_location: 'B-09', requires_rx: 1 },
    { id: 14, brand_name: 'Pan-D', generic_name: 'Pantoprazole + Domperidone', strength: '40mg/30mg', dosage_form: 'Capsule', category: 'Gastrointestinal', hsn_code: '30049099', gst_rate: 12, reorder_level: 100, target_stock: 300, preferred_supplier_id: 4, rack_location: 'C-05', requires_rx: 0 },
    { id: 15, brand_name: 'Pantocid-D SR', generic_name: 'Pantoprazole + Domperidone', strength: '40mg/30mg', dosage_form: 'Capsule', category: 'Gastrointestinal', hsn_code: '30049099', gst_rate: 12, reorder_level: 60, target_stock: 180, preferred_supplier_id: 2, rack_location: 'C-05', requires_rx: 0 },
    { id: 16, brand_name: 'Brufen 400', generic_name: 'Ibuprofen', strength: '400 mg', dosage_form: 'Tablet', category: 'NSAID', hsn_code: '30049061', gst_rate: 12, reorder_level: 60, target_stock: 180, preferred_supplier_id: 3, rack_location: 'C-08', requires_rx: 0 },
    { id: 17, brand_name: 'Lantus SoloStar', generic_name: 'Insulin Glargine', strength: '100 IU/mL', dosage_form: 'Pen Injector', category: 'Biologic / Cold Chain', hsn_code: '30043110', gst_rate: 5, reorder_level: 15, target_stock: 40, preferred_supplier_id: 3, rack_location: 'FRIDGE-1', requires_rx: 1 },
    { id: 18, brand_name: 'Becosules-Z', generic_name: 'B-Complex + Zinc', strength: 'Capsules', dosage_form: 'Capsule', category: 'Nutraceutical', hsn_code: '30045020', gst_rate: 18, reorder_level: 70, target_stock: 220, preferred_supplier_id: 4, rack_location: 'E-01', requires_rx: 0 },
  ];

  const batchesRaw: LocalDbState['batchesRaw'] = [
    { id: 1, medicine_id: 1, batch_no: 'WRF-2601', mfg_date: addDaysIso(-346), expiry_date: addDaysIso(19), qty_available: 28, cost_price: 3.8, mrp: 6.2, rack_location: 'A-01', status: 'active' },
    { id: 2, medicine_id: 1, batch_no: 'WRF-2614', mfg_date: addDaysIso(-90), expiry_date: addDaysIso(320), qty_available: 65, cost_price: 3.95, mrp: 6.4, rack_location: 'A-01', status: 'active' },
    { id: 3, medicine_id: 2, batch_no: 'ECO-4410', mfg_date: addDaysIso(-320), expiry_date: addDaysIso(44), qty_available: 120, cost_price: 0.45, mrp: 0.85, rack_location: 'A-02', status: 'active' },
    { id: 4, medicine_id: 2, batch_no: 'ECO-4502', mfg_date: addDaysIso(-60), expiry_date: addDaysIso(280), qty_available: 210, cost_price: 0.48, mrp: 0.85, rack_location: 'A-02', status: 'active' },
    { id: 5, medicine_id: 5, batch_no: 'MXK-8821', mfg_date: addDaysIso(-340), expiry_date: addDaysIso(25), qty_available: 36, cost_price: 14.5, mrp: 22.8, rack_location: 'B-04', status: 'active' },
    { id: 6, medicine_id: 5, batch_no: 'MXK-9014', mfg_date: addDaysIso(-80), expiry_date: addDaysIso(240), qty_available: 74, cost_price: 15.1, mrp: 23.0, rack_location: 'B-04', status: 'active' },
    { id: 7, medicine_id: 6, batch_no: 'CLV-3319', mfg_date: addDaysIso(-285), expiry_date: addDaysIso(78), qty_available: 75, cost_price: 16.0, mrp: 24.5, rack_location: 'B-05', status: 'active' },
    { id: 8, medicine_id: 7, batch_no: 'DOL-7712', mfg_date: addDaysIso(-310), expiry_date: addDaysIso(52), qty_available: 85, cost_price: 1.45, mrp: 2.25, rack_location: 'C-01', status: 'active' },
    { id: 9, medicine_id: 8, batch_no: 'CPL-5022', mfg_date: addDaysIso(-120), expiry_date: addDaysIso(365), qty_available: 240, cost_price: 1.4, mrp: 2.2, rack_location: 'C-01', status: 'active' },
    { id: 10, medicine_id: 9, batch_no: 'GLY-1009', mfg_date: addDaysIso(-500), expiry_date: addDaysIso(-14), qty_available: 24, cost_price: 9.2, mrp: 14.8, rack_location: 'D-02', status: 'quarantined' },
    { id: 11, medicine_id: 9, batch_no: 'GLY-2188', mfg_date: addDaysIso(-180), expiry_date: addDaysIso(195), qty_available: 32, cost_price: 9.5, mrp: 15.0, rack_location: 'D-02', status: 'active' },
    { id: 12, medicine_id: 10, batch_no: 'CPX-6102', mfg_date: addDaysIso(-295), expiry_date: addDaysIso(68), qty_available: 90, cost_price: 4.1, mrp: 6.8, rack_location: 'B-07', status: 'active' },
    { id: 13, medicine_id: 12, batch_no: 'TON-3091', mfg_date: addDaysIso(-325), expiry_date: addDaysIso(39), qty_available: 42, cost_price: 8.9, mrp: 14.2, rack_location: 'A-06', status: 'active' },
    { id: 14, medicine_id: 12, batch_no: 'TON-3145', mfg_date: addDaysIso(-90), expiry_date: addDaysIso(310), qty_available: 53, cost_price: 9.1, mrp: 14.2, rack_location: 'A-06', status: 'active' },
    { id: 15, medicine_id: 13, batch_no: 'AZT-5501', mfg_date: addDaysIso(-350), expiry_date: addDaysIso(14), qty_available: 30, cost_price: 17.8, mrp: 26.5, rack_location: 'B-09', status: 'active' },
    { id: 16, medicine_id: 13, batch_no: 'AZT-5640', mfg_date: addDaysIso(-60), expiry_date: addDaysIso(290), qty_available: 100, cost_price: 18.2, mrp: 26.5, rack_location: 'B-09', status: 'active' },
    { id: 17, medicine_id: 14, batch_no: 'PND-9120', mfg_date: addDaysIso(-140), expiry_date: addDaysIso(215), qty_available: 64, cost_price: 11.4, mrp: 19.9, rack_location: 'C-05', status: 'active' },
    { id: 18, medicine_id: 15, batch_no: 'PTD-4411', mfg_date: addDaysIso(-95), expiry_date: addDaysIso(330), qty_available: 160, cost_price: 10.8, mrp: 18.5, rack_location: 'C-05', status: 'active' },
    { id: 19, medicine_id: 16, batch_no: 'BRF-1044', mfg_date: addDaysIso(-540), expiry_date: addDaysIso(-28), qty_available: 35, cost_price: 1.85, mrp: 3.1, rack_location: 'C-08', status: 'quarantined' },
    { id: 20, medicine_id: 16, batch_no: 'BRF-2290', mfg_date: addDaysIso(-280), expiry_date: addDaysIso(84), qty_available: 85, cost_price: 1.95, mrp: 3.2, rack_location: 'C-08', status: 'active' },
    { id: 21, medicine_id: 17, batch_no: 'LNT-8801', mfg_date: addDaysIso(-335), expiry_date: addDaysIso(27), qty_available: 9, cost_price: 465.0, mrp: 625.0, rack_location: 'FRIDGE-1', status: 'active' },
    { id: 22, medicine_id: 18, batch_no: 'BEC-6632', mfg_date: addDaysIso(-100), expiry_date: addDaysIso(260), qty_available: 190, cost_price: 2.4, mrp: 4.1, rack_location: 'E-01', status: 'active' },
  ];

  const interactions: LocalDbState['interactions'] = [
    { id: 1, generic_a: 'Warfarin', generic_b: 'Aspirin', severity: 'Severe', clinical_effect: 'Markedly elevated risk of major gastrointestinal and intracranial bleeding due to combined anticoagulant and antiplatelet activity.', recommendation: 'Avoid concurrent dispensing unless explicitly confirmed by prescribing cardiologist; counsel on bleeding signs and INR monitoring.' },
    { id: 2, generic_a: 'Warfarin', generic_b: 'Ibuprofen', severity: 'Severe', clinical_effect: 'NSAIDs inhibit platelet aggregation, erode gastric mucosa, and displace warfarin from plasma albumin, sharply increasing hemorrhage risk.', recommendation: 'Substitute Paracetamol for pain relief or obtain direct physician override before dispensing.' },
    { id: 3, generic_a: 'Metformin', generic_b: 'Ciprofloxacin', severity: 'Moderate', clinical_effect: 'Fluoroquinolones can interfere with glucose regulation and trigger unpredictable hypoglycemia or hyperglycemia in diabetic patients.', recommendation: 'Advise frequent blood glucose monitoring throughout the antibiotic course.' },
    { id: 4, generic_a: 'Atorvastatin', generic_b: 'Azithromycin', severity: 'Moderate', clinical_effect: 'Concurrent macrolide therapy can elevate statin plasma levels, increasing risk of statin-associated myopathy.', recommendation: 'Counsel patient to report unexplained muscle soreness, cramps, or dark urine promptly.' },
    { id: 5, generic_a: 'Aspirin', generic_b: 'Ibuprofen', severity: 'Moderate', clinical_effect: 'Ibuprofen competitively blocks the irreversible antiplatelet cardioprotective binding of low-dose Aspirin.', recommendation: 'Take Aspirin at least 2 hours before Ibuprofen or switch analgesic to Paracetamol.' },
    { id: 6, generic_a: 'Pantoprazole', generic_b: 'Warfarin', severity: 'Mild', clinical_effect: 'Proton pump inhibitors may modestly reduce warfarin clearance via CYP2C19 inhibition in susceptible patients.', recommendation: 'Monitor INR if Pantoprazole is newly added to stable Warfarin therapy.' },
  ];

  const prescriptionsRaw: LocalDbState['prescriptionsRaw'] = [
    {
      id: 1, rx_code: 'RX-2026-1041', patient_name: 'Ramesh Deshmukh', patient_age: 64, patient_gender: 'Male', patient_phone: '+91 98230 55102', allergies: 'Sulfa Drugs', doctor_name: 'Dr. Kavita Rao', department: 'Cardiology OPD', emr_notes: 'Post-stent anticoagulation review. Verify INR target 2.0-3.0 and evaluate antiplatelet overlap.', status: 'Pending', created_at: addDaysTs(0, 9, 20),
      items: [
        { id: 1, medicine_id: 1, dosage_instruction: '1 tab OD at 8 PM after dinner', prescribed_qty: 15 },
        { id: 2, medicine_id: 3, dosage_instruction: '1 tab OD after lunch (brand-swap if unavailable)', prescribed_qty: 30 },
        { id: 3, medicine_id: 11, dosage_instruction: '1 tab HS at bedtime', prescribed_qty: 30 },
      ],
    },
    {
      id: 2, rx_code: 'RX-2026-1042', patient_name: 'Sneha Kulkarni', patient_age: 38, patient_gender: 'Female', patient_phone: '+91 97654 22198', allergies: 'None known', doctor_name: 'Dr. Vikram Joshi', department: 'General Medicine', emr_notes: 'Acute bacterial sinusitis with fever. 5-day oral antibiotic regimen.', status: 'Pending', created_at: addDaysTs(0, 10, 5),
      items: [
        { id: 4, medicine_id: 4, dosage_instruction: '1 tab BD after food for 5 days', prescribed_qty: 10 },
        { id: 5, medicine_id: 14, dosage_instruction: '1 cap OD before breakfast', prescribed_qty: 10 },
        { id: 6, medicine_id: 7, dosage_instruction: '1 tab SOS for fever > 100F', prescribed_qty: 15 },
      ],
    },
    {
      id: 3, rx_code: 'RX-2026-1043', patient_name: 'Mohammed Tariq', patient_age: 52, patient_gender: 'Male', patient_phone: '+91 99210 88412', allergies: 'Penicillin', doctor_name: 'Dr. Ananya Sen', department: 'Endocrinology', emr_notes: 'T2DM follow-up with UTI symptoms. Monitor fasting capillary glucose during Ciprofloxacin course.', status: 'Pending', created_at: addDaysTs(0, 10, 42),
      items: [
        { id: 7, medicine_id: 9, dosage_instruction: '1 tab BD before meals', prescribed_qty: 30 },
        { id: 8, medicine_id: 10, dosage_instruction: '1 tab BD for 5 days', prescribed_qty: 10 },
        { id: 9, medicine_id: 17, dosage_instruction: '14 units SC HS daily', prescribed_qty: 2 },
      ],
    },
    {
      id: 4, rx_code: 'RX-2026-1044', patient_name: 'Meera Iyer', patient_age: 29, patient_gender: 'Female', patient_phone: '+91 98192 44019', allergies: 'None known', doctor_name: 'Dr. Suresh Nair', department: 'ENT Clinic', emr_notes: 'Completed morning dispensing.', status: 'Dispensed', created_at: addDaysTs(0, 8, 45),
      items: [
        { id: 10, medicine_id: 5, dosage_instruction: '1 tab BD for 5 days', prescribed_qty: 10 },
        { id: 11, medicine_id: 18, dosage_instruction: '1 cap OD after breakfast', prescribed_qty: 15 },
      ],
    },
  ];

  const invoices: InvoiceRecord[] = [
    {
      id: 6, invoice_no: 'INV-2026-0896', customer_name: 'Meera Iyer', customer_phone: '+91 98192 44019', rx_id: 4, rx_code: 'RX-2026-1044', payment_method: 'UPI', payment_ref: 'UPI-432551290', subtotal: 435.56, cgst_total: 27.47, sgst_total: 27.47, grand_total: 490.5, interaction_ack_by: null, created_by: 'Priya Nair, RPh', created_at: addDaysTs(0, 10, 30),
      items: [
        { id: 1, medicine_id: 5, brand_name: 'Moxikind-CV 625', generic_name: 'Amoxicillin + Clavulanic Acid', hsn_code: '30041020', batch_id: 6, batch_no: 'MXK-9014', expiry_date: addDaysIso(240), qty: 10, mrp: 23, gst_rate: 12, cgst_amount: 12.32, sgst_amount: 12.32, line_total: 230 },
        { id: 2, medicine_id: 18, brand_name: 'Becosules-Z', generic_name: 'B-Complex + Zinc', hsn_code: '30045020', batch_id: 22, batch_no: 'BEC-6632', expiry_date: addDaysIso(260), qty: 15, mrp: 4.1, gst_rate: 18, cgst_amount: 4.69, sgst_amount: 4.69, line_total: 61.5 },
        { id: 3, medicine_id: 14, brand_name: 'Pan-D', generic_name: 'Pantoprazole + Domperidone', hsn_code: '30049099', batch_id: 17, batch_no: 'PND-9120', expiry_date: addDaysIso(215), qty: 10, mrp: 19.9, gst_rate: 12, cgst_amount: 10.66, sgst_amount: 10.66, line_total: 199 },
      ],
    },
    {
      id: 5, invoice_no: 'INV-2026-0895', customer_name: 'Vikramaditya Sen', customer_phone: '+91 98301 51099', rx_id: null, rx_code: null, payment_method: 'Cash', payment_ref: 'CASH-COUNTER-1', subtotal: 266.52, cgst_total: 15.99, sgst_total: 15.99, grand_total: 298.5, interaction_ack_by: null, created_by: 'Priya Nair, RPh', created_at: addDaysTs(-1, 10, 30),
      items: [
        { id: 4, medicine_id: 1, brand_name: 'Warf-5', generic_name: 'Warfarin Sodium', hsn_code: '30049099', batch_id: 1, batch_no: 'WRF-2601', expiry_date: addDaysIso(19), qty: 30, mrp: 6.2, gst_rate: 12, cgst_amount: 9.96, sgst_amount: 9.97, line_total: 186 },
        { id: 5, medicine_id: 7, brand_name: 'Dolo 650', generic_name: 'Paracetamol', hsn_code: '30049011', batch_id: 8, batch_no: 'DOL-7712', expiry_date: addDaysIso(52), qty: 50, mrp: 2.25, gst_rate: 12, cgst_amount: 6.03, sgst_amount: 6.02, line_total: 112.5 },
      ],
    },
    {
      id: 4, invoice_no: 'INV-2026-0894', customer_name: 'Nandini Rao', customer_phone: '+91 98801 77421', rx_id: null, rx_code: null, payment_method: 'UPI', payment_ref: 'UPI-432098712', subtotal: 1044.75, cgst_total: 67.38, sgst_total: 67.37, grand_total: 1179.5, interaction_ack_by: null, created_by: 'Priya Nair, RPh', created_at: addDaysTs(-2, 10, 30),
      items: [
        { id: 6, medicine_id: 14, brand_name: 'Pan-D', generic_name: 'Pantoprazole + Domperidone', hsn_code: '30049099', batch_id: 17, batch_no: 'PND-9120', expiry_date: addDaysIso(215), qty: 50, mrp: 19.9, gst_rate: 12, cgst_amount: 53.3, sgst_amount: 53.31, line_total: 995 },
        { id: 7, medicine_id: 18, brand_name: 'Becosules-Z', generic_name: 'B-Complex + Zinc', hsn_code: '30045020', batch_id: 22, batch_no: 'BEC-6632', expiry_date: addDaysIso(260), qty: 45, mrp: 4.1, gst_rate: 18, cgst_amount: 14.08, sgst_amount: 14.06, line_total: 184.5 },
      ],
    },
    {
      id: 3, invoice_no: 'INV-2026-0893', customer_name: 'Harish Bhatia', customer_phone: '+91 99102 33210', rx_id: null, rx_code: null, payment_method: 'Insurance', payment_ref: 'STAR-POL-994120', subtotal: 941.96, cgst_total: 56.52, sgst_total: 56.52, grand_total: 1055.0, interaction_ack_by: null, created_by: 'Priya Nair, RPh', created_at: addDaysTs(-4, 10, 30),
      items: [
        { id: 8, medicine_id: 5, brand_name: 'Moxikind-CV 625', generic_name: 'Amoxicillin + Clavulanic Acid', hsn_code: '30041020', batch_id: 6, batch_no: 'MXK-9014', expiry_date: addDaysIso(240), qty: 40, mrp: 23, gst_rate: 12, cgst_amount: 49.29, sgst_amount: 49.28, line_total: 920 },
        { id: 9, medicine_id: 7, brand_name: 'Dolo 650', generic_name: 'Paracetamol', hsn_code: '30049011', batch_id: 8, batch_no: 'DOL-7712', expiry_date: addDaysIso(52), qty: 60, mrp: 2.25, gst_rate: 12, cgst_amount: 7.23, sgst_amount: 7.24, line_total: 135 },
      ],
    },
  ];

  const returns: ReturnRecord[] = [
    { id: 1, return_type: 'Damaged Stock', invoice_no: null, medicine_id: 16, brand_name: 'Brufen 400', batch_id: 19, batch_no: 'BRF-1044', qty: 5, amount: 9.75, reason: 'Blister strip crushed during shelf reorganization', restocked: 0, processed_by: 'Rohan Kulkarni', created_at: addDaysTs(-2, 15, 40) },
  ];

  const purchaseOrders: PurchaseOrder[] = [
    {
      id: 2, po_number: 'PO-2026-0311', supplier_id: 1, supplier_name: 'Cipla MedLife Distributors', supplier_email: 'orders@ciplamedlife.in', supplier_phone: '+91 98204 11230', status: 'Sent', total_amount: 2140.0, notes: 'Priority restock for Augmentin 625 Duo out-of-stock shelf.', emailed_at: addDaysTs(-1, 14, 15), created_by: 'Dr. Arvind Mehta', created_at: addDaysTs(-1, 14, 10),
      items: [
        { id: 1, medicine_id: 4, brand_name: 'Augmentin 625 Duo', generic_name: 'Amoxicillin + Clavulanic Acid', qty_ordered: 100, unit_cost: 16.5, line_total: 1650.0 },
        { id: 2, medicine_id: 1, brand_name: 'Warf-5', generic_name: 'Warfarin Sodium', qty_ordered: 120, unit_cost: 4.08, line_total: 490.0 },
      ],
    },
    {
      id: 1, po_number: 'PO-2026-0308', supplier_id: 3, supplier_name: 'Apollo HealthCare Logistics', supplier_email: 'procurement@apollologistics.in', supplier_phone: '+91 99002 77341', status: 'Received', total_amount: 1860.0, notes: 'Routine analgesic and cold-chain replenishment.', emailed_at: addDaysTs(-4, 11, 0), created_by: 'Dr. Arvind Mehta', created_at: addDaysTs(-4, 10, 45),
      items: [
        { id: 3, medicine_id: 8, brand_name: 'Calpol 650', generic_name: 'Paracetamol', qty_ordered: 240, unit_cost: 1.4, line_total: 336.0 },
        { id: 4, medicine_id: 17, brand_name: 'Lantus SoloStar', generic_name: 'Insulin Glargine', qty_ordered: 3, unit_cost: 465.0, line_total: 1395.0 },
      ],
    },
  ];

  const grnRecords: GrnRecord[] = [
    { id: 1, grn_number: 'GRN-2026-0192', po_id: 1, po_number: 'PO-2026-0308', supplier_id: 3, supplier_name: 'Apollo HealthCare Logistics', invoice_ref: 'APL-GST-77120', total_cost: 1860.0, received_by: 'Rohan Kulkarni', created_at: addDaysTs(-3, 16, 20) },
  ];

  const auditLogs: AuditLog[] = [
    { id: 4, actor_name: 'Dr. Arvind Mehta', actor_role: 'Admin', action_type: 'PO_DISPATCH', entity: 'PO-2026-0311', details: 'Emailed purchase order to orders@ciplamedlife.in (₹2,140.00)', created_at: addDaysTs(-1, 14, 15) },
    { id: 3, actor_name: 'Rohan Kulkarni', actor_role: 'Store Staff', action_type: 'GRN_INTAKE', entity: 'GRN-2026-0192', details: 'Received stock against PO-2026-0308 and updated batch inventory', created_at: addDaysTs(-3, 16, 20) },
    { id: 2, actor_name: 'Priya Nair, RPh', actor_role: 'Pharmacist', action_type: 'RX_DISPENSE', entity: 'RX-2026-1044', details: 'Dispensed digital prescription RX-2026-1044 via FEFO invoice INV-2026-0896', created_at: addDaysTs(0, 8, 45) },
    { id: 1, actor_name: 'Rohan Kulkarni', actor_role: 'Store Staff', action_type: 'RETURN_RECONCILE', entity: 'BRF-1044', details: 'Quarantined 5 damaged units of Brufen 400 (₹9.75 loss)', created_at: addDaysTs(-2, 15, 40) },
  ];

  return { suppliers, medicinesMeta, batchesRaw, interactions, prescriptionsRaw, invoices, returns, purchaseOrders, grnRecords, auditLogs };
}

function loadState(): LocalDbState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as LocalDbState;
  } catch {
    // Ignore storage errors
  }
  const seeded = createSeedState();
  saveState(seeded);
  return seeded;
}

function saveState(state: LocalDbState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

function getEnrichedBatches(state: LocalDbState): Batch[] {
  const medMap = new Map(state.medicinesMeta.map((m) => [m.id, m]));
  return state.batchesRaw
    .map((b) => {
      const m = medMap.get(b.medicine_id);
      const days = diffDays(b.expiry_date);
      const risk = computeRiskTier(days, b.status);
      return {
        ...b,
        brand_name: m?.brand_name || 'Unknown',
        generic_name: m?.generic_name || '',
        strength: m?.strength || '',
        category: m?.category || 'General',
        gst_rate: m?.gst_rate ?? 12,
        hsn_code: m?.hsn_code || '30049099',
        days_to_expiry: days,
        risk_tier: risk,
        cost_value_at_risk: Number((b.qty_available * b.cost_price).toFixed(2)),
      };
    })
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
}

function getEnrichedMedicines(state: LocalDbState): Medicine[] {
  const supMap = new Map(state.suppliers.map((s) => [s.id, s]));
  const batches = getEnrichedBatches(state);
  return state.medicinesMeta
    .map((m) => {
      const sup = supMap.get(m.preferred_supplier_id);
      const medBatches = batches.filter((b) => b.medicine_id === m.id);
      const active = medBatches.filter((b) => b.risk_tier !== 'expired' && b.qty_available > 0);
      const expired = medBatches.filter((b) => b.risk_tier === 'expired');
      const totalActive = active.reduce((s, b) => s + b.qty_available, 0);
      const totalExpired = expired.reduce((s, b) => s + b.qty_available, 0);
      return {
        ...m,
        preferred_supplier_name: sup?.name,
        preferred_supplier_phone: sup?.phone,
        preferred_supplier_email: sup?.email,
        total_active_stock: totalActive,
        total_expired_stock: totalExpired,
        active_batch_count: active.length,
        earliest_expiry: active[0]?.expiry_date ?? null,
        avg_mrp: active.length ? Number((active.reduce((s, b) => s + b.mrp, 0) / active.length).toFixed(2)) : 0,
        avg_cost: active.length ? Number((active.reduce((s, b) => s + b.cost_price, 0) / active.length).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => a.brand_name.localeCompare(b.brand_name));
}

function findBrandSwaps(state: LocalDbState, medId: number, genericName: string): BrandSwapOption[] {
  const primary = genericName.split('+')[0].trim().toLowerCase();
  return getEnrichedMedicines(state)
    .filter(
      (m) =>
        m.id !== medId &&
        m.total_active_stock > 0 &&
        (m.generic_name.toLowerCase() === genericName.toLowerCase() || m.generic_name.toLowerCase().includes(primary))
    )
    .map((m) => ({
      medicine_id: m.id,
      brand_name: m.brand_name,
      generic_name: m.generic_name,
      strength: m.strength,
      total_active_stock: m.total_active_stock,
      earliest_expiry: m.earliest_expiry,
      mrp: m.avg_mrp,
      gst_rate: m.gst_rate,
    }))
    .sort((a, b) => b.total_active_stock - a.total_active_stock);
}

function checkInteractions(
  state: LocalDbState,
  meds: Array<{ medicine_id: number; brand_name: string; generic_name: string }>
): DrugInteractionAlert[] {
  if (meds.length < 2) return [];
  const alerts: DrugInteractionAlert[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < meds.length; i++) {
    for (let j = i + 1; j < meds.length; j++) {
      const m1 = meds[i];
      const m2 = meds[j];
      const g1 = m1.generic_name.toLowerCase();
      const g2 = m2.generic_name.toLowerCase();
      for (const rule of state.interactions) {
        const ra = rule.generic_a.toLowerCase();
        const rb = rule.generic_b.toLowerCase();
        if ((g1.includes(ra) && g2.includes(rb)) || (g1.includes(rb) && g2.includes(ra))) {
          const key = `${rule.id}-${Math.min(m1.medicine_id, m2.medicine_id)}-${Math.max(m1.medicine_id, m2.medicine_id)}`;
          if (!seen.has(key)) {
            seen.add(key);
            alerts.push({ ...rule, medicine_a: m1.brand_name, medicine_b: m2.brand_name });
          }
        }
      }
    }
  }
  const order: Record<string, number> = { Severe: 0, Moderate: 1, Mild: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

function buildPreview(state: LocalDbState, items: Array<{ medicine_id: number; qty: number }>): BillingPreviewResponse {
  const batches = getEnrichedBatches(state);
  const medMap = new Map(state.medicinesMeta.map((m) => [m.id, m]));
  const lines: BillingLinePreview[] = [];
  const medsForInteraction: Array<{ medicine_id: number; brand_name: string; generic_name: string }> = [];

  let subtotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let grandTotal = 0;
  let hasShortfall = false;

  for (const item of items) {
    const med = medMap.get(item.medicine_id);
    if (!med) continue;
    const qtyReq = Math.max(1, Math.floor(Number(item.qty) || 1));
    medsForInteraction.push({ medicine_id: med.id, brand_name: med.brand_name, generic_name: med.generic_name });

    const activeBatches = batches.filter((b) => b.medicine_id === med.id && b.risk_tier !== 'expired' && b.qty_available > 0);
    const expiredBlocked = batches
      .filter((b) => b.medicine_id === med.id && b.risk_tier === 'expired' && b.qty_available > 0)
      .reduce((s, b) => s + b.qty_available, 0);

    let remaining = qtyReq;
    let allocated = 0;
    let lineGross = 0;
    const allocations: FefoAllocation[] = [];
    for (const b of activeBatches) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, b.qty_available);
      if (take > 0) {
        allocations.push({
          batch_id: b.id,
          batch_no: b.batch_no,
          expiry_date: b.expiry_date,
          days_to_expiry: b.days_to_expiry,
          qty_allocated: take,
          mrp: b.mrp,
          cost_price: b.cost_price,
        });
        lineGross += take * b.mrp;
        allocated += take;
        remaining -= take;
      }
    }

    const availableQty = activeBatches.reduce((s, b) => s + b.qty_available, 0);
    const shortfallQty = Math.max(0, qtyReq - allocated);
    if (shortfallQty > 0) hasShortfall = true;

    const base = Number((lineGross / (1 + med.gst_rate / 100)).toFixed(2));
    const tax = Number((lineGross - base).toFixed(2));
    const cgst = Number((tax / 2).toFixed(2));
    const sgst = Number((tax - cgst).toFixed(2));
    subtotal += base;
    cgstTotal += cgst;
    sgstTotal += sgst;
    grandTotal += lineGross;

    lines.push({
      medicine_id: med.id,
      brand_name: med.brand_name,
      generic_name: med.generic_name,
      strength: med.strength,
      hsn_code: med.hsn_code,
      gst_rate: med.gst_rate,
      requested_qty: qtyReq,
      available_qty: availableQty,
      shortfall_qty: shortfallQty,
      expired_blocked_qty: expiredBlocked,
      allocations,
      line_subtotal: base,
      cgst_amount: cgst,
      sgst_amount: sgst,
      line_total: Number(lineGross.toFixed(2)),
      brand_swaps: shortfallQty > 0 || availableQty === 0 ? findBrandSwaps(state, med.id, med.generic_name) : [],
    });
  }

  const interactions = checkInteractions(state, medsForInteraction);
  return {
    lines,
    interactions,
    subtotal: Number(subtotal.toFixed(2)),
    cgst_total: Number(cgstTotal.toFixed(2)),
    sgst_total: Number(sgstTotal.toFixed(2)),
    grand_total: Number(grandTotal.toFixed(2)),
    has_shortfall: hasShortfall,
    has_severe_interaction: interactions.some((i) => i.severity === 'Severe'),
  };
}

function buildDashboard(state: LocalDbState): DashboardPayload {
  const batches = getEnrichedBatches(state).filter((b) => b.qty_available > 0);
  const meds = getEnrichedMedicines(state);
  const supMap = new Map(state.suppliers.map((s) => [s.id, s]));

  let totalStockValue = 0;
  let totalMrpValue = 0;
  let atRisk90dValue = 0;
  let atRisk90dUnits = 0;
  let expiredValue = 0;
  let criticalValue = 0;
  let criticalBatches = 0;
  let amberValue = 0;
  let amberBatches = 0;
  let greenValue = 0;
  let greenBatches = 0;
  const expiryShelf: Batch[] = [];

  for (const b of batches) {
    if (b.risk_tier === 'expired') {
      expiredValue += b.cost_value_at_risk;
    } else {
      totalStockValue += b.cost_value_at_risk;
      totalMrpValue += b.qty_available * b.mrp;
      if (b.days_to_expiry <= 90) {
        atRisk90dValue += b.cost_value_at_risk;
        atRisk90dUnits += b.qty_available;
        expiryShelf.push(b);
        if (b.risk_tier === 'critical') {
          criticalValue += b.cost_value_at_risk;
          criticalBatches += 1;
        } else if (b.risk_tier === 'amber') {
          amberValue += b.cost_value_at_risk;
          amberBatches += 1;
        } else if (b.risk_tier === 'green') {
          greenValue += b.cost_value_at_risk;
          greenBatches += 1;
        }
      }
    }
  }

  const reorder_list: ReorderItem[] = meds
    .filter((m) => m.total_active_stock <= m.reorder_level)
    .map((m) => {
      const sup = supMap.get(m.preferred_supplier_id)!;
      const latestBatch = [...state.batchesRaw].reverse().find((b) => b.medicine_id === m.id);
      const estCost = latestBatch ? latestBatch.cost_price : 10;
      const suggested = Math.max(m.target_stock - m.total_active_stock, m.reorder_level);
      return {
        medicine_id: m.id,
        brand_name: m.brand_name,
        generic_name: m.generic_name,
        strength: m.strength,
        category: m.category,
        current_stock: m.total_active_stock,
        reorder_level: m.reorder_level,
        target_stock: m.target_stock,
        suggested_order_qty: suggested,
        est_unit_cost: Number(estCost.toFixed(2)),
        est_order_cost: Number((suggested * estCost).toFixed(2)),
        supplier_id: sup.id,
        supplier_name: sup.name,
        supplier_phone: sup.phone,
        supplier_email: sup.email,
        lead_time_days: sup.lead_time_days,
      };
    })
    .sort((a, b) => (b.reorder_level - b.current_stock) - (a.reorder_level - a.current_stock));

  const today = new Date().toISOString().slice(0, 10);
  const todayInvoices = state.invoices.filter((i) => i.created_at.slice(0, 10) === today);
  const todayRev = todayInvoices.reduce((s, i) => s + i.grand_total, 0);

  const salesByMed = new Map<number, { units: number; rev: number }>();
  for (const inv of state.invoices) {
    for (const it of inv.items) {
      const cur = salesByMed.get(it.medicine_id) || { units: 0, rev: 0 };
      cur.units += it.qty;
      cur.rev += it.line_total;
      salesByMed.set(it.medicine_id, cur);
    }
  }
  const medMap = new Map(meds.map((m) => [m.id, m]));
  const fast_moving_items = Array.from(salesByMed.entries())
    .map(([id, agg]) => {
      const m = medMap.get(id)!;
      return {
        medicine_id: id,
        brand_name: m.brand_name,
        generic_name: m.generic_name,
        strength: m.strength,
        units_sold: agg.units,
        revenue: Number(agg.rev.toFixed(2)),
        current_stock: m.total_active_stock,
      };
    })
    .sort((a, b) => b.units_sold - a.units_sold)
    .slice(0, 6);

  const salesByDate = new Map<string, number>();
  for (const inv of state.invoices) {
    const d = inv.created_at.slice(0, 10);
    salesByDate.set(d, (salesByDate.get(d) || 0) + inv.grand_total);
  }
  const stock_value_trends = [];
  let rolling = totalStockValue;
  for (let offset = 0; offset >= -9; offset--) {
    const dt = new Date();
    dt.setDate(dt.getDate() + offset);
    const iso = dt.toISOString().slice(0, 10);
    const label = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const daySales = Number((salesByDate.get(iso) || 0).toFixed(2));
    stock_value_trends.unshift({
      date: iso,
      label,
      stock_value: Number(rolling.toFixed(2)),
      daily_sales: daySales,
    });
    rolling = Math.max(4000, rolling + daySales * 0.68 - (offset === -3 ? 1860 : 0));
  }

  return {
    kpis: {
      total_stock_value: Number(totalStockValue.toFixed(2)),
      total_mrp_value: Number(totalMrpValue.toFixed(2)),
      at_risk_90d_value: Number(atRisk90dValue.toFixed(2)),
      at_risk_90d_units: atRisk90dUnits,
      expired_quarantined_value: Number(expiredValue.toFixed(2)),
      reorder_count: reorder_list.length,
      today_revenue: Number(todayRev.toFixed(2)),
      today_invoices: todayInvoices.length,
      pending_rx_count: state.prescriptionsRaw.filter((r) => r.status !== 'Dispensed').length,
    },
    expiry_shelf: expiryShelf,
    expiry_summary: {
      critical_value: Number(criticalValue.toFixed(2)),
      critical_batches: criticalBatches,
      amber_value: Number(amberValue.toFixed(2)),
      amber_batches: amberBatches,
      green_value: Number(greenValue.toFixed(2)),
      green_batches: greenBatches,
    },
    stock_value_trends,
    fast_moving_items,
    reorder_list,
  };
}

function buildPrescriptions(state: LocalDbState): EmrPrescription[] {
  const meds = new Map(getEnrichedMedicines(state).map((m) => [m.id, m]));
  return state.prescriptionsRaw.map((rx) => {
    const items = rx.items.map((it) => {
      const m = meds.get(it.medicine_id)!;
      const avail = m?.total_active_stock ?? 0;
      return {
        id: it.id,
        medicine_id: it.medicine_id,
        brand_name: m.brand_name,
        generic_name: m.generic_name,
        strength: m.strength,
        dosage_instruction: it.dosage_instruction,
        prescribed_qty: it.prescribed_qty,
        available_stock: avail,
        brand_swaps: avail < it.prescribed_qty ? findBrandSwaps(state, m.id, m.generic_name) : [],
      };
    });
    const interactions = checkInteractions(
      state,
      items.map((i) => ({ medicine_id: i.medicine_id, brand_name: i.brand_name, generic_name: i.generic_name }))
    );
    return { ...rx, items, interactions };
  });
}

function addAudit(state: LocalDbState, actor: string, role: string, action: string, entity: string, details: string) {
  state.auditLogs.unshift({
    id: (state.auditLogs[0]?.id ?? 0) + 1,
    actor_name: actor,
    actor_role: role,
    action_type: action,
    entity,
    details,
    created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  });
}

export async function localFallbackRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  const body = options?.body ? JSON.parse(String(options.body)) : {};
  const state = loadState();

  if (url === '/api/auth/login' && method === 'POST') {
    const users: Array<UserSession & { password: string }> = [
      { id: 1, name: 'Dr. Arvind Mehta', email: 'admin@medoryx.in', role: 'Admin', license_no: 'MH-ADM-2019-0041', password: 'admin123' },
      { id: 2, name: 'Priya Nair, RPh', email: 'pharmacist@medoryx.in', role: 'Pharmacist', license_no: 'MH-RPH-2021-8842', password: 'pharma123' },
      { id: 3, name: 'Rohan Kulkarni', email: 'staff@medoryx.in', role: 'Store Staff', license_no: 'MH-STF-2024-1129', password: 'staff123' },
    ];
    let found: (UserSession & { password: string }) | undefined;
    if (body.quickRole) {
      found = users.find((u) => u.role === (body.quickRole as UserRole));
    } else if (body.email && body.password) {
      found = users.find((u) => u.email.toLowerCase() === String(body.email).trim().toLowerCase() && u.password === body.password);
    }
    if (!found) throw new Error('Invalid credentials. Check email/password or use Quick Role Access.');
    addAudit(state, found.name, found.role, 'AUTH_LOGIN', 'Session', `Signed in as ${found.role} (${found.email})`);
    saveState(state);
    return { id: found.id, name: found.name, email: found.email, role: found.role, license_no: found.license_no } as T;
  }

  if (url === '/api/bootstrap' && method === 'GET') {
    return {
      dashboard: buildDashboard(state),
      medicines: getEnrichedMedicines(state),
      batches: getEnrichedBatches(state),
      prescriptions: buildPrescriptions(state),
      invoices: state.invoices,
      returns: state.returns,
      suppliers: state.suppliers,
      purchase_orders: state.purchaseOrders,
      grn_records: state.grnRecords,
    } as T;
  }

  if (url === '/api/billing/preview' && method === 'POST') {
    return buildPreview(state, body.items || []) as T;
  }

  if (url === '/api/invoices' && method === 'POST') {
    const preview = buildPreview(state, body.items || []);
    if (preview.has_shortfall) throw new Error('Insufficient non-expired batch stock for one or more items.');
    if (preview.has_severe_interaction && !body.interaction_ack_by) {
      throw new Error('Severe drug interaction detected. Pharmacist clinical acknowledgement is required.');
    }
    const invoiceNo = `INV-2026-${String(state.invoices.length + 897).padStart(4, '0')}`;
    const invId = (state.invoices[0]?.id ?? 0) + 1;
    const invItems = [];
    let itemSeq = 1;
    for (const line of preview.lines) {
      for (const alloc of line.allocations) {
        const b = state.batchesRaw.find((x) => x.id === alloc.batch_id);
        if (!b || b.qty_available < alloc.qty_allocated || diffDays(b.expiry_date) <= 0) {
          throw new Error(`Batch ${alloc.batch_no} is expired or insufficient.`);
        }
        b.qty_available -= alloc.qty_allocated;
        const gross = Number((alloc.qty_allocated * alloc.mrp).toFixed(2));
        const base = Number((gross / (1 + line.gst_rate / 100)).toFixed(2));
        const tax = Number((gross - base).toFixed(2));
        const cgst = Number((tax / 2).toFixed(2));
        const sgst = Number((tax - cgst).toFixed(2));
        invItems.push({
          id: itemSeq++,
          medicine_id: line.medicine_id,
          brand_name: line.brand_name,
          generic_name: line.generic_name,
          hsn_code: line.hsn_code,
          batch_id: alloc.batch_id,
          batch_no: alloc.batch_no,
          expiry_date: alloc.expiry_date,
          qty: alloc.qty_allocated,
          mrp: alloc.mrp,
          gst_rate: line.gst_rate,
          cgst_amount: cgst,
          sgst_amount: sgst,
          line_total: gross,
        });
      }
    }
    const created: InvoiceRecord = {
      id: invId,
      invoice_no: invoiceNo,
      customer_name: body.customer_name || 'Walk-in Patient',
      customer_phone: body.customer_phone || '',
      rx_id: body.rx_id ?? null,
      rx_code: body.rx_id ? state.prescriptionsRaw.find((r) => r.id === body.rx_id)?.rx_code ?? null : null,
      payment_method: body.payment_method,
      payment_ref: body.payment_ref || '',
      subtotal: preview.subtotal,
      cgst_total: preview.cgst_total,
      sgst_total: preview.sgst_total,
      grand_total: preview.grand_total,
      interaction_ack_by: body.interaction_ack_by || null,
      created_by: body.actor_name || 'Priya Nair, RPh',
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      items: invItems,
    };
    state.invoices.unshift(created);
    if (body.rx_id) {
      const rx = state.prescriptionsRaw.find((r) => r.id === body.rx_id);
      if (rx) rx.status = 'Dispensed';
    }
    addAudit(state, body.actor_name || 'Pharmacist', body.actor_role || 'Pharmacist', 'FEFO_BILLING', invoiceNo, `Billed ₹${preview.grand_total.toFixed(2)} (${body.payment_method})`);
    saveState(state);
    return created as T;
  }

  if (url.startsWith('/api/prescriptions/') && url.endsWith('/swap') && method === 'POST') {
    const rxId = Number(url.split('/')[3]);
    const rx = state.prescriptionsRaw.find((r) => r.id === rxId);
    const item = rx?.items.find((i) => i.id === body.item_id);
    if (rx && item) {
      item.medicine_id = body.new_medicine_id;
      if (rx.status === 'Pending') rx.status = 'Reviewed';
      addAudit(state, body.actor_name || 'Pharmacist', body.actor_role || 'Pharmacist', 'BRAND_SWAP', rx.rx_code, `Swapped item to medicine #${body.new_medicine_id}`);
      saveState(state);
    }
    return { ok: true } as T;
  }

  if (url === '/api/prescriptions' && method === 'POST') {
    const id = (state.prescriptionsRaw[0]?.id ?? 0) + 1;
    const rx_code = `RX-2026-${1041 + state.prescriptionsRaw.length}`;
    state.prescriptionsRaw.unshift({
      id,
      rx_code,
      patient_name: body.patient_name,
      patient_age: Number(body.patient_age || 35),
      patient_gender: body.patient_gender || 'Male',
      patient_phone: body.patient_phone || '',
      allergies: body.allergies || 'None known',
      doctor_name: body.doctor_name || 'Dr. Kavita Rao',
      department: body.department || 'OPD Clinic',
      emr_notes: body.emr_notes || '',
      status: 'Pending',
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      items: (body.items || []).map((it: { medicine_id: number; dosage_instruction: string; prescribed_qty: number }, idx: number) => ({
        id: Date.now() + idx,
        medicine_id: it.medicine_id,
        dosage_instruction: it.dosage_instruction,
        prescribed_qty: it.prescribed_qty,
      })),
    });
    saveState(state);
    return { id, rx_code } as T;
  }

  if (url === '/api/batches' && method === 'POST') {
    const id = Math.max(0, ...state.batchesRaw.map((b) => b.id)) + 1;
    const med = state.medicinesMeta.find((m) => m.id === body.medicine_id);
    state.batchesRaw.push({
      id,
      medicine_id: body.medicine_id,
      batch_no: body.batch_no,
      mfg_date: body.mfg_date || addDaysIso(0),
      expiry_date: body.expiry_date,
      qty_available: Number(body.qty_available),
      cost_price: Number(body.cost_price),
      mrp: Number(body.mrp),
      rack_location: med?.rack_location || 'A-01',
      status: diffDays(body.expiry_date) <= 0 ? 'quarantined' : 'active',
    });
    addAudit(state, body.actor_name || 'Staff', body.actor_role || 'Store Staff', 'BATCH_ADD', body.batch_no, `Added ${body.qty_available} units`);
    saveState(state);
    return { id } as T;
  }

  if (url.startsWith('/api/batches/') && url.endsWith('/adjust') && method === 'POST') {
    const batchId = Number(url.split('/')[3]);
    const b = state.batchesRaw.find((x) => x.id === batchId);
    if (b) {
      if (body.action === 'quarantine') b.status = 'quarantined';
      else if (body.action === 'remove') { b.qty_available = 0; b.status = 'quarantined'; }
      else b.qty_available = Math.max(0, b.qty_available + Number(body.delta_qty || 0));
      addAudit(state, body.actor_name || 'Staff', body.actor_role || 'Admin', 'BATCH_ADJUST', b.batch_no, body.reason || 'Adjusted stock');
      saveState(state);
    }
    return { ok: true } as T;
  }

  if (url === '/api/batches/import' && method === 'POST') {
    let imported = 0;
    for (const r of body.rows || []) {
      let med = state.medicinesMeta.find((m) => m.brand_name.toLowerCase() === String(r.brand_name).toLowerCase());
      if (!med) {
        const medId = Math.max(0, ...state.medicinesMeta.map((m) => m.id)) + 1;
        med = {
          id: medId, brand_name: r.brand_name, generic_name: r.generic_name || r.brand_name, strength: 'Standard', dosage_form: 'Tablet', category: 'Imported', hsn_code: '30049099', gst_rate: 12, reorder_level: 40, target_stock: 120, preferred_supplier_id: 1, rack_location: 'IMP-1', requires_rx: 0,
        };
        state.medicinesMeta.push(med);
      }
      const bId = Math.max(0, ...state.batchesRaw.map((b) => b.id)) + 1;
      state.batchesRaw.push({
        id: bId, medicine_id: med.id, batch_no: r.batch_no, mfg_date: addDaysIso(0), expiry_date: r.expiry_date, qty_available: Number(r.qty), cost_price: Number(r.cost_price), mrp: Number(r.mrp), rack_location: med.rack_location, status: diffDays(r.expiry_date) <= 0 ? 'quarantined' : 'active',
      });
      imported++;
    }
    saveState(state);
    return { imported } as T;
  }

  if (url === '/api/medicines' && method === 'POST') {
    const id = Math.max(0, ...state.medicinesMeta.map((m) => m.id)) + 1;
    state.medicinesMeta.push({
      id,
      brand_name: body.brand_name,
      generic_name: body.generic_name,
      strength: body.strength || 'Standard',
      dosage_form: 'Tablet',
      category: body.category || 'General',
      hsn_code: body.hsn_code || '30049099',
      gst_rate: Number(body.gst_rate ?? 12),
      reorder_level: Number(body.reorder_level ?? 50),
      target_stock: Number(body.target_stock ?? 150),
      preferred_supplier_id: Number(body.preferred_supplier_id ?? 1),
      rack_location: 'A-01',
      requires_rx: 0,
    });
    saveState(state);
    return { id } as T;
  }

  if (url === '/api/returns' && method === 'POST') {
    const b = state.batchesRaw.find((x) => x.id === body.batch_id);
    if (!b) throw new Error('Batch not found');
    const med = state.medicinesMeta.find((m) => m.id === b.medicine_id)!;
    const q = Math.max(1, Number(body.qty) || 1);
    let restocked = 0;
    let amount = 0;
    if (body.return_type === 'Customer Return') {
      if (diffDays(b.expiry_date) <= 0) throw new Error('Expired batch cannot be restocked.');
      b.qty_available += q;
      restocked = 1;
      amount = Number((q * b.mrp).toFixed(2));
    } else {
      if (q > b.qty_available) throw new Error('Write-off qty exceeds available batch qty.');
      b.qty_available -= q;
      if (body.return_type === 'Expired Write-Off') b.status = 'quarantined';
      amount = Number((q * b.cost_price).toFixed(2));
    }
    const id = Math.max(0, ...state.returns.map((r) => r.id)) + 1;
    state.returns.unshift({
      id, return_type: body.return_type, invoice_no: body.invoice_no || null, medicine_id: b.medicine_id, brand_name: med.brand_name, batch_id: b.id, batch_no: b.batch_no, qty: q, amount, reason: body.reason || body.return_type, restocked, processed_by: body.actor_name || 'Staff', created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
    addAudit(state, body.actor_name || 'Staff', body.actor_role || 'Pharmacist', 'RETURN_RECONCILE', b.batch_no, `${body.return_type} (${q} units)`);
    saveState(state);
    return { id, restocked, amount } as T;
  }

  if (url === '/api/suppliers' && method === 'POST') {
    const id = Math.max(0, ...state.suppliers.map((s) => s.id)) + 1;
    state.suppliers.push({ id, ...body });
    saveState(state);
    return { id } as T;
  }

  if (url.startsWith('/api/suppliers/') && method === 'PUT') {
    const id = Number(url.split('/')[3]);
    const idx = state.suppliers.findIndex((s) => s.id === id);
    if (idx >= 0) state.suppliers[idx] = { ...state.suppliers[idx], ...body, id };
    saveState(state);
    return { ok: true } as T;
  }

  if (url === '/api/purchase-orders' && method === 'POST') {
    const id = Math.max(0, ...state.purchaseOrders.map((p) => p.id)) + 1;
    const po_number = `PO-2026-${String(312 + state.purchaseOrders.length).padStart(4, '0')}`;
    const sup = state.suppliers.find((s) => s.id === body.supplier_id)!;
    const items = (body.items || []).map((it: { medicine_id: number; qty_ordered: number; unit_cost: number }, i: number) => {
      const m = state.medicinesMeta.find((x) => x.id === it.medicine_id)!;
      return {
        id: Date.now() + i,
        medicine_id: it.medicine_id,
        brand_name: m.brand_name,
        generic_name: m.generic_name,
        qty_ordered: Number(it.qty_ordered),
        unit_cost: Number(it.unit_cost),
        line_total: Number((Number(it.qty_ordered) * Number(it.unit_cost)).toFixed(2)),
      };
    });
    const total = items.reduce((s: number, i: { line_total: number }) => s + i.line_total, 0);
    state.purchaseOrders.unshift({
      id, po_number, supplier_id: sup.id, supplier_name: sup.name, supplier_email: sup.email, supplier_phone: sup.phone, status: 'Draft', total_amount: Number(total.toFixed(2)), notes: body.notes || '', emailed_at: null, created_by: body.actor_name || 'Admin', created_at: new Date().toISOString().slice(0, 19).replace('T', ' '), items,
    });
    saveState(state);
    return { id, po_number } as T;
  }

  if (url.startsWith('/api/purchase-orders/') && url.endsWith('/email') && method === 'POST') {
    const poId = Number(url.split('/')[3]);
    const po = state.purchaseOrders.find((p) => p.id === poId);
    if (po) {
      po.status = 'Sent';
      po.emailed_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
      addAudit(state, body.actor_name || 'Admin', body.actor_role || 'Admin', 'PO_DISPATCH', po.po_number, `Emailed ${po.po_number} to ${po.supplier_email}`);
      saveState(state);
    }
    return { ok: true, emailed_to: po?.supplier_email || '' } as T;
  }

  if (url === '/api/grn' && method === 'POST') {
    const id = Math.max(0, ...state.grnRecords.map((g) => g.id)) + 1;
    const grn_number = `GRN-2026-${String(193 + state.grnRecords.length).padStart(4, '0')}`;
    const sup = state.suppliers.find((s) => s.id === body.supplier_id)!;
    const totalCost = (body.items || []).reduce((s: number, it: { qty: number; cost_price: number }) => s + Number(it.qty) * Number(it.cost_price), 0);
    for (const it of body.items || []) {
      const bId = Math.max(0, ...state.batchesRaw.map((b) => b.id)) + 1;
      const med = state.medicinesMeta.find((m) => m.id === it.medicine_id);
      state.batchesRaw.push({
        id: bId, medicine_id: it.medicine_id, batch_no: it.batch_no, mfg_date: it.mfg_date || addDaysIso(0), expiry_date: it.expiry_date, qty_available: Number(it.qty), cost_price: Number(it.cost_price), mrp: Number(it.mrp), rack_location: med?.rack_location || 'A-01', status: diffDays(it.expiry_date) <= 0 ? 'quarantined' : 'active',
      });
    }
    const po = body.po_id ? state.purchaseOrders.find((p) => p.id === body.po_id) : undefined;
    if (po) po.status = 'Received';
    state.grnRecords.unshift({
      id, grn_number, po_id: body.po_id ?? null, po_number: po?.po_number ?? null, supplier_id: sup.id, supplier_name: sup.name, invoice_ref: body.invoice_ref, total_cost: Number(totalCost.toFixed(2)), received_by: body.actor_name || 'Staff', created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
    saveState(state);
    return { id, grn_number } as T;
  }

  if (url === '/api/reports/overview' && method === 'GET') {
    const meds = getEnrichedMedicines(state);
    const batches = getEnrichedBatches(state);
    const catMap = new Map<string, { sku_count: number; active_units: number; cost_value: number; mrp_value: number }>();
    for (const m of meds) {
      const cur = catMap.get(m.category) || { sku_count: 0, active_units: 0, cost_value: 0, mrp_value: 0 };
      cur.sku_count += 1;
      catMap.set(m.category, cur);
    }
    for (const b of batches) {
      if (b.risk_tier !== 'expired') {
        const cur = catMap.get(b.category);
        if (cur) {
          cur.active_units += b.qty_available;
          cur.cost_value = Number((cur.cost_value + b.qty_available * b.cost_price).toFixed(2));
          cur.mrp_value = Number((cur.mrp_value + b.qty_available * b.mrp).toFixed(2));
        }
      }
    }
    const payMap = new Map<string, { invoice_count: number; taxable_value: number; gst_collected: number; gross_revenue: number }>();
    const slabMap = new Map<number, { units_sold: number; cgst: number; sgst: number; gross_total: number }>();
    for (const inv of state.invoices) {
      const p = payMap.get(inv.payment_method) || { invoice_count: 0, taxable_value: 0, gst_collected: 0, gross_revenue: 0 };
      p.invoice_count += 1;
      p.taxable_value = Number((p.taxable_value + inv.subtotal).toFixed(2));
      p.gst_collected = Number((p.gst_collected + inv.cgst_total + inv.sgst_total).toFixed(2));
      p.gross_revenue = Number((p.gross_revenue + inv.grand_total).toFixed(2));
      payMap.set(inv.payment_method, p);
      for (const it of inv.items) {
        const s = slabMap.get(it.gst_rate) || { units_sold: 0, cgst: 0, sgst: 0, gross_total: 0 };
        s.units_sold += it.qty;
        s.cgst = Number((s.cgst + it.cgst_amount).toFixed(2));
        s.sgst = Number((s.sgst + it.sgst_amount).toFixed(2));
        s.gross_total = Number((s.gross_total + it.line_total).toFixed(2));
        slabMap.set(it.gst_rate, s);
      }
    }
    return {
      category_snapshot: Array.from(catMap.entries()).map(([category, v]) => ({ category, ...v })),
      payment_breakdown: Array.from(payMap.entries()).map(([payment_method, v]) => ({ payment_method, ...v })),
      gst_slabs: Array.from(slabMap.entries()).map(([gst_rate, v]) => ({ gst_rate, ...v })).sort((a, b) => a.gst_rate - b.gst_rate),
      audit_logs: state.auditLogs,
    } as T;
  }

  if (url === '/api/schema/mysql' && method === 'GET') {
    return `-- Medoryx Medical Store Management System — Reference MySQL 8.0 Schema
CREATE DATABASE IF NOT EXISTS medoryx_pharmacy;
USE medoryx_pharmacy;

CREATE TABLE suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  contact_person VARCHAR(120) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(150) NOT NULL,
  gstin VARCHAR(20) NOT NULL,
  city VARCHAR(80) NOT NULL,
  lead_time_days INT NOT NULL DEFAULT 2
);

CREATE TABLE medicines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  brand_name VARCHAR(150) NOT NULL,
  generic_name VARCHAR(180) NOT NULL,
  strength VARCHAR(60) NOT NULL,
  dosage_form VARCHAR(60) NOT NULL,
  category VARCHAR(80) NOT NULL,
  hsn_code VARCHAR(20) NOT NULL,
  gst_rate INT NOT NULL DEFAULT 12,
  reorder_level INT NOT NULL DEFAULT 50,
  target_stock INT NOT NULL DEFAULT 150,
  preferred_supplier_id INT NOT NULL,
  rack_location VARCHAR(40) NOT NULL,
  requires_rx TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (preferred_supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  medicine_id INT NOT NULL,
  batch_no VARCHAR(60) NOT NULL,
  mfg_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  qty_available INT NOT NULL DEFAULT 0,
  cost_price DECIMAL(10,2) NOT NULL,
  mrp DECIMAL(10,2) NOT NULL,
  rack_location VARCHAR(40) NOT NULL,
  status ENUM('active','quarantined') NOT NULL DEFAULT 'active',
  FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  INDEX idx_fefo (medicine_id, status, expiry_date)
);

CREATE TABLE drug_interactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  generic_a VARCHAR(120) NOT NULL,
  generic_b VARCHAR(120) NOT NULL,
  severity ENUM('Mild','Moderate','Severe') NOT NULL,
  clinical_effect TEXT NOT NULL,
  recommendation TEXT NOT NULL
);` as unknown as T;
  }

  throw new Error(`Unsupported endpoint: ${url}`);
}
