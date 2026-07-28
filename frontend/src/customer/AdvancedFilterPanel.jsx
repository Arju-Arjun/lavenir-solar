import React, { useState, useRef, useEffect } from 'react';
import { FaFilter } from 'react-icons/fa';

/*
 * AdvancedFilterPanel
 * --------------------
 * Renders the full nested filter tree for the Customer Directory:
 *
 *   Profile            -> System Capacity, District
 *   Site Visit         -> Panel Capacity, System Capacity, Load Enhancement,
 *                          Ownership Change, WiFi Availability
 *   MNRE Profile       -> Status (work_done)
 *   Payment            -> Status (work_done)
 *   Bank Loan          -> Required?  -> (nested) Jansamarth, 1st Payment, 2nd Payment
 *   KSEB Feasibility   -> Ownership Change, Load Enhancement, Feasibility, Fee Paid
 *   Material Delivery  -> Electrical Items, Structure Items, Solar Panels
 *   Material Install.  -> Electrical Installation, Structure Installation
 *   KSEB Registration  -> Registration/Completion/Agreement+Payment/WiFi Configured
 *   DCR                -> Certificate Sold
 *   MNRE Installation  -> Installation Status, Approval Status, Subsidy Status
 *   Service            -> Service count range (1-10)
 *
 * The panel is fully controlled: parent owns `filters` state and passes it
 * down along with `onChange`. This component never talks to the network.
 *
 * `filters` shape (all keys optional/omittable when unset — see
 * buildEmptyFilters() below for the canonical empty shape):
 *
 * {
 *   profile: { system_capacity, system_capacity_custom, district },
 *   site_visit: { panel_capacity, panel_capacity_custom, system_capacity,
 *                 system_capacity_custom, load_enhancement, ownership_change, wifi },
 *   mnre_profile: { status },
 *   payment: { status },
 *   bank_loan: { required, jansamarth, first_payment, second_payment },
 *   kseb_feasibility: { ownership_change, load_enhancement, feasibility, fee_paid },
 *   material_delivery: { electrical, structure, panels },
 *   material_installation: { electrical, structure },
 *   kseb_registration: { registration_submitted, completion_submitted,
 *                        agreement_payment_done, wifi_configured },
 *   dcr: { certificate_sold },
 *   mnre_installation: { installation_status, approval_status, subsidy_status },
 *   service: { count_min, count_max }
 * }
 */

export const KERALA_DISTRICTS = [
  'Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam',
  'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad', 'Malappuram', 'Kozhikode',
  'Wayanad', 'Kannur', 'Kasaragod'
];

const CAPACITY_OPTIONS = ['3', '5', '8', '10', 'other'];

export function buildEmptyFilters() {
  return {
    profile: { system_capacity: '', system_capacity_custom: '', district: '' },
    site_visit: {
      panel_capacity: '', panel_capacity_custom: '',
      system_capacity: '', system_capacity_custom: '',
      load_enhancement: '', ownership_change: '', wifi: ''
    },
    mnre_profile: { status: '' },
    payment: { status: '' },
    bank_loan: { required: '', jansamarth: '', first_payment: '', second_payment: '' },
    kseb_feasibility: { ownership_change: '', load_enhancement: '', feasibility: '', fee_paid: '' },
    material_delivery: { electrical: '', structure: '', panels: '' },
    material_installation: { electrical: '', structure: '' },
    kseb_registration: {
      registration_submitted: '', completion_submitted: '',
      agreement_payment_done: '', wifi_configured: ''
    },
    dcr: { certificate_sold: '' },
    mnre_installation: { installation_status: '', approval_status: '', subsidy_status: '' },
    service: { count_min: '', count_max: '' }
  };
}

// Strips empty/blank values so the payload sent to the backend only ever
// contains filters the user actually set. Keeps query strings short and
// keeps the backend's "if key present" branching simple.
export function cleanFilters(filters) {
  const cleaned = {};
  Object.entries(filters).forEach(([section, fields]) => {
    const nonEmpty = {};
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) {
        nonEmpty[key] = value;
      }
    });
    if (Object.keys(nonEmpty).length > 0) {
      cleaned[section] = nonEmpty;
    }
  });
  return cleaned;
}

export function countActiveFilters(filters) {
  return Object.values(cleanFilters(filters)).reduce(
    (sum, fields) => sum + Object.keys(fields).length,
    0
  );
}

