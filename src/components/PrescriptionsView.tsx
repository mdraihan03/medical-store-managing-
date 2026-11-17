import { useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Plus,
  RefreshCw,
  Stethoscope,
  X,
} from 'lucide-react';
import { apiFetch, formatDateTime, formatShortDate } from '../lib/format';
import type { EmrPrescription, Medicine, UserSession } from '../types';

interface PrescriptionsViewProps {
  prescriptions: EmrPrescription[];
  medicines: Medicine[];
  user: UserSession;
  onRefresh: () => Promise<void>;
  onSendToBilling: (rx: EmrPrescription) => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function PrescriptionsView({
  prescriptions,
  medicines,
  user,
  onRefresh,
  onSendToBilling,
  onNotify,
}: PrescriptionsViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'Pending' | 'Reviewed' | 'Dispensed'>('all');
  const [selectedId, setSelectedId] = useState<number | null>(prescriptions[0]?.id ?? null);
  const [swappingItemId, setSwappingItemId] = useState<number | null>(null);
  const [showNewRxModal, setShowNewRxModal] = useState(false);

  // New EMR Rx simulation form
  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge] = useState('45');
  const [patientGender, setPatientGender] = useState('Male');
  const [patientPhone, setPatientPhone] = useState('+91 98200 11223');
  const [allergies, setAllergies] = useState('None known');
  const [doctorName, setDoctorName] = useState('Dr. Kavita Rao');
  const [department, setDepartment] = useState('Internal Medicine');
  const [emrNotes, setEmrNotes] = useState('');
  const [newMedId, setNewMedId] = useState<number>(medicines[0]?.id ?? 1);
  const [newQty, setNewQty] = useState('10');
  const [newDosage, setNewDosage] = useState('1 tab BD after food');
  const [draftItems, setDraftItems] = useState<
    Array<{ medicine_id: number; dosage_instruction: string; prescribed_qty: number }>
  >([]);
  const [submittingRx, setSubmittingRx] = useState(false);

  const filtered =
    statusFilter === 'all' ? prescriptions : prescriptions.filter((p) => p.status === statusFilter);
  const activeRx =
    prescriptions.find((p) => p.id === selectedId) || filtered[0] || prescriptions[0] || null;

