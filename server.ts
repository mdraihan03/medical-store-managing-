import express from 'express';
import path from 'path';
import zlib from 'node:zlib';
import db, { initDatabase } from './server/db.ts';
import type {
  BrandSwapOption,
  DrugInteractionAlert,
  FefoAllocation,
  BillingLinePreview,
  UserRole,
} from './src/types.ts';

initDatabase();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

function logAudit(actorName: string, actorRole: string, actionType: string, entity: string, details: string): void {
  db.prepare(
    'INSERT INTO audit_logs (actor_name, actor_role, action_type, entity, details) VALUES (?, ?, ?, ?, ?)'
  ).run(actorName, actorRole, actionType, entity, details);
}

function findBrandSwaps(medicineId: number, genericName: string): BrandSwapOption[] {
  const primaryIngredient = genericName.split('+')[0].trim().toLowerCase();
  const rows = db
    .prepare(
      `
      SELECT
        m.id as medicine_id,
        m.brand_name,
        m.generic_name,
        m.strength,
        m.gst_rate,
        COALESCE(SUM(CASE WHEN b.status = 'active' AND date(b.expiry_date) > date('now') THEN b.qty_available ELSE 0 END), 0) as total_active_stock,
        MIN(CASE WHEN b.status = 'active' AND date(b.expiry_date) > date('now') AND b.qty_available > 0 THEN b.expiry_date ELSE NULL END) as earliest_expiry,
        COALESCE(AVG(CASE WHEN b.status = 'active' AND date(b.expiry_date) > date('now') AND b.qty_available > 0 THEN b.mrp ELSE NULL END), 0) as mrp
      FROM medicines m
      LEFT JOIN batches b ON b.medicine_id = m.id
      WHERE m.id != ?
        AND (LOWER(m.generic_name) = LOWER(?) OR LOWER(m.generic_name) LIKE ?)
      GROUP BY m.id
      HAVING total_active_stock > 0
      ORDER BY total_active_stock DESC
      `
    )
    .all(medicineId, genericName, `%${primaryIngredient}%`) as BrandSwapOption[];

  return rows.map((r) => ({
    ...r,
    mrp: Number((r.mrp || 0).toFixed(2)),
  }));
}

type InteractionRule = {
  id: number;
  generic_a: string;
  generic_b: string;
  severity: 'Mild' | 'Moderate' | 'Severe';
  clinical_effect: string;
  recommendation: string;
};

let cachedInteractionRules: InteractionRule[] | null = null;
function getInteractionRules(): InteractionRule[] {
  if (!cachedInteractionRules) {
    cachedInteractionRules = db.prepare('SELECT * FROM drug_interactions').all() as InteractionRule[];
  }
  return cachedInteractionRules;
}