function Section({ title, sectionKey, openSection, setOpenSection, badge, children }) {
  const isOpen = openSection === sectionKey;
  return (
    <div className="af-section">
      <button
        type="button"
        className="af-section-header"
        onClick={() => setOpenSection(isOpen ? null : sectionKey)}
      >
        <span>{title}</span>
        <span className="af-section-header-right">
          {badge > 0 && <span className="af-badge">{badge}</span>}
          <span className={`af-chevron ${isOpen ? 'af-chevron-open' : ''}`}>▾</span>
        </span>
      </button>
      {isOpen && <div className="af-section-body">{children}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="af-field">
      <label className="af-field-label">{label}</label>
      {children}
    </div>
  );
}

function CapacitySelect({ value, customValue, onChange, onCustomChange, label }) {
  return (
    <Field label={label}>
      <select className="af-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {CAPACITY_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>{opt === 'other' ? 'Other' : `${opt} kW`}</option>
        ))}
      </select>
      {value === 'other' && (
        <input
          type="number"
          step="0.01"
          className="af-input af-custom-input"
          placeholder="Enter exact kW"
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
        />
      )}
    </Field>
  );
}

function TriStateSelect({ label, value, onChange, trueLabel = 'Completed', falseLabel = 'Pending' }) {
  return (
    <Field label={label}>
      <select className="af-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        <option value="yes">{trueLabel}</option>
        <option value="no">{falseLabel}</option>
      </select>
    </Field>
  );
}