  async function handleSwapBrand(rxId: number, itemId: number, newMedicineId: number, newBrand: string) {
    setSwappingItemId(itemId);
    try {
      await apiFetch(`/api/prescriptions/${rxId}/swap`, {
        method: 'POST',
        body: JSON.stringify({
          item_id: itemId,
          new_medicine_id: newMedicineId,
          actor_name: user.name,
          actor_role: user.role,
        }),
      });
      await onRefresh();
      onNotify(`Swapped out-of-stock brand to ${newBrand}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to swap brand', 'error');
    } finally {
      setSwappingItemId(null);
    }
  }

  function addDraftLine() {
    if (!newMedId) return;
    setDraftItems((prev) => [
      ...prev,
      {
        medicine_id: newMedId,
        dosage_instruction: newDosage || '1 tab BD',
        prescribed_qty: Math.max(1, Number(newQty) || 10),
      },
    ]);
  }

  async function handleCreateRx(e: FormEvent) {
    e.preventDefault();
    if (!patientName.trim() || draftItems.length === 0) {
      onNotify('Enter patient name and add at least one medicine.', 'error');
      return;
    }
    setSubmittingRx(true);
    try {
      const created = await apiFetch<{ id: number; rx_code: string }>('/api/prescriptions', {
        method: 'POST',
        body: JSON.stringify({
          patient_name: patientName.trim(),
          patient_age: Number(patientAge) || 40,
          patient_gender: patientGender,
          patient_phone: patientPhone,
          allergies,
          doctor_name: doctorName,
          department,
          emr_notes: emrNotes || 'Digital EMR order synced to Medoryx pharmacy queue.',
          items: draftItems,
        }),
      });
      await onRefresh();
      setSelectedId(created.id);
      setShowNewRxModal(false);
      setPatientName('');
      setEmrNotes('');
      setDraftItems([]);
      onNotify(`EMR Prescription ${created.rx_code} received at counter`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to receive prescription', 'error');
    } finally {
      setSubmittingRx(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Connected EMR & Digital Prescription Queue
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Review incoming doctor prescriptions, validate batch availability, swap out-of-stock brands, and route to billing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['all', 'Pending', 'Reviewed', 'Dispensed'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'all' ? 'All Rx' : st}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowNewRxModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Simulate EMR Rx
          </button>
        </div>
      </div>

      {/* Split Queue & Detail Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Queue List */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No prescriptions match this filter.
            </div>
          ) : (
            filtered.map((rx) => {
              const isSelected = activeRx?.id === rx.id;
              const hasOutOfStock = rx.items.some((i) => i.available_stock < i.prescribed_qty);
              const statusColor =
                rx.status === 'Dispensed'
                  ? 'text-emerald-700'
                  : rx.status === 'Reviewed'
                  ? 'text-teal-700'
                  : 'text-amber-700';

              return (
                <button
                  key={rx.id}
                  type="button"
                  onClick={() => setSelectedId(rx.id)}
                  className={`w-full text-left p-4 transition-colors cursor-pointer ${
                    isSelected ? 'bg-emerald-50/50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-bold text-slate-900">{rx.rx_code}</span>
                    <span className={`text-xs font-semibold ${statusColor}`}>{rx.status}</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900 mt-1">{rx.patient_name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {rx.doctor_name} · {rx.department} · {rx.items.length} medicines
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
                    <span>{formatDateTime(rx.created_at)}</span>
                    {hasOutOfStock && rx.status !== 'Dispensed' && (
                      <span className="font-semibold text-amber-700">Brand-swap needed</span>
                    )}
                    {rx.interactions.length > 0 && (
                      <span className="font-semibold text-red-600">
                        {rx.interactions.length} interaction alert
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Right EMR Clinical Detail Panel */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          {!activeRx ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Select a digital prescription from the queue to inspect EMR notes and validate stock.
            </div>
          ) : (
            <div className="space-y-6">
              {/* Patient & EMR Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-bold text-slate-900">{activeRx.rx_code}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activeRx.department}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activeRx.doctor_name}</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mt-1">
                    {activeRx.patient_name}{' '}
                    <span className="text-sm font-normal text-slate-500">
                      ({activeRx.patient_age}y, {activeRx.patient_gender})
                    </span>
                  </h3>
                  <p className="text-xs text-slate-600 mt-1">
                    Phone: <span className="font-mono">{activeRx.patient_phone}</span> · Allergies:{' '}
                    <span
                      className={
                        activeRx.allergies.toLowerCase().includes('none')
                          ? 'text-slate-700'
                          : 'font-semibold text-red-700'
                      }
                    >
                      {activeRx.allergies}
                    </span>
                  </p>
                </div>

                <div className="shrink-0">
                  {activeRx.status === 'Dispensed' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 className="w-4 h-4" /> Dispensed & Billed
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSendToBilling(activeRx)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Load into POS Billing <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* EMR Clinical Notes */}
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900 mb-1">
                  <Stethoscope className="w-3.5 h-3.5 text-teal-600" /> Electronic Medical Record (EMR) Notes
                </div>
                <p>{activeRx.emr_notes}</p>
              </div>

              {/* Drug Interaction Preview on Rx */}
              {activeRx.interactions.length > 0 && (
                <div className="space-y-2">
                  {activeRx.interactions.map((alert) => (
                    <div
                      key={`${alert.id}-${alert.medicine_a}`}
                      className={`p-3.5 rounded-lg border text-xs ${
                        alert.severity === 'Severe'
                          ? 'bg-red-50 border-red-200 text-red-900'
                          : alert.severity === 'Moderate'
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-slate-50 border-slate-200 text-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-bold">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>
                          {alert.severity} Drug Interaction: {alert.medicine_a} + {alert.medicine_b}
                        </span>
                      </div>
                      <p className="mt-1 opacity-90">{alert.clinical_effect}</p>
                      <p className="mt-1 font-medium">Guidance: {alert.recommendation}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Prescribed Medicine Lines & Availability / Brand-Swap */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Prescribed Medicines & Availability Validation
                </h4>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {activeRx.items.map((item) => {
                    const isShort = item.available_stock < item.prescribed_qty;
                    return (
                      <div key={item.id} className="p-4 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              {item.brand_name}{' '}
                              <span className="text-xs font-normal text-slate-500">{item.strength}</span>
                            </div>
                            <div className="text-xs text-slate-500">
                              Generic: {item.generic_name} · {item.dosage_instruction}
                            </div>
                          </div>

                          <div className="text-left sm:text-right shrink-0">
                            <div className="text-xs font-mono tabular-nums font-bold text-slate-900">
                              Qty: {item.prescribed_qty}
                            </div>
                            <div
                              className={`text-xs font-mono tabular-nums font-semibold ${
                                isShort ? 'text-red-600' : 'text-emerald-700'
                              }`}
                            >
                              {item.available_stock === 0
                                ? 'Out of stock (0 available)'
                                : isShort
                                ? `Low (${item.available_stock} on shelf)`
                                : `In stock (${item.available_stock} on shelf)`}
                            </div>
                          </div>
                        </div>

                        {isShort && activeRx.status !== 'Dispensed' && item.brand_swaps.length > 0 && (
                          <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200">
                            <div className="text-xs font-semibold text-amber-900 mb-2 flex items-center gap-1.5">
                              <RefreshCw className="w-3.5 h-3.5" />
                              Brand-Swap Suggestions (Same Generic: {item.generic_name})
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {item.brand_swaps.map((swap) => (
                                <button
                                  key={swap.medicine_id}
                                  type="button"
                                  disabled={swappingItemId === item.id}
                                  onClick={() =>
                                    handleSwapBrand(activeRx.id, item.id, swap.medicine_id, swap.brand_name)
                                  }
                                  className="px-3 py-1.5 text-xs bg-white border border-amber-300 hover:border-emerald-600 hover:bg-emerald-50 rounded-md text-slate-800 font-medium transition-colors cursor-pointer"
                                >
                                  Swap to <span className="font-bold">{swap.brand_name}</span> ·{' '}
                                  <span className="font-mono tabular-nums">{swap.total_active_stock} units</span> · Exp{' '}
                                  {formatShortDate(swap.earliest_expiry)}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Simulate Incoming EMR Prescription Modal */}
      {showNewRxModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">Receive Digital EMR Prescription</h3>
              <button
                type="button"
                onClick={() => setShowNewRxModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateRx} className="space-y-4 mt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Patient Name</label>
                  <input
                    required
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    placeholder="e.g. Ananya Deshpande"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Age</label>
                    <input
                      type="number"
                      value={patientAge}
                      onChange={(e) => setPatientAge(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Gender</label>
                    <select
                      value={patientGender}
                      onChange={(e) => setPatientGender(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                    >
                      <option>Male</option>
                      <option>Female</option>
                      <option>Other</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    value={patientPhone}
                    onChange={(e) => setPatientPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Allergies</label>
                  <input
                    value={allergies}
                    onChange={(e) => setAllergies(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Doctor</label>
                  <input
                    value={doctorName}
                    onChange={(e) => setDoctorName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                  <input
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">EMR Clinical Notes</label>
                <input
                  value={emrNotes}
                  onChange={(e) => setEmrNotes(e.target.value)}
                  placeholder="Diagnosis or monitoring note"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div className="border-t border-slate-200 pt-4">
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Add Prescribed Medicines
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <select
                    value={newMedId}
                    onChange={(e) => setNewMedId(Number(e.target.value))}
                    className="sm:col-span-5 px-2.5 py-2 text-xs border border-slate-200 rounded-lg"
                  >
                    {medicines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.brand_name} ({m.total_active_stock} avail)
                      </option>
                    ))}
                  </select>
                  <input
                    value={newDosage}
                    onChange={(e) => setNewDosage(e.target.value)}
                    placeholder="Dosage"
                    className="sm:col-span-4 px-2.5 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                  <input
                    type="number"
                    min={1}
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                    className="sm:col-span-2 px-2.5 py-2 text-xs border border-slate-200 rounded-lg font-mono"
                  />
                  <button
                    type="button"
                    onClick={addDraftLine}
                    className="sm:col-span-1 px-2 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    +
                  </button>
                </div>

                {draftItems.length > 0 && (
                  <ul className="mt-3 divide-y divide-slate-100 border border-slate-200 rounded-lg text-xs">
                    {draftItems.map((it, idx) => {
                      const med = medicines.find((m) => m.id === it.medicine_id);
                      return (
                        <li key={idx} className="px-3 py-2 flex items-center justify-between">
                          <span>
                            <strong>{med?.brand_name}</strong> · {it.dosage_instruction} ·{' '}
                            <span className="font-mono">{it.prescribed_qty} units</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setDraftItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-red-600 hover:underline cursor-pointer"
                          >
                            Remove
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowNewRxModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingRx}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer disabled:opacity-60"
                >
                  {submittingRx ? 'Syncing...' : 'Send to Pharmacy Queue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
