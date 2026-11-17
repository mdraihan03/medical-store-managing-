import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'medoryx.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function addDaysIso(offsetDays: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function addDaysTimestamp(offsetDays: number, hour = 11, minute = 15): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Admin', 'Pharmacist', 'Store Staff')),
      license_no TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_person TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      gstin TEXT NOT NULL,
      city TEXT NOT NULL,
      lead_time_days INTEGER NOT NULL DEFAULT 2
    );

    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_name TEXT NOT NULL,
      generic_name TEXT NOT NULL,
      strength TEXT NOT NULL,
      dosage_form TEXT NOT NULL,
      category TEXT NOT NULL,
      hsn_code TEXT NOT NULL,
      gst_rate INTEGER NOT NULL DEFAULT 12,
      reorder_level INTEGER NOT NULL DEFAULT 50,
      target_stock INTEGER NOT NULL DEFAULT 150,
      preferred_supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      rack_location TEXT NOT NULL,
      requires_rx INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_id INTEGER NOT NULL REFERENCES medicines(id),
      batch_no TEXT NOT NULL,
      mfg_date TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      qty_available INTEGER NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL,
      mrp REAL NOT NULL,
      rack_location TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'quarantined')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drug_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generic_a TEXT NOT NULL,
      generic_b TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('Mild', 'Moderate', 'Severe')),
      clinical_effect TEXT NOT NULL,
      recommendation TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS emr_prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rx_code TEXT NOT NULL UNIQUE,
      patient_name TEXT NOT NULL,
      patient_age INTEGER NOT NULL,
      patient_gender TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      allergies TEXT NOT NULL DEFAULT 'None',
      doctor_name TEXT NOT NULL,
      department TEXT NOT NULL,
      emr_notes TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'Reviewed', 'Dispensed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS emr_prescription_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prescription_id INTEGER NOT NULL REFERENCES emr_prescriptions(id) ON DELETE CASCADE,
      medicine_id INTEGER NOT NULL REFERENCES medicines(id),
      dosage_instruction TEXT NOT NULL,
      prescribed_qty INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL DEFAULT '',
      rx_id INTEGER REFERENCES emr_prescriptions(id),
      payment_method TEXT NOT NULL CHECK(payment_method IN ('Cash', 'UPI', 'Card', 'Insurance')),
      payment_ref TEXT NOT NULL DEFAULT '',
      subtotal REAL NOT NULL,
      cgst_total REAL NOT NULL,
      sgst_total REAL NOT NULL,
      grand_total REAL NOT NULL,
      interaction_ack_by TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      medicine_id INTEGER NOT NULL REFERENCES medicines(id),
      brand_name TEXT NOT NULL,
      generic_name TEXT NOT NULL,
      hsn_code TEXT NOT NULL,
      batch_id INTEGER NOT NULL REFERENCES batches(id),
      batch_no TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      qty INTEGER NOT NULL,
      mrp REAL NOT NULL,
      gst_rate INTEGER NOT NULL,
      cgst_amount REAL NOT NULL,
      sgst_amount REAL NOT NULL,
      line_total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS returns_reconciliation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_type TEXT NOT NULL CHECK(return_type IN ('Customer Return', 'Damaged Stock', 'Expired Write-Off')),
      invoice_no TEXT,
      medicine_id INTEGER NOT NULL REFERENCES medicines(id),
      batch_id INTEGER NOT NULL REFERENCES batches(id),
      qty INTEGER NOT NULL,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      restocked INTEGER NOT NULL DEFAULT 0,
      processed_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_number TEXT NOT NULL UNIQUE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft', 'Sent', 'Received')),
      total_amount REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      emailed_at TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      medicine_id INTEGER NOT NULL REFERENCES medicines(id),
      qty_ordered INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      line_total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grn_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grn_number TEXT NOT NULL UNIQUE,
      po_id INTEGER REFERENCES purchase_orders(id),
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      invoice_ref TEXT NOT NULL,
      total_cost REAL NOT NULL,
      received_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action_type TEXT NOT NULL,
      entity TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_batches_fefo ON batches(medicine_id, status, expiry_date);
    CREATE INDEX IF NOT EXISTS idx_batches_expiry ON batches(expiry_date, qty_available);
    CREATE INDEX IF NOT EXISTS idx_invoice_items_inv ON invoice_items(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_items_med ON invoice_items(medicine_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at);
    CREATE INDEX IF NOT EXISTS idx_rx_items_rx ON emr_prescription_items(prescription_id);
    CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(po_id);
  `);

  const userCount = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
  if (userCount === 0) {
    seedInitialData();
  }
}

function seedInitialData(): void {
  const seedTx = db.transaction(() => {
    const insertUser = db.prepare(
      'INSERT INTO users (name, email, password, role, license_no) VALUES (?, ?, ?, ?, ?)'
    );
    insertUser.run('Dr. Arvind Mehta', 'admin@medoryx.in', 'admin123', 'Admin', 'MH-ADM-2019-0041');
    insertUser.run('Priya Nair, RPh', 'pharmacist@medoryx.in', 'pharma123', 'Pharmacist', 'MH-RPH-2021-8842');
    insertUser.run('Rohan Kulkarni', 'staff@medoryx.in', 'staff123', 'Store Staff', 'MH-STF-2024-1129');

    const insertSupplier = db.prepare(
      'INSERT INTO suppliers (name, contact_person, phone, email, gstin, city, lead_time_days) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const sup1 = Number(
      insertSupplier.run(
        'Cipla MedLife Distributors',
        'Sandeep Deshpande',
        '+91 98204 11230',
        'orders@ciplamedlife.in',
        '27AABCC1234D1Z5',
        'Mumbai',
        2
      ).lastInsertRowid
    );
    const sup2 = Number(
      insertSupplier.run(
        'Sun Pharma Wholesale Depot',
        'Neha Parekh',
        '+91 98981 44512',
        'supply@sunwholesale.in',
        '24AADCS5678E1Z2',
        'Ahmedabad',
        3
      ).lastInsertRowid
    );
    const sup3 = Number(
      insertSupplier.run(
        'Apollo HealthCare Logistics',
        'Karthik Subramanian',
        '+91 99002 77341',
        'procurement@apollologistics.in',
        '29AABCA9012F1Z8',
        'Bengaluru',
        1
      ).lastInsertRowid
    );
    const sup4 = Number(
      insertSupplier.run(
        "Dr. Reddy's Regional Stockist",
        'Anjali Verma',
        '+91 98490 66219',
        'dispatch@drreddysstock.in',
        '36AABCD3456G1Z9',
        'Hyderabad',
        2
      ).lastInsertRowid
    );

    const insertMed = db.prepare(`
      INSERT INTO medicines (
        brand_name, generic_name, strength, dosage_form, category, hsn_code,
        gst_rate, reorder_level, target_stock, preferred_supplier_id, rack_location, requires_rx
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const mWarf = Number(insertMed.run('Warf-5', 'Warfarin Sodium', '5 mg', 'Tablet', 'Anticoagulant', '30049099', 12, 40, 120, sup1, 'A-01', 1).lastInsertRowid);
    const mEcosprin = Number(insertMed.run('Ecosprin-75', 'Aspirin', '75 mg', 'Tablet', 'Antiplatelet', '30049099', 5, 80, 240, sup2, 'A-02', 0).lastInsertRowid);
    const mLoprin = Number(insertMed.run('Loprin-75', 'Aspirin', '75 mg', 'Tablet', 'Antiplatelet', '30049099', 5, 60, 180, sup3, 'A-02', 0).lastInsertRowid);
    const mAugmentin = Number(insertMed.run('Augmentin 625 Duo', 'Amoxicillin + Clavulanic Acid', '625 mg', 'Tablet', 'Antibiotic', '30041020', 12, 50, 160, sup1, 'B-04', 1).lastInsertRowid);
    const mMoxikind = Number(insertMed.run('Moxikind-CV 625', 'Amoxicillin + Clavulanic Acid', '625 mg', 'Tablet', 'Antibiotic', '30041020', 12, 45, 140, sup1, 'B-04', 1).lastInsertRowid);
    const mClavam = Number(insertMed.run('Clavam 625', 'Amoxicillin + Clavulanic Acid', '625 mg', 'Tablet', 'Antibiotic', '30041020', 12, 40, 140, sup3, 'B-05', 1).lastInsertRowid);
    const mDolo = Number(insertMed.run('Dolo 650', 'Paracetamol', '650 mg', 'Tablet', 'Analgesic', '30049011', 12, 120, 360, sup3, 'C-01', 0).lastInsertRowid);
    const mCalpol = Number(insertMed.run('Calpol 650', 'Paracetamol', '650 mg', 'Tablet', 'Analgesic', '30049011', 12, 100, 300, sup4, 'C-01', 0).lastInsertRowid);
    const mGlycomet = Number(insertMed.run('Glycomet-GP 1', 'Metformin + Glimepiride', '500mg/1mg', 'Tablet', 'Antidiabetic', '30049099', 5, 90, 240, sup2, 'D-02', 1).lastInsertRowid);
    const mCiplox = Number(insertMed.run('Ciplox 500', 'Ciprofloxacin', '500 mg', 'Tablet', 'Antibiotic', '30042019', 12, 40, 120, sup1, 'B-07', 1).lastInsertRowid);
    const mAtorva = Number(insertMed.run('Atorva 20', 'Atorvastatin', '20 mg', 'Tablet', 'Cardiovascular', '30049099', 12, 60, 180, sup4, 'A-06', 1).lastInsertRowid);
    const mTonact = Number(insertMed.run('Tonact 20', 'Atorvastatin', '20 mg', 'Tablet', 'Cardiovascular', '30049099', 12, 50, 150, sup2, 'A-06', 1).lastInsertRowid);
    const mAzithral = Number(insertMed.run('Azithral 500', 'Azithromycin', '500 mg', 'Tablet', 'Antibiotic', '30042031', 12, 45, 150, sup1, 'B-09', 1).lastInsertRowid);
    const mPanD = Number(insertMed.run('Pan-D', 'Pantoprazole + Domperidone', '40mg/30mg', 'Capsule', 'Gastrointestinal', '30049099', 12, 100, 300, sup4, 'C-05', 0).lastInsertRowid);
    const mPantocid = Number(insertMed.run('Pantocid-D SR', 'Pantoprazole + Domperidone', '40mg/30mg', 'Capsule', 'Gastrointestinal', '30049099', 12, 60, 180, sup2, 'C-05', 0).lastInsertRowid);
    const mBrufen = Number(insertMed.run('Brufen 400', 'Ibuprofen', '400 mg', 'Tablet', 'NSAID', '30049061', 12, 60, 180, sup3, 'C-08', 0).lastInsertRowid);
    const mLantus = Number(insertMed.run('Lantus SoloStar', 'Insulin Glargine', '100 IU/mL', 'Pen Injector', 'Biologic / Cold Chain', '30043110', 5, 15, 40, sup3, 'FRIDGE-1', 1).lastInsertRowid);
    const mBecosules = Number(insertMed.run('Becosules-Z', 'B-Complex + Zinc', 'Capsules', 'Capsule', 'Nutraceutical', '30045020', 18, 70, 220, sup4, 'E-01', 0).lastInsertRowid);

    // Note: Loprin-75 (mLoprin), Augmentin 625 Duo (mAugmentin), Atorva 20 (mAtorva) intentionally have 0 active stock to demonstrate Brand-Swap + Reorder List!
    const insertBatch = db.prepare(`
      INSERT INTO batches (medicine_id, batch_no, mfg_date, expiry_date, qty_available, cost_price, mrp, rack_location, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Warf-5: Red (<30d) batch + healthy batch
    const bWarfRed = Number(insertBatch.run(mWarf, 'WRF-2601', addDaysIso(-346), addDaysIso(19), 28, 3.80, 6.20, 'A-01', 'active').lastInsertRowid);
    insertBatch.run(mWarf, 'WRF-2614', addDaysIso(-90), addDaysIso(320), 65, 3.95, 6.40, 'A-01', 'active');

    // Ecosprin-75: Amber (30-60d) batch + healthy batch
    const bEcoAmber = Number(insertBatch.run(mEcosprin, 'ECO-4410', addDaysIso(-320), addDaysIso(44), 120, 0.45, 0.85, 'A-02', 'active').lastInsertRowid);
    insertBatch.run(mEcosprin, 'ECO-4502', addDaysIso(-60), addDaysIso(280), 210, 0.48, 0.85, 'A-02', 'active');

    // Moxikind-CV 625: Red (<30d) batch + healthy batch
    insertBatch.run(mMoxikind, 'MXK-8821', addDaysIso(-340), addDaysIso(25), 36, 14.50, 22.80, 'B-04', 'active');
    const bMoxSafe = Number(insertBatch.run(mMoxikind, 'MXK-9014', addDaysIso(-80), addDaysIso(240), 74, 15.10, 23.00, 'B-04', 'active').lastInsertRowid);

    // Clavam 625: Green (61-90d) shelf batch
    insertBatch.run(mClavam, 'CLV-3319', addDaysIso(-285), addDaysIso(78), 75, 16.00, 24.50, 'B-05', 'active');

    // Dolo 650: Amber (30-60d) batch (total 85 <= reorder 120!)
    const bDoloAmber = Number(insertBatch.run(mDolo, 'DOL-7712', addDaysIso(-310), addDaysIso(52), 85, 1.45, 2.25, 'C-01', 'active').lastInsertRowid);

    // Calpol 650: Healthy stock
    insertBatch.run(mCalpol, 'CPL-5022', addDaysIso(-120), addDaysIso(365), 240, 1.40, 2.20, 'C-01', 'active');

    // Glycomet-GP 1: Low stock (32 <= 90) + 1 Expired batch (-14d) quarantined!
    insertBatch.run(mGlycomet, 'GLY-1009', addDaysIso(-500), addDaysIso(-14), 24, 9.20, 14.80, 'D-02', 'quarantined');
    insertBatch.run(mGlycomet, 'GLY-2188', addDaysIso(-180), addDaysIso(195), 32, 9.50, 15.00, 'D-02', 'active');

    // Ciplox 500: Green (61-90d) batch
    insertBatch.run(mCiplox, 'CPX-6102', addDaysIso(-295), addDaysIso(68), 90, 4.10, 6.80, 'B-07', 'active');

    // Tonact 20: Amber (30-60d) + healthy
    insertBatch.run(mTonact, 'TON-3091', addDaysIso(-325), addDaysIso(39), 42, 8.90, 14.20, 'A-06', 'active');
    insertBatch.run(mTonact, 'TON-3145', addDaysIso(-90), addDaysIso(310), 53, 9.10, 14.20, 'A-06', 'active');

    // Azithral 500: Red (<30d) + healthy
    insertBatch.run(mAzithral, 'AZT-5501', addDaysIso(-350), addDaysIso(14), 30, 17.80, 26.50, 'B-09', 'active');
    insertBatch.run(mAzithral, 'AZT-5640', addDaysIso(-60), addDaysIso(290), 100, 18.20, 26.50, 'B-09', 'active');

    // Pan-D: Low stock (64 <= 100), fast-mover
    const bPanD = Number(insertBatch.run(mPanD, 'PND-9120', addDaysIso(-140), addDaysIso(215), 64, 11.40, 19.90, 'C-05', 'active').lastInsertRowid);

    // Pantocid-D SR: Healthy
    insertBatch.run(mPantocid, 'PTD-4411', addDaysIso(-95), addDaysIso(330), 160, 10.80, 18.50, 'C-05', 'active');

    // Brufen 400: Green (61-90d) + Expired (-28d)
    insertBatch.run(mBrufen, 'BRF-1044', addDaysIso(-540), addDaysIso(-28), 35, 1.85, 3.10, 'C-08', 'quarantined');
    insertBatch.run(mBrufen, 'BRF-2290', addDaysIso(-280), addDaysIso(84), 85, 1.95, 3.20, 'C-08', 'active');

    // Lantus SoloStar: Red (<30d) high-value cold chain item + low stock (9 <= 15)
    insertBatch.run(mLantus, 'LNT-8801', addDaysIso(-335), addDaysIso(27), 9, 465.00, 625.00, 'FRIDGE-1', 'active');

    // Becosules-Z: Healthy fast-mover (18% GST)
    const bBeco = Number(insertBatch.run(mBecosules, 'BEC-6632', addDaysIso(-100), addDaysIso(260), 190, 2.40, 4.10, 'E-01', 'active').lastInsertRowid);

    // Seed Drug Interactions Matrix
    const insertInteraction = db.prepare(`
      INSERT INTO drug_interactions (generic_a, generic_b, severity, clinical_effect, recommendation)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertInteraction.run(
      'Warfarin',
      'Aspirin',
      'Severe',
      'Markedly elevated risk of major gastrointestinal and intracranial bleeding due to combined anticoagulant and antiplatelet activity.',
      'Avoid concurrent dispensing unless explicitly confirmed by prescribing cardiologist; counsel on bleeding signs and INR monitoring.'
    );
    insertInteraction.run(
      'Warfarin',
      'Ibuprofen',
      'Severe',
      'NSAIDs inhibit platelet aggregation, erode gastric mucosa, and displace warfarin from plasma albumin, sharply increasing hemorrhage risk.',
      'Substitute Paracetamol for pain relief or obtain direct physician override before dispensing.'
    );
    insertInteraction.run(
      'Metformin',
      'Ciprofloxacin',
      'Moderate',
      'Fluoroquinolones can interfere with glucose regulation and trigger unpredictable hypoglycemia or hyperglycemia in diabetic patients.',
      'Advise frequent blood glucose monitoring throughout the antibiotic course.'
    );
    insertInteraction.run(
      'Atorvastatin',
      'Azithromycin',
      'Moderate',
      'Concurrent macrolide therapy can elevate statin plasma levels, increasing risk of statin-associated myopathy.',
      'Counsel patient to report unexplained muscle soreness, cramps, or dark urine promptly.'
    );
    insertInteraction.run(
      'Aspirin',
      'Ibuprofen',
      'Moderate',
      'Ibuprofen competitively blocks the irreversible antiplatelet cardioprotective binding of low-dose Aspirin.',
      'Take Aspirin at least 2 hours before Ibuprofen or switch analgesic to Paracetamol.'
    );
    insertInteraction.run(
      'Pantoprazole',
      'Warfarin',
      'Mild',
      'Proton pump inhibitors may modestly reduce warfarin clearance via CYP2C19 inhibition in susceptible patients.',
      'Monitor INR if Pantoprazole is newly added to stable Warfarin therapy.'
    );

    // Seed EMR Digital Prescriptions
    const insertRx = db.prepare(`
      INSERT INTO emr_prescriptions (
        rx_code, patient_name, patient_age, patient_gender, patient_phone,
        allergies, doctor_name, department, emr_notes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRxItem = db.prepare(`
      INSERT INTO emr_prescription_items (prescription_id, medicine_id, dosage_instruction, prescribed_qty)
      VALUES (?, ?, ?, ?)
    `);

    const rx1 = Number(
      insertRx.run(
        'RX-2026-1041',
        'Ramesh Deshmukh',
        64,
        'Male',
        '+91 98230 55102',
        'Sulfa Drugs',
        'Dr. Kavita Rao',
        'Cardiology OPD',
        'Post-stent anticoagulation review. Verify INR target 2.0-3.0 and evaluate antiplatelet overlap.',
        'Pending',
        addDaysTimestamp(0, 9, 20)
      ).lastInsertRowid
    );
    insertRxItem.run(rx1, mWarf, '1 tab OD at 8 PM after dinner', 15);
    insertRxItem.run(rx1, mLoprin, '1 tab OD after lunch (brand-swap if unavailable)', 30);
    insertRxItem.run(rx1, mAtorva, '1 tab HS at bedtime', 30);

    const rx2 = Number(
      insertRx.run(
        'RX-2026-1042',
        'Sneha Kulkarni',
        38,
        'Female',
        '+91 97654 22198',
        'None known',
        'Dr. Vikram Joshi',
        'General Medicine',
        'Acute bacterial sinusitis with fever. 5-day oral antibiotic regimen.',
        'Pending',
        addDaysTimestamp(0, 10, 5)
      ).lastInsertRowid
    );
    insertRxItem.run(rx2, mAugmentin, '1 tab BD after food for 5 days', 10);
    insertRxItem.run(rx2, mPanD, '1 cap OD before breakfast', 10);
    insertRxItem.run(rx2, mDolo, '1 tab SOS for fever > 100F', 15);

    const rx3 = Number(
      insertRx.run(
        'RX-2026-1043',
        'Mohammed Tariq',
        52,
        'Male',
        '+91 99210 88412',
        'Penicillin',
        'Dr. Ananya Sen',
        'Endocrinology',
        'T2DM follow-up with UTI symptoms. Monitor fasting capillary glucose during Ciprofloxacin course.',
        'Pending',
        addDaysTimestamp(0, 10, 42)
      ).lastInsertRowid
    );
    insertRxItem.run(rx3, mGlycomet, '1 tab BD before meals', 30);
    insertRxItem.run(rx3, mCiplox, '1 tab BD for 5 days', 10);
    insertRxItem.run(rx3, mLantus, '14 units SC HS daily', 2);

    const rx4 = Number(
      insertRx.run(
        'RX-2026-1044',
        'Meera Iyer',
        29,
        'Female',
        '+91 98192 44019',
        'None known',
        'Dr. Suresh Nair',
        'ENT Clinic',
        'Completed morning dispensing.',
        'Dispensed',
        addDaysTimestamp(0, 8, 45)
      ).lastInsertRowid
    );
    insertRxItem.run(rx4, mMoxikind, '1 tab BD for 5 days', 10);
    insertRxItem.run(rx4, mBecosules, '1 cap OD after breakfast', 15);

    // Seed Historical & Today's Invoices for Sales, Trends & Fast-Moving Items
    const insertInvoice = db.prepare(`
      INSERT INTO invoices (
        invoice_no, customer_name, customer_phone, rx_id, payment_method, payment_ref,
        subtotal, cgst_total, sgst_total, grand_total, interaction_ack_by, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertInvItem = db.prepare(`
      INSERT INTO invoice_items (
        invoice_id, medicine_id, brand_name, generic_name, hsn_code, batch_id,
        batch_no, expiry_date, qty, mrp, gst_rate, cgst_amount, sgst_amount, line_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const seedInvoices: Array<{
      no: string;
      customer: string;
      phone: string;
      rxId: number | null;
      method: 'Cash' | 'UPI' | 'Card' | 'Insurance';
      ref: string;
      dayOffset: number;
      items: Array<{
        medId: number;
        brand: string;
        generic: string;
        hsn: string;
        batchId: number;
        batchNo: string;
        expOffset: number;
        qty: number;
        mrp: number;
        gst: number;
      }>;
    }> = [
      {
        no: 'INV-2026-0891',
        customer: 'Suresh Patil',
        phone: '+91 98221 10394',
        rxId: null,
        method: 'UPI',
        ref: 'UPI-431982011',
        dayOffset: -6,
        items: [
          { medId: mDolo, brand: 'Dolo 650', generic: 'Paracetamol', hsn: '30049011', batchId: bDoloAmber, batchNo: 'DOL-7712', expOffset: 52, qty: 45, mrp: 2.25, gst: 12 },
          { medId: mPanD, brand: 'Pan-D', generic: 'Pantoprazole + Domperidone', hsn: '30049099', batchId: bPanD, batchNo: 'PND-9120', expOffset: 215, qty: 30, mrp: 19.90, gst: 12 },
        ],
      },
      {
        no: 'INV-2026-0892',
        customer: 'Kavita Menon',
        phone: '+91 98451 90211',
        rxId: null,
        method: 'Card',
        ref: 'CARD-VISA-8841',
        dayOffset: -5,
        items: [
          { medId: mBecosules, brand: 'Becosules-Z', generic: 'B-Complex + Zinc', hsn: '30045020', batchId: bBeco, batchNo: 'BEC-6632', expOffset: 260, qty: 60, mrp: 4.10, gst: 18 },
          { medId: mEcosprin, brand: 'Ecosprin-75', generic: 'Aspirin', hsn: '30049099', batchId: bEcoAmber, batchNo: 'ECO-4410', expOffset: 44, qty: 90, mrp: 0.85, gst: 5 },
        ],
      },
      {
        no: 'INV-2026-0893',
        customer: 'Harish Bhatia',
        phone: '+91 99102 33210',
        rxId: null,
        method: 'Insurance',
        ref: 'STAR-POL-994120',
        dayOffset: -4,
        items: [
          { medId: mMoxikind, brand: 'Moxikind-CV 625', generic: 'Amoxicillin + Clavulanic Acid', hsn: '30041020', batchId: bMoxSafe, batchNo: 'MXK-9014', expOffset: 240, qty: 40, mrp: 23.00, gst: 12 },
          { medId: mDolo, brand: 'Dolo 650', generic: 'Paracetamol', hsn: '30049011', batchId: bDoloAmber, batchNo: 'DOL-7712', expOffset: 52, qty: 60, mrp: 2.25, gst: 12 },
        ],
      },
      {
        no: 'INV-2026-0894',
        customer: 'Nandini Rao',
        phone: '+91 98801 77421',
        rxId: null,
        method: 'UPI',
        ref: 'UPI-432098712',
        dayOffset: -2,
        items: [
          { medId: mPanD, brand: 'Pan-D', generic: 'Pantoprazole + Domperidone', hsn: '30049099', batchId: bPanD, batchNo: 'PND-9120', expOffset: 215, qty: 50, mrp: 19.90, gst: 12 },
          { medId: mBecosules, brand: 'Becosules-Z', generic: 'B-Complex + Zinc', hsn: '30045020', batchId: bBeco, batchNo: 'BEC-6632', expOffset: 260, qty: 45, mrp: 4.10, gst: 18 },
        ],
      },
      {
        no: 'INV-2026-0895',
        customer: 'Vikramaditya Sen',
        phone: '+91 98301 51099',
        rxId: null,
        method: 'Cash',
        ref: 'CASH-COUNTER-1',
        dayOffset: -1,
        items: [
          { medId: mWarf, brand: 'Warf-5', generic: 'Warfarin Sodium', hsn: '30049099', batchId: bWarfRed, batchNo: 'WRF-2601', expOffset: 19, qty: 30, mrp: 6.20, gst: 12 },
          { medId: mDolo, brand: 'Dolo 650', generic: 'Paracetamol', hsn: '30049011', batchId: bDoloAmber, batchNo: 'DOL-7712', expOffset: 52, qty: 50, mrp: 2.25, gst: 12 },
        ],
      },
      {
        no: 'INV-2026-0896',
        customer: 'Meera Iyer',
        phone: '+91 98192 44019',
        rxId: rx4,
        method: 'UPI',
        ref: 'UPI-432551290',
        dayOffset: 0,
        items: [
          { medId: mMoxikind, brand: 'Moxikind-CV 625', generic: 'Amoxicillin + Clavulanic Acid', hsn: '30041020', batchId: bMoxSafe, batchNo: 'MXK-9014', expOffset: 240, qty: 10, mrp: 23.00, gst: 12 },
          { medId: mBecosules, brand: 'Becosules-Z', generic: 'B-Complex + Zinc', hsn: '30045020', batchId: bBeco, batchNo: 'BEC-6632', expOffset: 260, qty: 15, mrp: 4.10, gst: 18 },
          { medId: mPanD, brand: 'Pan-D', generic: 'Pantoprazole + Domperidone', hsn: '30049099', batchId: bPanD, batchNo: 'PND-9120', expOffset: 215, qty: 10, mrp: 19.90, gst: 12 },
        ],
      },
    ];

    for (const inv of seedInvoices) {
      let subtotal = 0;
      let cgstTotal = 0;
      let sgstTotal = 0;
      let grandTotal = 0;
      const computed = inv.items.map((it) => {
        const gross = Number((it.qty * it.mrp).toFixed(2));
        const base = Number((gross / (1 + it.gst / 100)).toFixed(2));
        const tax = Number((gross - base).toFixed(2));
        const cgst = Number((tax / 2).toFixed(2));
        const sgst = Number((tax - cgst).toFixed(2));
        subtotal += base;
        cgstTotal += cgst;
        sgstTotal += sgst;
        grandTotal += gross;
        return { ...it, cgst, sgst, gross };
      });
      const invId = Number(
        insertInvoice.run(
          inv.no,
          inv.customer,
          inv.phone,
          inv.rxId,
          inv.method,
          inv.ref,
          Number(subtotal.toFixed(2)),
          Number(cgstTotal.toFixed(2)),
          Number(sgstTotal.toFixed(2)),
          Number(grandTotal.toFixed(2)),
          null,
          'Priya Nair, RPh',
          addDaysTimestamp(inv.dayOffset, 10, 30)
        ).lastInsertRowid
      );
      for (const it of computed) {
        insertInvItem.run(
          invId,
          it.medId,
          it.brand,
          it.generic,
          it.hsn,
          it.batchId,
          it.batchNo,
          addDaysIso(it.expOffset),
          it.qty,
          it.mrp,
          it.gst,
          it.cgst,
          it.sgst,
          it.gross
        );
      }
    }

    // Seed Purchase Orders & GRN
    const insertPo = db.prepare(`
      INSERT INTO purchase_orders (po_number, supplier_id, status, total_amount, notes, emailed_at, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPoItem = db.prepare(`
      INSERT INTO purchase_order_items (po_id, medicine_id, qty_ordered, unit_cost, line_total)
      VALUES (?, ?, ?, ?, ?)
    `);

    const po1 = Number(
      insertPo.run(
        'PO-2026-0311',
        sup1,
        'Sent',
        2140.00,
        'Priority restock for Augmentin 625 Duo out-of-stock shelf.',
        addDaysTimestamp(-1, 14, 15),
        'Dr. Arvind Mehta',
        addDaysTimestamp(-1, 14, 10)
      ).lastInsertRowid
    );
    insertPoItem.run(po1, mAugmentin, 100, 16.50, 1650.00);
    insertPoItem.run(po1, mWarf, 120, 4.08, 490.00);

    const po2 = Number(
      insertPo.run(
        'PO-2026-0308',
        sup3,
        'Received',
        1860.00,
        'Routine analgesic and cold-chain replenishment.',
        addDaysTimestamp(-4, 11, 0),
        'Dr. Arvind Mehta',
        addDaysTimestamp(-4, 10, 45)
      ).lastInsertRowid
    );
    insertPoItem.run(po2, mCalpol, 240, 1.40, 336.00);
    insertPoItem.run(po2, mLantus, 3, 465.00, 1395.00);

    db.prepare(`
      INSERT INTO grn_records (grn_number, po_id, supplier_id, invoice_ref, total_cost, received_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('GRN-2026-0192', po2, sup3, 'APL-GST-77120', 1860.00, 'Rohan Kulkarni', addDaysTimestamp(-3, 16, 20));

    // Seed Return & Reconciliation history
    const brufenBatch = db.prepare('SELECT id FROM batches WHERE medicine_id = ? LIMIT 1').get(mBrufen) as { id: number };
    db.prepare(`
      INSERT INTO returns_reconciliation (return_type, invoice_no, medicine_id, batch_id, qty, amount, reason, restocked, processed_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Damaged Stock',
      null,
      mBrufen,
      brufenBatch.id,
      5,
      9.75,
      'Blister strip crushed during shelf reorganization',
      0,
      'Rohan Kulkarni',
      addDaysTimestamp(-2, 15, 40)
    );

    // Seed Audit Logs
    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (actor_name, actor_role, action_type, entity, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertAudit.run('Dr. Arvind Mehta', 'Admin', 'PO_DISPATCH', 'PO-2026-0311', 'Emailed purchase order to orders@ciplamedlife.in (₹2,140.00)', addDaysTimestamp(-1, 14, 15));
    insertAudit.run('Rohan Kulkarni', 'Store Staff', 'GRN_INTAKE', 'GRN-2026-0192', 'Received stock against PO-2026-0308 and updated batch inventory', addDaysTimestamp(-3, 16, 20));
    insertAudit.run('Priya Nair, RPh', 'Pharmacist', 'RX_DISPENSE', 'RX-2026-1044', 'Dispensed digital prescription RX-2026-1044 via FEFO invoice INV-2026-0896', addDaysTimestamp(0, 8, 45));
    insertAudit.run('Rohan Kulkarni', 'Store Staff', 'RETURN_RECONCILE', 'BRF-2290', 'Quarantined 5 damaged units of Brufen 400 (₹9.75 loss)', addDaysTimestamp(-2, 15, 40));
  });

  seedTx();
}

export default db;