function checkInteractionsForMedicines(
  meds: Array<{ medicine_id: number; brand_name: string; generic_name: string }>
): DrugInteractionAlert[] {
  if (meds.length < 2) return [];
  const rules = getInteractionRules();

  const alerts: DrugInteractionAlert[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < meds.length; i++) {
    for (let j = i + 1; j < meds.length; j++) {
      const m1 = meds[i];
      const m2 = meds[j];
      const g1 = m1.generic_name.toLowerCase();
      const g2 = m2.generic_name.toLowerCase();

      for (const rule of rules) {
        const ra = rule.generic_a.toLowerCase();
        const rb = rule.generic_b.toLowerCase();
        const forward = g1.includes(ra) && g2.includes(rb);
        const reverse = g1.includes(rb) && g2.includes(ra);
        if (forward || reverse) {
          const key = `${rule.id}-${Math.min(m1.medicine_id, m2.medicine_id)}-${Math.max(m1.medicine_id, m2.medicine_id)}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            alerts.push({
              id: rule.id,
              generic_a: rule.generic_a,
              generic_b: rule.generic_b,
              medicine_a: m1.brand_name,
              medicine_b: m2.brand_name,
              severity: rule.severity,
              clinical_effect: rule.clinical_effect,
              recommendation: rule.recommendation,
            });
          }
        }
      }
    }
  }

  const order: Record<string, number> = { Severe: 0, Moderate: 1, Mild: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  return alerts;
}

function buildBillingPreview(items: Array<{ medicine_id: number; qty: number }>) {
  const lines: BillingLinePreview[] = [];
  const medsForInteraction: Array<{ medicine_id: number; brand_name: string; generic_name: string }> = [];

  let subtotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let grandTotal = 0;
  let hasShortfall = false;

  for (const item of items) {
    const qtyRequested = Math.max(1, Math.floor(Number(item.qty) || 1));
    const med = db.prepare('SELECT * FROM medicines WHERE id = ?').get(item.medicine_id) as
      | {
          id: number;
          brand_name: string;
          generic_name: string;
          strength: string;
          hsn_code: string;
          gst_rate: number;
        }
      | undefined;

    if (!med) continue;
    medsForInteraction.push({
      medicine_id: med.id,
      brand_name: med.brand_name,
      generic_name: med.generic_name,
    });

    const activeBatches = db
      .prepare(
        `
        SELECT * FROM batches
        WHERE medicine_id = ?
          AND status = 'active'
          AND qty_available > 0
          AND date(expiry_date) > date('now')
        ORDER BY date(expiry_date) ASC, id ASC
        `
      )
      .all(med.id) as Array<{
      id: number;
      batch_no: string;
      expiry_date: string;
      qty_available: number;
      cost_price: number;
      mrp: number;
    }>;

    const expiredBlocked = (
      db
        .prepare(
          `
          SELECT COALESCE(SUM(qty_available), 0) as qty
          FROM batches
          WHERE medicine_id = ?
            AND (date(expiry_date) <= date('now') OR status = 'quarantined')
            AND qty_available > 0
          `
        )
        .get(med.id) as { qty: number }
    ).qty;

    let remaining = qtyRequested;
    let allocatedTotal = 0;
    const allocations: FefoAllocation[] = [];
    let lineGross = 0;

    for (const batch of activeBatches) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, batch.qty_available);
      if (take > 0) {
        allocations.push({
          batch_id: batch.id,
          batch_no: batch.batch_no,
          expiry_date: batch.expiry_date,
          days_to_expiry: diffDays(batch.expiry_date),
          qty_allocated: take,
          mrp: batch.mrp,
          cost_price: batch.cost_price,
        });
        lineGross += take * batch.mrp;
        allocatedTotal += take;
        remaining -= take;
      }
    }

    const availableQty = activeBatches.reduce((sum, b) => sum + b.qty_available, 0);
    const shortfallQty = Math.max(0, qtyRequested - allocatedTotal);
    if (shortfallQty > 0) {
      hasShortfall = true;
    }

    const base = Number((lineGross / (1 + med.gst_rate / 100)).toFixed(2));
    const tax = Number((lineGross - base).toFixed(2));
    const cgst = Number((tax / 2).toFixed(2));
    const sgst = Number((tax - cgst).toFixed(2));

    subtotal += base;
    cgstTotal += cgst;
    sgstTotal += sgst;
    grandTotal += lineGross;

    const brandSwaps = shortfallQty > 0 || availableQty === 0 ? findBrandSwaps(med.id, med.generic_name) : [];

    lines.push({
      medicine_id: med.id,
      brand_name: med.brand_name,
      generic_name: med.generic_name,
      strength: med.strength,
      hsn_code: med.hsn_code,
      gst_rate: med.gst_rate,
      requested_qty: qtyRequested,
      available_qty: availableQty,
      shortfall_qty: shortfallQty,
      expired_blocked_qty: expiredBlocked,
      allocations,
      line_subtotal: base,
      cgst_amount: cgst,
      sgst_amount: sgst,
      line_total: Number(lineGross.toFixed(2)),
      brand_swaps: brandSwaps,
    });
  }

  const interactions = checkInteractionsForMedicines(medsForInteraction);
  const hasSevereInteraction = interactions.some((a) => a.severity === 'Severe');

  return {
    lines,
    interactions,
    subtotal: Number(subtotal.toFixed(2)),
    cgst_total: Number(cgstTotal.toFixed(2)),
    sgst_total: Number(sgstTotal.toFixed(2)),
    grand_total: Number(grandTotal.toFixed(2)),
    has_shortfall: hasShortfall,
    has_severe_interaction: hasSevereInteraction,
  };
}

function mapBatchRow(b: {
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
}) {
  const days = diffDays(b.expiry_date);
  const riskTier = computeRiskTier(days, b.status);
  return {
    ...b,
    days_to_expiry: days,
    risk_tier: riskTier,
    cost_value_at_risk: Number((b.qty_available * b.cost_price).toFixed(2)),
  };
}

function getDashboardData() {
  const allBatchRows = db
    .prepare(
      `
      SELECT b.*, m.brand_name, m.generic_name, m.strength, m.category, m.gst_rate, m.hsn_code
      FROM batches b
      JOIN medicines m ON m.id = b.medicine_id
      WHERE b.qty_available > 0
      ORDER BY date(b.expiry_date) ASC
      `
    )
    .all() as Parameters<typeof mapBatchRow>[0][];

  const mappedBatches = allBatchRows.map(mapBatchRow);

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

  const expiryShelf = [];

  for (const b of mappedBatches) {
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

  const reorderList = db
    .prepare(
      `
      SELECT
        m.id as medicine_id,
        m.brand_name,
        m.generic_name,
        m.strength,
        m.category,
        COALESCE(SUM(CASE WHEN b.status = 'active' AND date(b.expiry_date) > date('now') THEN b.qty_available ELSE 0 END), 0) as current_stock,
        m.reorder_level,
        m.target_stock,
        COALESCE(
          (SELECT cost_price FROM batches b2 WHERE b2.medicine_id = m.id ORDER BY b2.id DESC LIMIT 1),
          10.0
        ) as est_unit_cost,
        s.id as supplier_id,
        s.name as supplier_name,
        s.phone as supplier_phone,
        s.email as supplier_email,
        s.lead_time_days
      FROM medicines m
      JOIN suppliers s ON s.id = m.preferred_supplier_id
      LEFT JOIN batches b ON b.medicine_id = m.id
      GROUP BY m.id
      HAVING current_stock <= m.reorder_level
      ORDER BY (m.reorder_level - current_stock) DESC
      `
    )
    .all() as Array<{
    medicine_id: number;
    brand_name: string;
    generic_name: string;
    strength: string;
    category: string;
    current_stock: number;
    reorder_level: number;
    target_stock: number;
    est_unit_cost: number;
    supplier_id: number;
    supplier_name: string;
    supplier_phone: string;
    supplier_email: string;
    lead_time_days: number;
  }>;

  const formattedReorder = reorderList.map((r) => {
    const suggested = Math.max(r.target_stock - r.current_stock, r.reorder_level);
    return {
      ...r,
      est_unit_cost: Number(r.est_unit_cost.toFixed(2)),
      suggested_order_qty: suggested,
      est_order_cost: Number((suggested * r.est_unit_cost).toFixed(2)),
    };
  });

  const today = todayIso();
  const todayStats = db
    .prepare(
      `
      SELECT COALESCE(SUM(grand_total), 0) as rev, COUNT(*) as cnt
      FROM invoices
      WHERE date(created_at) = date(?)
      `
    )
    .get(today) as { rev: number; cnt: number };

  const pendingRxCount = (
    db.prepare("SELECT COUNT(*) as cnt FROM emr_prescriptions WHERE status != 'Dispensed'").get() as { cnt: number }
  ).cnt;

  const fastMoving = db
    .prepare(
      `
      SELECT
        ii.medicine_id,
        ii.brand_name,
        ii.generic_name,
        m.strength,
        SUM(ii.qty) as units_sold,
        ROUND(SUM(ii.line_total), 2) as revenue,
        COALESCE((
          SELECT SUM(qty_available) FROM batches b
          WHERE b.medicine_id = ii.medicine_id AND b.status = 'active' AND date(b.expiry_date) > date('now')
        ), 0) as current_stock
      FROM invoice_items ii
      JOIN medicines m ON m.id = ii.medicine_id
      GROUP BY ii.medicine_id
      ORDER BY units_sold DESC
      LIMIT 6
      `
    )
    .all();

  const dailySalesRows = db
    .prepare(
      `
      SELECT date(created_at) as d, COALESCE(SUM(grand_total), 0) as sales
      FROM invoices
      GROUP BY date(created_at)
      `
    )
    .all() as Array<{ d: string; sales: number }>;
  const salesByDate = new Map(dailySalesRows.map((r) => [r.d, r.sales]));

  const trends = [];
  let rollingStockVal = totalStockValue;
  for (let offset = 0; offset >= -9; offset--) {
    const dt = new Date();
    dt.setDate(dt.getDate() + offset);
    const iso = dt.toISOString().slice(0, 10);
    const label = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const daySales = Number((salesByDate.get(iso) || 0).toFixed(2));
    trends.unshift({
      date: iso,
      label,
      stock_value: Number(rollingStockVal.toFixed(2)),
      daily_sales: daySales,
    });
    rollingStockVal = Math.max(4000, rollingStockVal + daySales * 0.68 - (offset === -3 ? 1860 : 0));
  }

  return {
    kpis: {
      total_stock_value: Number(totalStockValue.toFixed(2)),
      total_mrp_value: Number(totalMrpValue.toFixed(2)),
      at_risk_90d_value: Number(atRisk90dValue.toFixed(2)),
      at_risk_90d_units: atRisk90dUnits,
      expired_quarantined_value: Number(expiredValue.toFixed(2)),
      reorder_count: formattedReorder.length,
      today_revenue: Number(todayStats.rev.toFixed(2)),
      today_invoices: todayStats.cnt,
      pending_rx_count: pendingRxCount,
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
    stock_value_trends: trends,
    fast_moving_items: fastMoving,
    reorder_list: formattedReorder,
  };
}

function getMedicinesData() {
  const rows = db
    .prepare(
      `
      SELECT
        m.*,
        s.name as preferred_supplier_name,
        s.phone as preferred_supplier_phone,
        s.email as preferred_supplier_email,
        COALESCE(SUM(CASE WHEN b.status = 'active' AND date(b.expiry_date) > date('now') THEN b.qty_available ELSE 0 END), 0) as total_active_stock,
        COALESCE(SUM(CASE WHEN b.status = 'quarantined' OR date(b.expiry_date) <= date('now') THEN b.qty_available ELSE 0 END), 0) as total_expired_stock,
        COUNT(CASE WHEN b.status = 'active' AND date(b.expiry_date) > date('now') AND b.qty_available > 0 THEN 1 ELSE NULL END) as active_batch_count,
        MIN(CASE WHEN b.status = 'active' AND date(b.expiry_date) > date('now') AND b.qty_available > 0 THEN b.expiry_date ELSE NULL END) as earliest_expiry,
        COALESCE(AVG(CASE WHEN b.status = 'active' AND date(b.expiry_date) > date('now') AND b.qty_available > 0 THEN b.mrp ELSE NULL END), 0) as avg_mrp,
        COALESCE(AVG(CASE WHEN b.status = 'active' AND date(b.expiry_date) > date('now') AND b.qty_available > 0 THEN b.cost_price ELSE NULL END), 0) as avg_cost
      FROM medicines m
      LEFT JOIN suppliers s ON s.id = m.preferred_supplier_id
      LEFT JOIN batches b ON b.medicine_id = m.id
      GROUP BY m.id
      ORDER BY m.brand_name ASC
      `
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    ...r,
    avg_mrp: Number(Number(r.avg_mrp || 0).toFixed(2)),
    avg_cost: Number(Number(r.avg_cost || 0).toFixed(2)),
  }));
}

function getBatchesData(filter?: string) {
  const rows = db
    .prepare(
      `
      SELECT b.*, m.brand_name, m.generic_name, m.strength, m.category, m.gst_rate, m.hsn_code
      FROM batches b
      JOIN medicines m ON m.id = b.medicine_id
      ORDER BY date(b.expiry_date) ASC
      `
    )
    .all() as Parameters<typeof mapBatchRow>[0][];

  let mapped = rows.map(mapBatchRow);
  if (filter === 'near_expiry') {
    mapped = mapped.filter((b) => b.qty_available > 0 && b.risk_tier !== 'expired' && b.days_to_expiry <= 90);
  } else if (filter === 'expired') {
    mapped = mapped.filter((b) => b.qty_available > 0 && b.risk_tier === 'expired');
  } else if (filter === 'active') {
    mapped = mapped.filter((b) => b.qty_available > 0 && b.risk_tier !== 'expired');
  }
  return mapped;
}

function getInvoicesData() {
  const invoices = db
    .prepare(
      `
      SELECT i.*, p.rx_code
      FROM invoices i
      LEFT JOIN emr_prescriptions p ON p.id = i.rx_id
      ORDER BY i.id DESC
      LIMIT 40
      `
    )
    .all() as Array<Record<string, unknown>>;

  if (invoices.length === 0) return [];
  const invIds = invoices.map((inv) => Number(inv.id));
  const placeholders = invIds.map(() => '?').join(',');
  const allItems = db
    .prepare(`SELECT * FROM invoice_items WHERE invoice_id IN (${placeholders}) ORDER BY id ASC`)
    .all(...invIds) as Array<Record<string, unknown>>;

  const itemsByInv = new Map<number, Array<Record<string, unknown>>>();
  for (const item of allItems) {
    const key = Number(item.invoice_id);
    const list = itemsByInv.get(key);
    if (list) list.push(item);
    else itemsByInv.set(key, [item]);
  }

  return invoices.map((inv) => ({
    ...inv,
    rx_code: inv.rx_code ?? null,
    items: itemsByInv.get(Number(inv.id)) || [],
  }));
}

function getPrescriptionsData() {
  const rxRows = db.prepare('SELECT * FROM emr_prescriptions ORDER BY id DESC').all() as Array<{
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
  }>;

  if (rxRows.length === 0) return [];

  const allItems = db
    .prepare(
      `
      SELECT
        epi.id,
        epi.prescription_id,
        epi.medicine_id,
        m.brand_name,
        m.generic_name,
        m.strength,
        epi.dosage_instruction,
        epi.prescribed_qty,
        COALESCE((
          SELECT SUM(qty_available) FROM batches b
          WHERE b.medicine_id = m.id AND b.status = 'active' AND date(b.expiry_date) > date('now')
        ), 0) as available_stock
      FROM emr_prescription_items epi
      JOIN medicines m ON m.id = epi.medicine_id
      `
    )
    .all() as Array<{
    id: number;
    prescription_id: number;
    medicine_id: number;
    brand_name: string;
    generic_name: string;
    strength: string;
    dosage_instruction: string;
    prescribed_qty: number;
    available_stock: number;
  }>;

  const itemsByRx = new Map<number, typeof allItems>();
  for (const it of allItems) {
    const list = itemsByRx.get(it.prescription_id);
    if (list) list.push(it);
    else itemsByRx.set(it.prescription_id, [it]);
  }

  const swapCache = new Map<number, BrandSwapOption[]>();

  return rxRows.map((rx) => {
    const items = itemsByRx.get(rx.id) || [];
    const enrichedItems = items.map((it) => {
      let swaps: BrandSwapOption[] = [];
      if (it.available_stock < it.prescribed_qty) {
        if (!swapCache.has(it.medicine_id)) {
          swapCache.set(it.medicine_id, findBrandSwaps(it.medicine_id, it.generic_name));
        }
        swaps = swapCache.get(it.medicine_id)!;
      }
      return { ...it, brand_swaps: swaps };
    });
    const interactions = checkInteractionsForMedicines(
      enrichedItems.map((it) => ({
        medicine_id: it.medicine_id,
        brand_name: it.brand_name,
        generic_name: it.generic_name,
      }))
    );
    return {
      ...rx,
      items: enrichedItems,
      interactions,
    };
  });
}

function getReturnsData() {
  return db
    .prepare(
      `
      SELECT r.*, m.brand_name, b.batch_no
      FROM returns_reconciliation r
      JOIN medicines m ON m.id = r.medicine_id
      JOIN batches b ON b.id = r.batch_id
      ORDER BY r.id DESC
      `
    )
    .all();
}

function getSuppliersData() {
  return db.prepare('SELECT * FROM suppliers ORDER BY name ASC').all();
}

function getPurchaseOrdersData() {
  const pos = db
    .prepare(
      `
      SELECT po.*, s.name as supplier_name, s.email as supplier_email, s.phone as supplier_phone
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      ORDER BY po.id DESC
      `
    )
    .all() as Array<Record<string, unknown>>;

  if (pos.length === 0) return [];
  const allItems = db
    .prepare(
      `
      SELECT poi.*, m.brand_name, m.generic_name
      FROM purchase_order_items poi
      JOIN medicines m ON m.id = poi.medicine_id
      `
    )
    .all() as Array<Record<string, unknown>>;

  const itemsByPo = new Map<number, Array<Record<string, unknown>>>();
  for (const it of allItems) {
    const key = Number(it.po_id);
    const list = itemsByPo.get(key);
    if (list) list.push(it);
    else itemsByPo.set(key, [it]);
  }

  return pos.map((po) => ({ ...po, items: itemsByPo.get(Number(po.id)) || [] }));
}

function getGrnData() {
  return db
    .prepare(
      `
      SELECT g.*, s.name as supplier_name, po.po_number
      FROM grn_records g
      JOIN suppliers s ON s.id = g.supplier_id
      LEFT JOIN purchase_orders po ON po.id = g.po_id
      ORDER BY g.id DESC
      `
    )
    .all();
}

export async function createApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Lightweight gzip compression for JSON API payloads
  app.use('/api', (req, res, next) => {
    const origJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const accept = String(req.headers['accept-encoding'] || '');
      const jsonStr = JSON.stringify(body);
      if (accept.includes('gzip') && jsonStr.length > 1024) {
        const compressed = zlib.gzipSync(jsonStr);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Vary', 'Accept-Encoding');
        return res.send(compressed);
      }
      return origJson(body);
    }) as typeof res.json;
    next();
  });

  // 0. Consolidated single-roundtrip workspace bootstrap
  app.get('/api/bootstrap', (_req, res) => {
    const payload = db.transaction(() => ({
      dashboard: getDashboardData(),
      medicines: getMedicinesData(),
      batches: getBatchesData(),
      prescriptions: getPrescriptionsData(),
      invoices: getInvoicesData(),
      returns: getReturnsData(),
      suppliers: getSuppliersData(),
      purchase_orders: getPurchaseOrdersData(),
      grn_records: getGrnData(),
    }))();
    res.json(payload);
  });

  // 1. Auth & Role Switcher
  app.post('/api/auth/login', (req, res) => {
    const { email, password, quickRole } = req.body as {
      email?: string;
      password?: string;
      quickRole?: UserRole;
    };

    let user:
      | { id: number; name: string; email: string; password: string; role: UserRole; license_no: string }
      | undefined;

    if (quickRole) {
      user = db.prepare('SELECT * FROM users WHERE role = ? LIMIT 1').get(quickRole) as typeof user;
    } else if (email && password) {
      user = db
        .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND password = ?')
        .get(email.trim(), password) as typeof user;
    }

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials. Check email/password or use Quick Role Access.' });
      return;
    }

    logAudit(user.name, user.role, 'AUTH_LOGIN', 'Session', `Signed in as ${user.role} (${user.email})`);
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      license_no: user.license_no,
    });
  });

  // 2. Dashboard Aggregations
  app.get('/api/dashboard', (_req, res) => {
    res.json(getDashboardData());
  });

  // 3. Medicines Catalog
  app.get('/api/medicines', (_req, res) => {
    res.json(getMedicinesData());
  });

  app.post('/api/medicines', (req, res) => {
    const {
      brand_name,
      generic_name,
      strength,
      dosage_form,
      category,
      hsn_code,
      gst_rate,
      reorder_level,
      target_stock,
      preferred_supplier_id,
      rack_location,
      requires_rx,
      actor_name = 'System',
      actor_role = 'Admin',
    } = req.body;

    if (!brand_name || !generic_name) {
      res.status(400).json({ error: 'Brand name and generic ingredient are required.' });
      return;
    }

    const info = db
      .prepare(
        `
        INSERT INTO medicines (
          brand_name, generic_name, strength, dosage_form, category, hsn_code,
          gst_rate, reorder_level, target_stock, preferred_supplier_id, rack_location, requires_rx
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        brand_name,
        generic_name,
        strength || 'Standard',
        dosage_form || 'Tablet',
        category || 'General',
        hsn_code || '30049099',
        Number(gst_rate ?? 12),
        Number(reorder_level ?? 50),
        Number(target_stock ?? 150),
        Number(preferred_supplier_id ?? 1),
        rack_location || 'A-01',
        requires_rx ? 1 : 0
      );

    logAudit(actor_name, actor_role, 'MEDICINE_CREATE', brand_name, `Added medicine ${brand_name} (${generic_name})`);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  // 4. Batches & Expiry Tracking
  app.get('/api/batches', (req, res) => {
    const { filter } = req.query as { filter?: string };
    res.json(getBatchesData(filter));
  });

  app.post('/api/batches', (req, res) => {
    const {
      medicine_id,
      batch_no,
      mfg_date,
      expiry_date,
      qty_available,
      cost_price,
      mrp,
      rack_location,
      actor_name = 'Staff',
      actor_role = 'Store Staff',
    } = req.body;

    if (!medicine_id || !batch_no || !expiry_date || !qty_available) {
      res.status(400).json({ error: 'Medicine, batch number, expiry date, and quantity are required.' });
      return;
    }

    const med = db.prepare('SELECT brand_name, rack_location FROM medicines WHERE id = ?').get(medicine_id) as
      | { brand_name: string; rack_location: string }
      | undefined;
    if (!med) {
      res.status(404).json({ error: 'Medicine not found.' });
      return;
    }

    const status = diffDays(expiry_date) <= 0 ? 'quarantined' : 'active';
    const info = db
      .prepare(
        `
        INSERT INTO batches (medicine_id, batch_no, mfg_date, expiry_date, qty_available, cost_price, mrp, rack_location, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        medicine_id,
        batch_no.trim(),
        mfg_date || todayIso(),
        expiry_date,
        Number(qty_available),
        Number(cost_price || 0),
        Number(mrp || 0),
        rack_location || med.rack_location,
        status
      );

    logAudit(
      actor_name,
      actor_role,
      'BATCH_ADD',
      batch_no,
      `Added ${qty_available} units of ${med.brand_name} (Exp: ${expiry_date})`
    );
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.post('/api/batches/:id/adjust', (req, res) => {
    const batchId = Number(req.params.id);
    const { delta_qty, action, reason, actor_name = 'Staff', actor_role = 'Admin' } = req.body as {
      delta_qty?: number;
      action?: 'adjust' | 'quarantine' | 'remove';
      reason?: string;
      actor_name?: string;
      actor_role?: string;
    };

    const batch = db
      .prepare('SELECT b.*, m.brand_name FROM batches b JOIN medicines m ON m.id = b.medicine_id WHERE b.id = ?')
      .get(batchId) as
      | { id: number; batch_no: string; qty_available: number; brand_name: string; status: string }
      | undefined;

    if (!batch) {
      res.status(404).json({ error: 'Batch not found.' });
      return;
    }

    if (action === 'quarantine') {
      db.prepare("UPDATE batches SET status = 'quarantined' WHERE id = ?").run(batchId);
      logAudit(actor_name, actor_role, 'BATCH_QUARANTINE', batch.batch_no, reason || `Quarantined ${batch.brand_name}`);
    } else if (action === 'remove') {
      db.prepare("UPDATE batches SET qty_available = 0, status = 'quarantined' WHERE id = ?").run(batchId);
      logAudit(actor_name, actor_role, 'BATCH_REMOVE', batch.batch_no, reason || `Removed ${batch.qty_available} units of ${batch.brand_name}`);
    } else {
      const nextQty = Math.max(0, batch.qty_available + Number(delta_qty || 0));
      db.prepare('UPDATE batches SET qty_available = ? WHERE id = ?').run(nextQty, batchId);
      logAudit(
        actor_name,
        actor_role,
        'BATCH_ADJUST',
        batch.batch_no,
        `${reason || 'Manual stock adjustment'}: ${batch.qty_available} -> ${nextQty} units (${batch.brand_name})`
      );
    }

    res.json({ ok: true });
  });

  app.post('/api/batches/import', (req, res) => {
    const { rows, actor_name = 'Admin', actor_role = 'Admin' } = req.body as {
      rows: Array<{
        brand_name: string;
        generic_name?: string;
        batch_no: string;
        expiry_date: string;
        qty: number;
        cost_price: number;
        mrp: number;
      }>;
      actor_name?: string;
      actor_role?: string;
    };

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: 'Provide at least one row to import.' });
      return;
    }

    let importedCount = 0;
    const importTx = db.transaction(() => {
      for (const r of rows) {
        if (!r.brand_name || !r.batch_no || !r.expiry_date || !r.qty) continue;
        let med = db
          .prepare('SELECT id, rack_location FROM medicines WHERE LOWER(brand_name) = LOWER(?)')
          .get(r.brand_name.trim()) as { id: number; rack_location: string } | undefined;

        if (!med) {
          const newMed = db
            .prepare(
              `
              INSERT INTO medicines (
                brand_name, generic_name, strength, dosage_form, category, hsn_code,
                gst_rate, reorder_level, target_stock, preferred_supplier_id, rack_location, requires_rx
              ) VALUES (?, ?, 'Standard', 'Tablet', 'Imported', '30049099', 12, 40, 120, 1, 'IMP-1', 0)
              `
            )
            .run(r.brand_name.trim(), (r.generic_name || r.brand_name).trim());
          med = { id: Number(newMed.lastInsertRowid), rack_location: 'IMP-1' };
        }

        const status = diffDays(r.expiry_date) <= 0 ? 'quarantined' : 'active';
        db.prepare(
          `
          INSERT INTO batches (medicine_id, batch_no, mfg_date, expiry_date, qty_available, cost_price, mrp, rack_location, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          med.id,
          r.batch_no.trim(),
          todayIso(),
          r.expiry_date.trim(),
          Number(r.qty),
          Number(r.cost_price || 0),
          Number(r.mrp || 0),
          med.rack_location,
          status
        );
        importedCount++;
      }
      logAudit(actor_name, actor_role, 'BATCH_IMPORT', 'CSV Import', `Imported ${importedCount} batch rows into inventory`);
    });

    importTx();
    res.json({ imported: importedCount });
  });

  // 5. Billing Preview & Transactional FEFO Checkout
  app.post('/api/billing/preview', (req, res) => {
    const { items } = req.body as { items: Array<{ medicine_id: number; qty: number }> };
    if (!Array.isArray(items)) {
      res.status(400).json({ error: 'Items array is required.' });
      return;
    }
    res.json(buildBillingPreview(items));
  });

  app.get('/api/invoices', (_req, res) => {
    res.json(getInvoicesData());
  });

  app.post('/api/invoices', (req, res) => {
    const {
      customer_name,
      customer_phone = '',
      rx_id = null,
      payment_method,
      payment_ref = '',
      items,
      interaction_ack_by = null,
      actor_name = 'Priya Nair, RPh',
      actor_role = 'Pharmacist',
    } = req.body as {
      customer_name: string;
      customer_phone?: string;
      rx_id?: number | null;
      payment_method: 'Cash' | 'UPI' | 'Card' | 'Insurance';
      payment_ref?: string;
      items: Array<{ medicine_id: number; qty: number }>;
      interaction_ack_by?: string | null;
      actor_name?: string;
      actor_role?: string;
    };

    if (!customer_name || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Customer name and at least one billing item are required.' });
      return;
    }

    try {
      const createdInvoice = db.transaction(() => {
        const preview = buildBillingPreview(items);
        if (preview.has_shortfall) {
          throw new Error('Insufficient non-expired batch stock for one or more items. Use Brand-Swap or adjust quantity.');
        }
        if (preview.has_severe_interaction && !interaction_ack_by) {
          throw new Error('Severe drug interaction detected. Pharmacist clinical acknowledgement is required before billing.');
        }

        const seq = (db.prepare('SELECT COUNT(*) as cnt FROM invoices').get() as { cnt: number }).cnt + 897;
        const invoiceNo = `INV-2026-${String(seq).padStart(4, '0')}`;

        const invInfo = db
          .prepare(
            `
            INSERT INTO invoices (
              invoice_no, customer_name, customer_phone, rx_id, payment_method, payment_ref,
              subtotal, cgst_total, sgst_total, grand_total, interaction_ack_by, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            invoiceNo,
            customer_name.trim(),
            customer_phone.trim(),
            rx_id,
            payment_method,
            payment_ref.trim(),
            preview.subtotal,
            preview.cgst_total,
            preview.sgst_total,
            preview.grand_total,
            interaction_ack_by,
            actor_name
          );

        const invoiceId = Number(invInfo.lastInsertRowid);
        const deductStmt = db.prepare(
          "UPDATE batches SET qty_available = qty_available - ? WHERE id = ? AND qty_available >= ? AND status = 'active' AND date(expiry_date) > date('now')"
        );
        const insertLine = db.prepare(`
          INSERT INTO invoice_items (
            invoice_id, medicine_id, brand_name, generic_name, hsn_code, batch_id,
            batch_no, expiry_date, qty, mrp, gst_rate, cgst_amount, sgst_amount, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const line of preview.lines) {
          for (const alloc of line.allocations) {
            const upd = deductStmt.run(alloc.qty_allocated, alloc.batch_id, alloc.qty_allocated);
            if (upd.changes === 0) {
              throw new Error(`Batch ${alloc.batch_no} is expired or no longer has sufficient stock.`);
            }
            const gross = Number((alloc.qty_allocated * alloc.mrp).toFixed(2));
            const base = Number((gross / (1 + line.gst_rate / 100)).toFixed(2));
            const tax = Number((gross - base).toFixed(2));
            const cgst = Number((tax / 2).toFixed(2));
            const sgst = Number((tax - cgst).toFixed(2));

            insertLine.run(
              invoiceId,
              line.medicine_id,
              line.brand_name,
              line.generic_name,
              line.hsn_code,
              alloc.batch_id,
              alloc.batch_no,
              alloc.expiry_date,
              alloc.qty_allocated,
              alloc.mrp,
              line.gst_rate,
              cgst,
              sgst,
              gross
            );
          }
        }

        if (rx_id) {
          db.prepare("UPDATE emr_prescriptions SET status = 'Dispensed' WHERE id = ?").run(rx_id);
        }

        const ackNote = interaction_ack_by ? ` · Interaction ACK by ${interaction_ack_by}` : '';
        logAudit(
          actor_name,
          actor_role,
          'FEFO_BILLING',
          invoiceNo,
          `Billed ₹${preview.grand_total.toFixed(2)} (${payment_method}) to ${customer_name}${ackNote}`
        );

        const savedInv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as Record<string, unknown>;
        const savedItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId);
        return { ...savedInv, items: savedItems };
      })();

      res.status(201).json(createdInvoice);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to commit invoice.' });
    }
  });

  // 6. EMR Digital Prescriptions
  app.get('/api/prescriptions', (_req, res) => {
    res.json(getPrescriptionsData());
  });

  app.post('/api/prescriptions/:id/swap', (req, res) => {
    const rxId = Number(req.params.id);
    const { item_id, new_medicine_id, actor_name = 'Priya Nair, RPh', actor_role = 'Pharmacist' } = req.body as {
      item_id: number;
      new_medicine_id: number;
      actor_name?: string;
      actor_role?: string;
    };

    const newMed = db.prepare('SELECT brand_name, generic_name FROM medicines WHERE id = ?').get(new_medicine_id) as
      | { brand_name: string; generic_name: string }
      | undefined;
    if (!newMed) {
      res.status(404).json({ error: 'Replacement brand not found.' });
      return;
    }

    db.prepare('UPDATE emr_prescription_items SET medicine_id = ? WHERE id = ? AND prescription_id = ?').run(
      new_medicine_id,
      item_id,
      rxId
    );
    db.prepare("UPDATE emr_prescriptions SET status = 'Reviewed' WHERE id = ? AND status = 'Pending'").run(rxId);
    logAudit(actor_name, actor_role, 'BRAND_SWAP', `RX#${rxId}`, `Swapped out-of-stock Rx item to ${newMed.brand_name} (${newMed.generic_name})`);
    res.json({ ok: true });
  });

  app.post('/api/prescriptions', (req, res) => {
    const { patient_name, patient_age, patient_gender, patient_phone, allergies, doctor_name, department, emr_notes, items } =
      req.body as {
        patient_name: string;
        patient_age: number;
        patient_gender: string;
        patient_phone: string;
        allergies: string;
        doctor_name: string;
        department: string;
        emr_notes: string;
        items: Array<{ medicine_id: number; dosage_instruction: string; prescribed_qty: number }>;
      };

    if (!patient_name || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Patient name and prescribed medicines are required.' });
      return;
    }

    const seq = (db.prepare('SELECT COUNT(*) as cnt FROM emr_prescriptions').get() as { cnt: number }).cnt + 1041;
    const rxCode = `RX-2026-${seq}`;

    const info = db
      .prepare(
        `
        INSERT INTO emr_prescriptions (
          rx_code, patient_name, patient_age, patient_gender, patient_phone,
          allergies, doctor_name, department, emr_notes, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')
        `
      )
      .run(
        rxCode,
        patient_name,
        Number(patient_age || 35),
        patient_gender || 'Male',
        patient_phone || '+91 98000 00000',
        allergies || 'None known',
        doctor_name || 'Dr. Kavita Rao',
        department || 'OPD Clinic',
        emr_notes || 'Digital EMR prescription routed to Medoryx counter.'
      );

    const rxId = Number(info.lastInsertRowid);
    const insItem = db.prepare(
      'INSERT INTO emr_prescription_items (prescription_id, medicine_id, dosage_instruction, prescribed_qty) VALUES (?, ?, ?, ?)'
    );
    for (const it of items) {
      insItem.run(rxId, it.medicine_id, it.dosage_instruction || '1 tab BD', Number(it.prescribed_qty || 10));
    }

    logAudit('EMR Sync', 'Connected Healthcare', 'EMR_RECEIVE', rxCode, `Received digital prescription for ${patient_name}`);
    res.status(201).json({ id: rxId, rx_code: rxCode });
  });

  // 7. Returns & Reconciliation
  app.get('/api/returns', (_req, res) => {
    res.json(getReturnsData());
  });

  app.post('/api/returns', (req, res) => {
    const {
      return_type,
      invoice_no = null,
      batch_id,
      qty,
      reason,
      actor_name = 'Staff',
      actor_role = 'Pharmacist',
    } = req.body as {
      return_type: 'Customer Return' | 'Damaged Stock' | 'Expired Write-Off';
      invoice_no?: string | null;
      batch_id: number;
      qty: number;
      reason: string;
      actor_name?: string;
      actor_role?: string;
    };

    const batch = db
      .prepare('SELECT b.*, m.brand_name FROM batches b JOIN medicines m ON m.id = b.medicine_id WHERE b.id = ?')
      .get(batch_id) as
      | {
          id: number;
          medicine_id: number;
          batch_no: string;
          expiry_date: string;
          qty_available: number;
          cost_price: number;
          mrp: number;
          brand_name: string;
        }
      | undefined;

    if (!batch) {
      res.status(404).json({ error: 'Selected batch not found.' });
      return;
    }

    const q = Math.max(1, Math.floor(Number(qty) || 1));

    try {
      const result = db.transaction(() => {
        let restocked = 0;
        let amount = 0;

        if (return_type === 'Customer Return') {
          if (diffDays(batch.expiry_date) <= 0) {
            throw new Error('Expired batch cannot be restocked to active shelf. Log as Expired Write-Off instead.');
          }
          db.prepare('UPDATE batches SET qty_available = qty_available + ? WHERE id = ?').run(q, batch.id);
          restocked = 1;
          amount = Number((q * batch.mrp).toFixed(2));
        } else {
          if (q > batch.qty_available) {
            throw new Error(`Write-off qty (${q}) exceeds available batch quantity (${batch.qty_available}).`);
          }
          const nextQty = batch.qty_available - q;
          db.prepare('UPDATE batches SET qty_available = ? WHERE id = ?').run(nextQty, batch.id);
          if (return_type === 'Expired Write-Off') {
            db.prepare("UPDATE batches SET status = 'quarantined' WHERE id = ?").run(batch.id);
          }
          amount = Number((q * batch.cost_price).toFixed(2));
        }

        const info = db
          .prepare(
            `
            INSERT INTO returns_reconciliation (
              return_type, invoice_no, medicine_id, batch_id, qty, amount, reason, restocked, processed_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(return_type, invoice_no, batch.medicine_id, batch.id, q, amount, reason || return_type, restocked, actor_name);

        logAudit(
          actor_name,
          actor_role,
          'RETURN_RECONCILE',
          batch.batch_no,
          `${return_type}: ${q} units of ${batch.brand_name} (₹${amount.toFixed(2)}) — ${reason || 'Reconciled'}`
        );
        return { id: Number(info.lastInsertRowid), restocked, amount };
      })();

      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Reconciliation failed.' });
    }
  });

  // 8. Suppliers, Purchase Orders & GRN
  app.get('/api/suppliers', (_req, res) => {
    res.json(getSuppliersData());
  });

  app.post('/api/suppliers', (req, res) => {
    const { name, contact_person, phone, email, gstin, city, lead_time_days, actor_name = 'Admin', actor_role = 'Admin' } =
      req.body;
    if (!name || !email) {
      res.status(400).json({ error: 'Supplier name and email are required.' });
      return;
    }
    const info = db
      .prepare(
        'INSERT INTO suppliers (name, contact_person, phone, email, gstin, city, lead_time_days) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(name, contact_person || '', phone || '', email, gstin || '', city || '', Number(lead_time_days || 2));
    logAudit(actor_name, actor_role, 'SUPPLIER_CREATE', name, `Added supplier ${name} (${city || 'India'})`);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.put('/api/suppliers/:id', (req, res) => {
    const id = Number(req.params.id);
    const { name, contact_person, phone, email, gstin, city, lead_time_days, actor_name = 'Admin', actor_role = 'Admin' } =
      req.body;
    db.prepare(
      'UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, gstin = ?, city = ?, lead_time_days = ? WHERE id = ?'
    ).run(name, contact_person, phone, email, gstin, city, Number(lead_time_days || 2), id);
    logAudit(actor_name, actor_role, 'SUPPLIER_UPDATE', name, `Updated supplier profile for ${name}`);
    res.json({ ok: true });
  });

  app.get('/api/purchase-orders', (_req, res) => {
    res.json(getPurchaseOrdersData());
  });

  app.post('/api/purchase-orders', (req, res) => {
    const { supplier_id, notes = '', items, actor_name = 'Admin', actor_role = 'Admin' } = req.body as {
      supplier_id: number;
      notes?: string;
      items: Array<{ medicine_id: number; qty_ordered: number; unit_cost: number }>;
      actor_name?: string;
      actor_role?: string;
    };

    if (!supplier_id || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Supplier and at least one order line are required.' });
      return;
    }

    const seq = (db.prepare('SELECT COUNT(*) as cnt FROM purchase_orders').get() as { cnt: number }).cnt + 312;
    const poNumber = `PO-2026-${String(seq).padStart(4, '0')}`;
    const totalAmount = items.reduce((acc, it) => acc + Number(it.qty_ordered) * Number(it.unit_cost), 0);

    const poId = db.transaction(() => {
      const info = db
        .prepare(
          'INSERT INTO purchase_orders (po_number, supplier_id, status, total_amount, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(poNumber, supplier_id, 'Draft', Number(totalAmount.toFixed(2)), notes, actor_name);
      const id = Number(info.lastInsertRowid);
      const insItem = db.prepare(
        'INSERT INTO purchase_order_items (po_id, medicine_id, qty_ordered, unit_cost, line_total) VALUES (?, ?, ?, ?, ?)'
      );
      for (const it of items) {
        const lineTotal = Number((Number(it.qty_ordered) * Number(it.unit_cost)).toFixed(2));
        insItem.run(id, it.medicine_id, Number(it.qty_ordered), Number(it.unit_cost), lineTotal);
      }
      logAudit(actor_name, actor_role, 'PO_CREATE', poNumber, `Created draft PO ${poNumber} (₹${totalAmount.toFixed(2)})`);
      return id;
    })();

    res.status(201).json({ id: poId, po_number: poNumber });
  });

  app.post('/api/purchase-orders/:id/email', (req, res) => {
    const poId = Number(req.params.id);
    const { actor_name = 'Admin', actor_role = 'Admin' } = req.body as { actor_name?: string; actor_role?: string };
    const po = db
      .prepare(
        `
        SELECT po.po_number, s.email, s.name
        FROM purchase_orders po
        JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.id = ?
        `
      )
      .get(poId) as { po_number: string; email: string; name: string } | undefined;

    if (!po) {
      res.status(404).json({ error: 'Purchase Order not found.' });
      return;
    }

    db.prepare("UPDATE purchase_orders SET status = 'Sent', emailed_at = datetime('now') WHERE id = ?").run(poId);
    logAudit(actor_name, actor_role, 'PO_DISPATCH', po.po_number, `Emailed ${po.po_number} to ${po.name} (${po.email})`);
    res.json({ ok: true, emailed_to: po.email });
  });

  app.get('/api/grn', (_req, res) => {
    res.json(getGrnData());
  });

  app.post('/api/grn', (req, res) => {
    const {
      po_id = null,
      supplier_id,
      invoice_ref,
      items,
      actor_name = 'Rohan Kulkarni',
      actor_role = 'Store Staff',
    } = req.body as {
      po_id?: number | null;
      supplier_id: number;
      invoice_ref: string;
      items: Array<{
        medicine_id: number;
        batch_no: string;
        mfg_date: string;
        expiry_date: string;
        qty: number;
        cost_price: number;
        mrp: number;
      }>;
      actor_name?: string;
      actor_role?: string;
    };

    if (!supplier_id || !invoice_ref || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Supplier, vendor invoice reference, and received batch items are required.' });
      return;
    }

    const seq = (db.prepare('SELECT COUNT(*) as cnt FROM grn_records').get() as { cnt: number }).cnt + 193;
    const grnNumber = `GRN-2026-${String(seq).padStart(4, '0')}`;
    const totalCost = items.reduce((acc, it) => acc + Number(it.qty) * Number(it.cost_price), 0);

    const grnId = db.transaction(() => {
      const info = db
        .prepare(
          'INSERT INTO grn_records (grn_number, po_id, supplier_id, invoice_ref, total_cost, received_by) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(grnNumber, po_id, supplier_id, invoice_ref.trim(), Number(totalCost.toFixed(2)), actor_name);

      const insBatch = db.prepare(`
        INSERT INTO batches (medicine_id, batch_no, mfg_date, expiry_date, qty_available, cost_price, mrp, rack_location, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const getMedRack = db.prepare('SELECT rack_location FROM medicines WHERE id = ?');

      for (const it of items) {
        const med = getMedRack.get(it.medicine_id) as { rack_location: string } | undefined;
        const status = diffDays(it.expiry_date) <= 0 ? 'quarantined' : 'active';
        insBatch.run(
          it.medicine_id,
          it.batch_no.trim(),
          it.mfg_date || todayIso(),
          it.expiry_date,
          Number(it.qty),
          Number(it.cost_price),
          Number(it.mrp),
          med?.rack_location || 'A-01',
          status
        );
      }

      if (po_id) {
        db.prepare("UPDATE purchase_orders SET status = 'Received' WHERE id = ?").run(po_id);
      }

      logAudit(
        actor_name,
        actor_role,
        'GRN_INTAKE',
        grnNumber,
        `Recorded GRN ${grnNumber} (${items.length} batches, ₹${totalCost.toFixed(2)}, Ref: ${invoice_ref})`
      );
      return Number(info.lastInsertRowid);
    })();

    res.status(201).json({ id: grnId, grn_number: grnNumber });
  });

  // 9. Reports & Audit Logs
  app.get('/api/reports/overview', (_req, res) => {
    const categorySnapshot = db
      .prepare(
        `
        SELECT
          m.category,
          COUNT(DISTINCT m.id) as sku_count,
          COALESCE(SUM(CASE WHEN b.status = 'active' AND date(b.expiry_date) > date('now') THEN b.qty_available ELSE 0 END), 0) as active_units,
          ROUND(COALESCE(SUM(CASE WHEN b.status = 'active' AND date(b.expiry_date) > date('now') THEN b.qty_available * b.cost_price ELSE 0 END), 0), 2) as cost_value,
          ROUND(COALESCE(SUM(CASE WHEN b.status = 'active' AND date(b.expiry_date) > date('now') THEN b.qty_available * b.mrp ELSE 0 END), 0), 2) as mrp_value
        FROM medicines m
        LEFT JOIN batches b ON b.medicine_id = m.id
        GROUP BY m.category
        ORDER BY cost_value DESC
        `
      )
      .all();

    const paymentBreakdown = db
      .prepare(
        `
        SELECT
          payment_method,
          COUNT(*) as invoice_count,
          ROUND(SUM(subtotal), 2) as taxable_value,
          ROUND(SUM(cgst_total + sgst_total), 2) as gst_collected,
          ROUND(SUM(grand_total), 2) as gross_revenue
        FROM invoices
        GROUP BY payment_method
        ORDER BY gross_revenue DESC
        `
      )
      .all();

    const gstSlabs = db
      .prepare(
        `
        SELECT
          gst_rate,
          SUM(qty) as units_sold,
          ROUND(SUM(cgst_amount), 2) as cgst,
          ROUND(SUM(sgst_amount), 2) as sgst,
          ROUND(SUM(line_total), 2) as gross_total
        FROM invoice_items
        GROUP BY gst_rate
        ORDER BY gst_rate ASC
        `
      )
      .all();

    const auditLogs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100').all();

    res.json({
      category_snapshot: categorySnapshot,
      payment_breakdown: paymentBreakdown,
      gst_slabs: gstSlabs,
      audit_logs: auditLogs,
    });
  });

  app.get('/api/schema/mysql', (_req, res) => {
    const mysqlSchema = `-- Medoryx Medical Store Management System — Reference MySQL 8.0 Schema
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
);`;
    res.type('text/plain').send(mysqlSchema);
  });

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  // Vite middleware in development, static dist in production
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      '/assets',
      express.static(path.join(distDir, 'assets'), {
        maxAge: '1y',
        immutable: true,
      })
    );
    app.use(express.static(distDir, { maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (!process.env.VERCEL && isDirectExecution) {
  const PORT = Number(process.env.PORT) || 3000;
  createApp().then((app) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Medoryx server listening on http://0.0.0.0:${PORT}`);
    });
  });
}