export default function AdvancedFilterPanel({ filters, onChange, onApply, onClear, isOpen, onToggle }) {
  const [openSection, setOpenSection] = useState('profile');
  const activeCount = countActiveFilters(filters);
  const wrapperRef = useRef(null);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  // Close the panel on any click/tap outside it. Only listens while the
  // panel is actually open, and removes itself on close/unmount. Reads
  // onToggle via a ref so the listener isn't torn down and re-added every
  // time the parent re-renders with a fresh inline onToggle function.
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        onToggleRef.current();
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  const setField = (section, field, value) => {
    onChange({
      ...filters,
      [section]: { ...filters[section], [field]: value }
    });
  };

  const sectionActiveCount = (section) =>
    Object.values(filters[section] || {}).filter((v) => v !== '' && v !== null && v !== undefined).length;

  return (
    <div className="af-wrapper" ref={wrapperRef}>
      <button type="button" className="control-select-dropdown af-toggle-btn" onClick={onToggle}>
        <FaFilter /> Advanced Filters
        {activeCount > 0 && <span className="af-toggle-badge">{activeCount}</span>}
      </button>

      {isOpen && (
        <div className="af-panel">
          <div className="af-panel-header">
            <h3>Advanced Filters</h3>
            <button type="button" className="af-clear-link" onClick={onClear}>Clear all</button>
          </div>

          <div className="af-sections-scroll">
            <Section title="Profile" sectionKey="profile" openSection={openSection} setOpenSection={setOpenSection} badge={sectionActiveCount('profile')}>
              <CapacitySelect
                label="System Capacity"
                value={filters.profile.system_capacity}
                customValue={filters.profile.system_capacity_custom}
                onChange={(v) => setField('profile', 'system_capacity', v)}
                onCustomChange={(v) => setField('profile', 'system_capacity_custom', v)}
              />
              <Field label="District">
                <select
                  className="af-select"
                  value={filters.profile.district}
                  onChange={(e) => setField('profile', 'district', e.target.value)}
                >
                  <option value="">Any</option>
                  {KERALA_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
            </Section>

            <Section title="Site Visit" sectionKey="site_visit" openSection={openSection} setOpenSection={setOpenSection} badge={sectionActiveCount('site_visit')}>
              <CapacitySelect
                label="Panel Capacity"
                value={filters.site_visit.panel_capacity}
                customValue={filters.site_visit.panel_capacity_custom}
                onChange={(v) => setField('site_visit', 'panel_capacity', v)}
                onCustomChange={(v) => setField('site_visit', 'panel_capacity_custom', v)}
              />
              <CapacitySelect
                label="System Capacity"
                value={filters.site_visit.system_capacity}
                customValue={filters.site_visit.system_capacity_custom}
                onChange={(v) => setField('site_visit', 'system_capacity', v)}
                onCustomChange={(v) => setField('site_visit', 'system_capacity_custom', v)}
              />
              <TriStateSelect
                label="Load Enhancement"
                value={filters.site_visit.load_enhancement}
                onChange={(v) => setField('site_visit', 'load_enhancement', v)}
                trueLabel="Required" falseLabel="Not Required"
              />
              <TriStateSelect
                label="Ownership Change"
                value={filters.site_visit.ownership_change}
                onChange={(v) => setField('site_visit', 'ownership_change', v)}
                trueLabel="Required" falseLabel="Not Required"
              />
              <TriStateSelect
                label="WiFi Availability"
                value={filters.site_visit.wifi}
                onChange={(v) => setField('site_visit', 'wifi', v)}
                trueLabel="Available" falseLabel="Not Available"
              />
            </Section>

            <Section title="MNRE Profile" sectionKey="mnre_profile" openSection={openSection} setOpenSection={setOpenSection} badge={sectionActiveCount('mnre_profile')}>
              <TriStateSelect
                label="Status"
                value={filters.mnre_profile.status}
                onChange={(v) => setField('mnre_profile', 'status', v)}
              />
            </Section>

            <Section title="Payment" sectionKey="payment" openSection={openSection} setOpenSection={setOpenSection} badge={sectionActiveCount('payment')}>
              <TriStateSelect
                label="Status"
                value={filters.payment.status}
                onChange={(v) => setField('payment', 'status', v)}
              />
            </Section>

            <Section title="Bank Loan" sectionKey="bank_loan" openSection={openSection} setOpenSection={setOpenSection} badge={sectionActiveCount('bank_loan')}>
              <TriStateSelect
                label="Loan Required"
                value={filters.bank_loan.required}
                onChange={(v) => setField('bank_loan', 'required', v)}
                trueLabel="Required" falseLabel="Not Required"
              />
              {/* Nested: these only make sense once a loan is required, so they
                  only appear once "Required" is selected. */}
              {filters.bank_loan.required === 'yes' && (
                <div className="af-nested-group">
                  <TriStateSelect
                    label="Jansamarth"
                    value={filters.bank_loan.jansamarth}
                    onChange={(v) => setField('bank_loan', 'jansamarth', v)}
                  />
                  <TriStateSelect
                    label="1st Payment"
                    value={filters.bank_loan.first_payment}
                    onChange={(v) => setField('bank_loan', 'first_payment', v)}
                  />
                  <TriStateSelect
                    label="2nd Payment"
                    value={filters.bank_loan.second_payment}
                    onChange={(v) => setField('bank_loan', 'second_payment', v)}
                  />
                </div>
              )}
            </Section>

            <Section title="KSEB Feasibility" sectionKey="kseb_feasibility" openSection={openSection} setOpenSection={setOpenSection} badge={sectionActiveCount('kseb_feasibility')}>
              <TriStateSelect
                label="Ownership Change"
                value={filters.kseb_feasibility.ownership_change}
                onChange={(v) => setField('kseb_feasibility', 'ownership_change', v)}
                trueLabel="Complete" falseLabel="Pending"
              />
              <TriStateSelect
                label="Load Enhancement"
                value={filters.kseb_feasibility.load_enhancement}
                onChange={(v) => setField('kseb_feasibility', 'load_enhancement', v)}
                trueLabel="Complete" falseLabel="Pending"
              />
              <TriStateSelect
                label="Feasibility"
                value={filters.kseb_feasibility.feasibility}
                onChange={(v) => setField('kseb_feasibility', 'feasibility', v)}
                trueLabel="Complete" falseLabel="Pending"
              />
              <TriStateSelect
                label="Fee Paid"
                value={filters.kseb_feasibility.fee_paid}
                onChange={(v) => setField('kseb_feasibility', 'fee_paid', v)}
                trueLabel="Done" falseLabel="Not Done"
              />
            </Section>

            <Section title="Material Delivery" sectionKey="material_delivery" openSection={openSection} setOpenSection={setOpenSection} badge={sectionActiveCount('material_delivery')}>
              <TriStateSelect
                label="Electrical Items"
                value={filters.material_delivery.electrical}
                onChange={(v) => setField('material_delivery', 'electrical', v)}
                trueLabel="Delivered" falseLabel="Pending"
              />
              <TriStateSelect
                label="Structure Items"
                value={filters.material_delivery.structure}
                onChange={(v) => setField('material_delivery', 'structure', v)}
                trueLabel="Delivered" falseLabel="Pending"
              />
              <TriStateSelect
                label="Solar Panels"
                value={filters.material_delivery.panels}
                onChange={(v) => setField('material_delivery', 'panels', v)}
                trueLabel="Delivered" falseLabel="Pending"
              />
            </Section>

            <Section title="Material Installation" sectionKey="material_installation" openSection={openSection} setOpenSection={setOpenSection} badge={sectionActiveCount('material_installation')}>
              <TriStateSelect
                label="Electrical Installation"
                value={filters.material_installation.electrical}
                onChange={(v) => setField('material_installation', 'electrical', v)}
              />
              <TriStateSelect
                label="Structure Installation"
                value={filters.material_installation.structure}
                onChange={(v) => setField('material_installation', 'structure', v)}
              />
            </Section>

            <Section title="KSEB Registration" sectionKey="kseb_registration" openSection={openSection} setOpenSection={setOpenSection} badge={sectionActiveCount('kseb_registration')}>
              <TriStateSelect
                label="Registration Submitted"
                value={filters.kseb_registration.registration_submitted}
                onChange={(v) => setField('kseb_registration', 'registration_submitted', v)}
                trueLabel="Done" falseLabel="Not Done"
              />
              <TriStateSelect
                label="Completion Submitted"
                value={filters.kseb_registration.completion_submitted}
                onChange={(v) => setField('kseb_registration', 'completion_submitted', v)}
                trueLabel="Done" falseLabel="Not Done"
              />
              <TriStateSelect
                label="Agreement Submitted & Payment Done"
                value={filters.kseb_registration.agreement_payment_done}
                onChange={(v) => setField('kseb_registration', 'agreement_payment_done', v)}
                trueLabel="Done" falseLabel="Not Done"
              />
              <TriStateSelect
                label="WiFi Configured"
                value={filters.kseb_registration.wifi_configured}
                onChange={(v) => setField('kseb_registration', 'wifi_configured', v)}
                trueLabel="Done" falseLabel="Not Done"
              />
            </Section>

            <Section title="DCR" sectionKey="dcr" openSection={openSection} setOpenSection={setOpenSection} badge={sectionActiveCount('dcr')}>
              <TriStateSelect
                label="Certificate Sold"
                value={filters.dcr.certificate_sold}
                onChange={(v) => setField('dcr', 'certificate_sold', v)}
                trueLabel="Done" falseLabel="Not Done"
              />
            </Section>

            <Section title="MNRE Installation" sectionKey="mnre_installation" openSection={openSection} setOpenSection={setOpenSection} badge={sectionActiveCount('mnre_installation')}>
              <TriStateSelect
                label="Installation Status"
                value={filters.mnre_installation.installation_status}
                onChange={(v) => setField('mnre_installation', 'installation_status', v)}
              />
              <TriStateSelect
                label="Approval Status"
                value={filters.mnre_installation.approval_status}
                onChange={(v) => setField('mnre_installation', 'approval_status', v)}
                trueLabel="Approved" falseLabel="Pending"
              />
              <TriStateSelect
                label="Subsidy Status"
                value={filters.mnre_installation.subsidy_status}
                onChange={(v) => setField('mnre_installation', 'subsidy_status', v)}
                trueLabel="Approved" falseLabel="Pending"
              />
            </Section>

            <Section title="Service" sectionKey="service" openSection={openSection} setOpenSection={setOpenSection} badge={sectionActiveCount('service')}>
              <Field label="Service Count (min)">
                <select
                  className="af-select"
                  value={filters.service.count_min}
                  onChange={(e) => setField('service', 'count_min', e.target.value)}
                >
                  <option value="">Any</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </Field>
              <Field label="Service Count (max)">
                <select
                  className="af-select"
                  value={filters.service.count_max}
                  onChange={(e) => setField('service', 'count_max', e.target.value)}
                >
                  <option value="">Any</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </Field>
            </Section>
          </div>

          <div className="af-panel-footer">
            <span className="af-active-count">{activeCount} filter{activeCount !== 1 ? 's' : ''} active</span>
            <div className="af-footer-buttons">
              <button type="button" className="cancel-btn" onClick={onToggle}>Close</button>
              <button type="button" className="edit-btn" onClick={onApply}>Apply Filters</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}